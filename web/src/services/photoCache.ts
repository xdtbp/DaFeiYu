import { create } from 'zustand'

/**
 * 相册最近照片缓存。
 *
 * 以前是每次点「+」才让原生一次性解码 12 张缩略图，面板要等、图还糊。
 * 现在：
 *  - 原生只负责「列 id」（不解码）与「单张预览」（解码 + LRU 缓存）；
 *  - 前端常驻一份 12 张的列表，定时比对 id，有新图就静默取一张、插到最前、挤掉最后一张；
 *  - 打开面板时直接用缓存渲染，动画结束后再比对一次，避免「刚拍的照片没出现」。
 */

export type CachedPhoto = {
  id: string
  /** 长边 512 的 JPEG data URI：格子是 80dp，这个分辨率足够锐利 */
  preview: string
}

const LIMIT = 12
const PREVIEW_SIZE = 512

type Bridge = {
  listRecentPhotos?: (limit: number) => string
  getPhotoPreview?: (id: string, size: number) => string
  /** 老接口，兜底用 */
  getRecentPhotos?: (limit: number) => string
}

const bridge = () =>
  (window as unknown as { AndroidMedia?: Bridge }).AndroidMedia ?? undefined

const readPreview = (id: string): string => {
  try {
    return bridge()?.getPhotoPreview?.(id, PREVIEW_SIZE) ?? ''
  } catch {
    return ''
  }
}

type PhotoCacheState = {
  photos: CachedPhoto[]
  /** 本轮新增的 id，用来播「插入 + 后移」动画 */
  fresh: string[]
  /** 缓存第一次填充完成 */
  ready: boolean
}

export const usePhotoCache = create<PhotoCacheState>(() => ({
  photos: [],
  fresh: [],
  ready: false,
}))

const parseList = (raw: string): { id: string }[] => {
  try {
    const list = JSON.parse(raw || '[]')
    return Array.isArray(list) ? (list as { id: string }[]) : []
  } catch {
    return []
  }
}

/** 待解码的预览：一张一张来，别在启动时一口气解 12 张 */
const queue: string[] = []
let pumpTimer: number | null = null

/** 每次最多解几张，解完让出主线程 */
const PER_TICK = 3

const pump = () => {
  if (pumpTimer !== null) {
    return
  }
  const step = () => {
    for (let i = 0; i < PER_TICK; i++) {
      const id = queue.shift()
      if (!id) {
        pumpTimer = null
        return
      }
      const preview = readPreview(id)
      if (!preview) {
        continue
      }
      const { photos, ready, fresh } = usePhotoCache.getState()
      if (photos.some((photo) => photo.id === id)) {
        continue
      }
      usePhotoCache.setState({
        // 新图插到最前，挤掉最后一张
        photos: [{ id, preview }, ...photos].slice(0, LIMIT),
        fresh: ready ? [id, ...fresh.filter((item) => item !== id)].slice(0, 3) : [],
        ready: true,
      })
    }
    pumpTimer = window.setTimeout(step, 8)
  }
  pumpTimer = window.setTimeout(step, 0)
}

/**
 * 与相册比对一次：只做「查 id + 排队」，真正的解码分帧进行。
 * @returns 是否有新增（调用方据此播动画）
 */
export const refreshPhotos = (): boolean => {
  const api = bridge()
  if (!api) {
    return false
  }
  // 优先用轻量的 id 列表；老原生只有 getRecentPhotos 时退回旧接口
  const ids = api.listRecentPhotos
    ? parseList(api.listRecentPhotos(LIMIT)).map((item) => item.id)
    : parseList(api.getRecentPhotos?.(LIMIT) ?? '').map((item) => item.id)
  if (ids.length === 0) {
    return false
  }

  const { photos, ready } = usePhotoCache.getState()
  const known = new Map(photos.map((photo) => [photo.id, photo]))
  // 顺序跟着相册走；已解码的保留，缺的排队
  const next: CachedPhoto[] = []
  const missing: string[] = []
  for (const id of ids) {
    const cached = known.get(id)
    if (cached) {
      next.push(cached)
    } else if (!missing.includes(id)) {
      missing.push(id)
    }
  }
  const changed = next.length !== photos.length || next.some((photo, i) => photo.id !== photos[i]?.id)
  if (changed) {
    usePhotoCache.setState({ photos: next })
  }
  if (!ready) {
    usePhotoCache.setState({ ready: true })
  }
  for (const id of missing) {
    if (!queue.includes(id)) {
      queue.push(id)
    }
  }
  if (missing.length > 0) {
    pump()
  }
  return missing.length > 0
}

/** 打开面板前调用：把当前列表读进缓存（解码同样分帧） */
export const hydratePhotos = (): void => {
  refreshPhotos()
}

let timer: number | null = null

/** 常驻轮询：应用在前台时每 20 秒比对一次，新照片静默进缓存 */
export const startPhotoWatcher = (intervalMs = 20_000) => {
  if (timer !== null || !bridge()) {
    return
  }
  // 首屏刚出来时不要解码相册：等页面空下来再跑，避免和首帧抢主线程
  // 首屏后先等 1.5s，再挑空闲时段预热，别和任何启动工作抢
  window.setTimeout(() => {
    const warmup = () => refreshPhotos()
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
      }
    ).requestIdleCallback
    if (idle) {
      idle(warmup, { timeout: 4000 })
    } else {
      warmup()
    }
  }, 1500)
  timer = window.setInterval(() => {
    if (!document.hidden) {
      refreshPhotos()
    }
  }, intervalMs)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshPhotos()
    }
  })
}

export const stopPhotoWatcher = () => {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}
