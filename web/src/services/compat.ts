/**
 * 老 WebView 的运行时补齐。
 *
 * 目标下限：Chrome 58（Android 8 出厂自带的 WebView）。
 *
 * 语法部分在构建期解决：`rspack.config.ts` 把 swc / lightningcss 的目标降到 ES2015，
 * 连 node_modules 一起降级（KaTeX、micromark 自带 ES2018+ 语法，老引擎连解析都过不了）。
 * 但**内置方法不会被降级**，只能在这里补：
 *
 *   Object.hasOwn        Chrome 93
 *   Array/String.at      Chrome 92
 *   toSorted/toReversed  Chrome 110
 *   flatMap/flat         Chrome 69
 *   Object.fromEntries   Chrome 73
 *   Promise.allSettled   Chrome 76
 *   queueMicrotask       Chrome 71
 *   globalThis           Chrome 71
 *   ResizeObserver       Chrome 64
 *   AbortController      Chrome 66
 *
 * 这个模块必须在任何业务模块求值之前跑完：`main.tsx` 把它放在第一个 import，
 * 模块加载时立即安装（不是导出函数等别人调用）。
 */

type Loose = Record<string, unknown>

const define = (target: Loose, key: string, value: unknown) => {
  if (typeof target[key] === 'function' || target[key] !== undefined) {
    return
  }
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

/** 下标归一化：支持负数，越界交给调用方判断 */
const atIndex = (length: number, index: number) => {
  const i = Math.trunc(index) || 0
  return i < 0 ? length + i : i
}

const installObject = () => {
  define(Object as unknown as Loose, 'hasOwn', (target: object, key: PropertyKey) =>
    Object.prototype.hasOwnProperty.call(target, key)
  )
  define(Object as unknown as Loose, 'fromEntries', (entries: Iterable<[PropertyKey, unknown]>) => {
    const result: Loose = {}
    for (const entry of entries) {
      result[String(entry[0])] = entry[1]
    }
    return result
  })
}

const installArray = () => {
  const proto = Array.prototype as unknown as Loose
  define(proto, 'at', function (this: unknown[], index: number) {
    const i = atIndex(this.length, index)
    return i < 0 || i >= this.length ? undefined : this[i]
  })
  define(String.prototype as unknown as Loose, 'at', function (this: string, index: number) {
    const i = atIndex(this.length, index)
    return i < 0 || i >= this.length ? undefined : this[i]
  })
  define(proto, 'flat', function (this: unknown[], depth = 1) {
    const result: unknown[] = []
    const walk = (list: unknown[], level: number) => {
      for (const item of list) {
        if (level > 0 && Array.isArray(item)) {
          walk(item, level - 1)
        } else {
          result.push(item)
        }
      }
    }
    walk(this, Math.floor(depth))
    return result
  })
  define(proto, 'flatMap', function (this: unknown[], callback: unknown, thisArg?: unknown) {
    const result: unknown[] = []
    const mapped = (this as unknown[]).map(callback as never, thisArg)
    for (const item of mapped) {
      if (Array.isArray(item)) {
        for (const inner of item) {
          result.push(inner)
        }
      } else {
        result.push(item)
      }
    }
    return result
  })
  define(proto, 'toReversed', function (this: unknown[]) {
    return this.slice().reverse()
  })
  define(proto, 'toSorted', function (this: unknown[], compareFn?: (a: unknown, b: unknown) => number) {
    return this.slice().sort(compareFn)
  })
}

const installPromise = () => {
  define(Promise as unknown as Loose, 'allSettled', (iterable: Iterable<unknown>) =>
    Promise.all(
      Array.from(iterable).map((item) =>
        Promise.resolve(item).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason: unknown) => ({ status: 'rejected' as const, reason })
        )
      )
    )
  )
}

const installGlobals = () => {
  const win = window as unknown as Loose
  if (!win.globalThis) {
    win.globalThis = window
  }
  if (typeof win.queueMicrotask !== 'function') {
    win.queueMicrotask = (callback: () => void) => {
      Promise.resolve()
        .then(callback)
        .catch((error: unknown) => {
          // 与原生一致：微任务里的异常不能吞掉，抛到全局
          window.setTimeout(() => {
            throw error
          }, 0)
        })
    }
  }
}

/**
 * ResizeObserver 兜底：定时轮询比对尺寸。
 * 原生版本（Chrome 64+）更精确；这里只求「布局变化后能触发一次」，间隔放宽到 200ms——
 * 流式滚动的主路径走 Markdown 更新回调，不依赖它。
 */
const installResizeObserver = () => {
  const win = window as unknown as Loose
  if (typeof win.ResizeObserver === 'function') {
    return
  }
  type Watcher = {
    callback: (entries: unknown[], observer: unknown) => void
    sizes: Map<Element, { w: number; h: number }>
  }
  const watchers = new Set<Watcher>()
  let timer = 0
  const measure = (element: Element) => ({ w: element.clientWidth, h: element.clientHeight })
  const tick = () => {
    timer = 0
    watchers.forEach((watcher) => {
      const entries: unknown[] = []
      watcher.sizes.forEach((size, element) => {
        const next = measure(element)
        if (next.w === size.w && next.h === size.h) {
          return
        }
        size.w = next.w
        size.h = next.h
        entries.push({
          target: element,
          contentRect: {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            width: next.w,
            height: next.h,
            right: next.w,
            bottom: next.h,
          },
          borderBoxSize: [{ inlineSize: next.w, blockSize: next.h }],
          contentBoxSize: [{ inlineSize: next.w, blockSize: next.h }],
        })
      })
      if (entries.length > 0) {
        watcher.callback(entries, null)
      }
    })
    if (watchers.size > 0) {
      timer = window.setTimeout(tick, 200)
    }
  }
  const schedule = () => {
    if (timer === 0) {
      timer = window.setTimeout(tick, 0)
    }
  }
  class ResizeObserverPolyfill {
    private readonly watcher: Watcher
    constructor(callback: (entries: unknown[], observer: unknown) => void) {
      this.watcher = { callback, sizes: new Map() }
    }
    observe(element: Element) {
      this.watcher.sizes.set(element, measure(element))
      watchers.add(this.watcher)
      schedule()
    }
    unobserve(element: Element) {
      this.watcher.sizes.delete(element)
      if (this.watcher.sizes.size === 0) {
        watchers.delete(this.watcher)
      }
    }
    disconnect() {
      this.watcher.sizes.clear()
      watchers.delete(this.watcher)
    }
  }
  win.ResizeObserver = ResizeObserverPolyfill
}

/**
 * AbortController 兜底。
 * 注意：Chrome 66 之前的 fetch 不认 signal，补了也拦不住请求；
 * 但流式读取在 abort 时还会 reader.cancel()，连接仍能释放。
 */
const installAbort = () => {
  const win = window as unknown as Loose
  if (typeof win.AbortController === 'function') {
    return
  }
  class AbortSignalPolyfill {
    aborted = false
    reason: unknown = undefined
    readonly listeners: Array<() => void> = []
    addEventListener(type: string, listener: () => void) {
      if (type !== 'abort') {
        return
      }
      if (this.aborted) {
        listener()
        return
      }
      this.listeners.push(listener)
    }
    removeEventListener(type: string, listener: () => void) {
      if (type !== 'abort') {
        return
      }
      const index = this.listeners.indexOf(listener)
      if (index >= 0) {
        this.listeners.splice(index, 1)
      }
    }
  }
  class AbortControllerPolyfill {
    readonly signal = new AbortSignalPolyfill()
    abort(reason?: unknown) {
      const { signal } = this
      if (signal.aborted) {
        return
      }
      signal.aborted = true
      signal.reason = reason
      for (const listener of signal.listeners.splice(0)) {
        try {
          listener()
        } catch (error) {
          window.setTimeout(() => {
            throw error
          }, 0)
        }
      }
    }
  }
  win.AbortController = AbortControllerPolyfill
  win.AbortSignal = AbortSignalPolyfill
}

/** 老引擎不认 `scrollTo` / `scrollIntoView` 的选项对象（Chrome 61+） */
const installScroll = () => {
  if ('scrollBehavior' in document.documentElement.style) {
    return
  }
  const proto = Element.prototype as unknown as Loose
  const nativeScrollTo = proto.scrollTo as
    | ((this: Element, x?: number | ScrollToOptions, y?: number) => void)
    | undefined
  if (typeof nativeScrollTo === 'function') {
    proto.scrollTo = function (
      this: Element,
      options?: number | ScrollToOptions,
      y?: number
    ) {
      if (options !== null && typeof options === 'object') {
        if (typeof options.left === 'number') {
          this.scrollLeft = options.left
        }
        if (typeof options.top === 'number') {
          this.scrollTop = options.top
        }
        return
      }
      nativeScrollTo.call(this, options as number, y)
    }
  }
  const nativeIntoView = proto.scrollIntoView as
    | ((this: Element, arg?: boolean | ScrollIntoViewOptions) => void)
    | undefined
  if (typeof nativeIntoView === 'function') {
    proto.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      nativeIntoView.call(this, typeof arg === 'boolean' ? arg : true)
    }
  }
}

let installed = false

export const installCompat = () => {
  if (installed) {
    return
  }
  installed = true
  installObject()
  installArray()
  installPromise()
  installGlobals()
  installResizeObserver()
  installAbort()
  installScroll()
}

installCompat()
