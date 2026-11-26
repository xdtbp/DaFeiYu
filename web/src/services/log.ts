/* eslint-disable no-console -- 这个文件的工作就是接管 console */
/**
 * 运行日志：内存环形缓冲 + 轻量落盘 + 一键导出。
 *
 * 目的：出问题时能拿到足够详细的过程（启动、网络请求、流式事件、异常、桥接调用、
 * 上一次运行到崩溃前的记录），但导出的文件里不能有用户的个人数据。
 *
 * 脱敏在「写进缓冲之前」完成，导出的就是缓冲原文，不存在忘记脱敏的路径：
 *  - API Key / 令牌 / Cookie / 密码 → 只留头尾
 *  - 邮箱、手机号、路径里的用户名 → ***
 *  - 聊天正文、思考内容、会话标题、附件内容 → 只保留类型和长度
 *  - 账号昵称、头像、余额 → 只保留有无
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 内存里保留的最大行数（超出后丢最早的） */
const MAX_LINES = 4000
/** 单行最大长度，避免 base64 之类把缓冲撑爆 */
const MAX_LINE = 1600
/** 落盘保留的行数 */
const PERSIST_MAX = 800
const PERSIST_KEY = 'ds:log:current'
const PREV_KEY = 'ds:log:prev'
const PERSIST_INTERVAL = 3000

const MASK = '***'

const lines: string[] = []
const startedAt = Date.now()
let persistTimer: number | null = null

const pad = (value: number, size = 2) => String(value).padStart(size, '0')

const stamp = (at: number) => {
  const date = new Date(at)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  )
}

const fileStamp = () => {
  const date = new Date()
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/* ------------------------------------------------------------------ 脱敏 */

/** 键名本身就是密钥：整值替换（同时兼容 x-xxx-token / client-secret 这类后缀） */
const SECRET_KEY =
  /^(api[-_]?key|apikey|x-api-key|authorization|auth|token|access[-_]?token|refresh[-_]?token|id[-_]?token|cookie|password|passwd|secret|client[-_]?secret|signature|key|.*[-_](key|token|secret))$/i

/** 键名是身份信息：整值替换，只留有无 */
const PERSONAL_KEY =
  /^(name|nickname|nick|avatar|avatar[-_]?url|email|mail|phone|mobile|tel|account|username|user[-_]?name|userid|user[-_]?id|uid|openid|unionid|device[-_]?id|imei|address|balance|bonus|signature)$/i

/** 键名是用户产出内容：只保留长度 */
const CONTENT_KEY =
  /^(content|text|thinking|prompt|query|snippet|title|system|body|answer|question|draft|messages|history|note|reasoning)$/i

const textMask = (value: string): string => {
  let text = value
  // 各种厂商的密钥前缀
  text = text.replace(/\b(sk|pk|ak|rk)-[A-Za-z0-9_-]{6,}/g, (match) =>
    `${match.slice(0, 3)}${MASK}${match.slice(-4)}`
  )
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 ***')
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
  text = text.replace(/\b1[3-9]\d{9}\b/g, (match) => `${match.slice(0, 3)}****${match.slice(-4)}`)
  text = text.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi, '[data-url]')
  // 长串 base64 / 十六进制令牌
  text = text.replace(/\b[A-Za-z0-9+/_-]{48,}={0,2}\b/g, '[token]')
  text = text.replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/gi, '$1***')
  text = text.replace(/(\/Users\/)[^/\s"']+/g, '$1***')
  return text
}

const summarizeText = (value: string): string => {
  const masked = textMask(value)
  if (masked.length > 400) {
    return `[text ${value.length} chars]`
  }
  return masked
}

/** 把参数整理成可安全写进日志的纯数据 */
export const redact = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) {
    return value
  }
  if (depth > 6) {
    return '[deep]'
  }
  if (typeof value === 'string') {
    return summarizeText(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value instanceof Error) {
    return describeError(value)
  }
  if (Array.isArray(value)) {
    const head = value.slice(0, 40).map((item) => redact(item, depth + 1))
    return value.length > head.length ? [...head, `…共 ${value.length} 项`] : head
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let count = 0
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (count >= 60) {
        out['…'] = '字段过多已省略'
        break
      }
      count += 1
      if (SECRET_KEY.test(key)) {
        out[key] = MASK
        continue
      }
      if (PERSONAL_KEY.test(key)) {
        out[key] = item === null || item === undefined || item === '' ? item : MASK
        continue
      }
      if (CONTENT_KEY.test(key)) {
        out[key] = describeContent(item)
        continue
      }
      out[key] = redact(item, depth + 1)
    }
    return out
  }
  return String(value)
}

/** 用户内容只留结构：类型 + 长度，正文一律不写 */
const describeContent = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value ? `[text ${value.length} chars]` : ''
  }
  if (Array.isArray(value)) {
    // 数组元素如果是对象，按字段继续脱敏：能留下 role / type / 长度这些结构信息
    const head = value.slice(0, 20).map((item) =>
      item && typeof item === 'object' ? redact(item, 1) : describeContent(item)
    )
    return value.length > head.length ? [...head, `…共 ${value.length} 项`] : head
  }
  if (value && typeof value === 'object') {
    return `[object ${Object.keys(value as object).length} keys]`
  }
  return value === null || value === undefined ? value : '[value]'
}

const describeError = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return { value: summarizeText(String(error)) }
  }
  const extra = error as Error & { kind?: string; status?: number; localMessage?: unknown }
  return {
    name: error.name,
    message: summarizeText(error.message),
    ...(extra.kind ? { kind: extra.kind } : {}),
    ...(typeof extra.status === 'number' ? { status: extra.status } : {}),
    ...(error.stack ? { stack: summarizeText(error.stack).slice(0, 1200) } : {}),
  }
}

/* -------------------------------------------------------------- 写入缓冲 */

const schedulePersist = () => {
  if (persistTimer !== null) {
    return
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(lines.slice(-PERSIST_MAX)))
    } catch {
      // 配额满等情况直接放弃落盘，不影响运行
    }
  }, PERSIST_INTERVAL)
}

const push = (level: LogLevel, tag: string, text: string, data?: unknown) => {
  let line = `${stamp(Date.now())} ${level.toUpperCase().padEnd(5)} [${tag}] ${summarizeText(text)}`
  if (data !== undefined) {
    try {
      line += ` ${JSON.stringify(redact(data))}`
    } catch {
      line += ' [data 无法序列化]'
    }
  }
  if (line.length > MAX_LINE) {
    line = `${line.slice(0, MAX_LINE)}…[truncated]`
  }
  lines.push(line)
  if (lines.length > MAX_LINES) {
    lines.splice(0, lines.length - MAX_LINES)
  }
  schedulePersist()
}

export const log = {
  debug: (tag: string, text: string, data?: unknown) => push('debug', tag, text, data),
  info: (tag: string, text: string, data?: unknown) => push('info', tag, text, data),
  warn: (tag: string, text: string, data?: unknown) => push('warn', tag, text, data),
  error: (tag: string, text: string, data?: unknown) => push('error', tag, text, data),
}

/** 记录一个异常对象（自动带上 name / message / stack） */
export const logError = (tag: string, text: string, error: unknown, data?: unknown) => {
  push('error', tag, text, { error: describeError(error), ...(data ? { extra: data } : {}) })
}

/** 简易计时器：logTime('api', '发送消息') 返回一个结束函数 */
export const logTimer = (tag: string, text: string) => {
  const begin = Date.now()
  return (extra?: unknown, level: LogLevel = 'info') => {
    push(level, tag, `${text} 用时 ${Date.now() - begin}ms`, extra)
  }
}

/* ------------------------------------------------------------ 环境与钩子 */

const appVersion = (): string => {
  try {
    const bridge = (window as unknown as { AndroidApp?: { version?: () => string } }).AndroidApp
    return bridge?.version?.() ?? 'web'
  } catch {
    return 'unknown'
  }
}

const describeEnvironment = () => {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const screenInfo: Record<string, unknown> = {}
  try {
    screenInfo.size = `${screen.width}x${screen.height}`
    screenInfo.avail = `${screen.availWidth}x${screen.availHeight}`
    screenInfo.dpr = window.devicePixelRatio
    screenInfo.viewport = `${window.innerWidth}x${window.innerHeight}`
  } catch {
    // 忽略
  }
  let storage: Record<string, unknown> = {}
  try {
    storage = {
      localStorageKeys: localStorage.length,
      localStorageBytes: JSON.stringify(localStorage).length,
    }
  } catch {
    storage = { localStorage: '不可读' }
  }
  return {
    version: appVersion(),
    userAgent: navigator.userAgent,
    platform: nav.platform,
    language: navigator.language,
    languages: navigator.languages,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    online: navigator.onLine,
    connection: (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } })
      .connection?.effectiveType,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    colorScheme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    ...screenInfo,
    ...storage,
    indexedDB: typeof indexedDB !== 'undefined',
    isSecure: window.isSecureContext,
    // 页面本身的地址：只保留文件名，去掉可能带查询串的参数
    entry: `${location.origin}${location.pathname}`,
    referrer: document.referrer ? '有' : '无',
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone ?? false,
  }
}

let hooksInstalled = false

/** 装全局钩子：未捕获异常、Promise 拒绝、console 输出、网络状态变化 */
export const installLogHooks = () => {
  if (hooksInstalled) {
    return
  }
  hooksInstalled = true

  window.addEventListener('error', (event) => {
    const target = event.target
    // 图片/脚本等资源加载失败走的是捕获阶段，没有 message
    if (target instanceof HTMLElement) {
      push('error', 'dom', '资源加载失败', {
        tag: target.tagName,
        src: target.getAttribute('src') ?? target.getAttribute('href') ?? '',
      })
      return
    }
    push('error', 'uncaught', event.message || '未知脚本错误', {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: describeError(event.error),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    push('error', 'promise', '未处理的 Promise 拒绝', describeError(event.reason))
  })

  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }
  const mirror = (level: LogLevel, target: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      target(...args)
      try {
        const text = args
          .map((item) => {
            if (typeof item === 'string') {
              return item
            }
            if (item instanceof Error) {
              return `${item.name}: ${item.message}${item.stack ? ` | ${item.stack}` : ''}`
            }
            try {
              return JSON.stringify(redact(item))
            } catch {
              return String(item)
            }
          })
          .join(' ')
        push(level, 'console', text)
      } catch {
        // 日志失败不影响业务
      }
    }
  }
  console.log = mirror('info', original.log)
  console.info = mirror('info', original.info)
  console.debug = mirror('debug', original.debug)
  console.warn = mirror('warn', original.warn)
  console.error = mirror('error', original.error)

  window.addEventListener('online', () => push('info', 'net', '网络已连接'))
  window.addEventListener('offline', () => push('warn', 'net', '网络已断开'))
  document.addEventListener('visibilitychange', () =>
    push('debug', 'life', `页面可见性 ${document.visibilityState}`)
  )
  window.addEventListener('pagehide', () => {
    push('info', 'life', '页面隐藏（pagehide）')
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(lines.slice(-PERSIST_MAX)))
    } catch {
      // 忽略
    }
  })
}

/** 启动时的一次性环境快照 */
export const logStartup = (note?: string) => {
  restorePrevious()
  installLogHooks()
  push('info', 'app', note ?? '启动', describeEnvironment())
}

/* ---------------------------------------------------------------- 导出 */

const readPrevious = (): string[] => {
  try {
    const raw = localStorage.getItem(PREV_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const restorePrevious = () => {
  try {
    const current = localStorage.getItem(PERSIST_KEY)
    if (current) {
      localStorage.setItem(PREV_KEY, current)
    }
    localStorage.removeItem(PERSIST_KEY)
  } catch {
    // 忽略
  }
}

/** 原生日志环形缓冲（WebView 页面加载、权限、文件选择、原生异常等） */
const nativeLog = (): string => {
  try {
    const bridge = (window as unknown as { AndroidApp?: { logDump?: () => string } }).AndroidApp
    const dump = bridge?.logDump?.()
    return typeof dump === 'string' && dump.trim() ? dump : ''
  } catch {
    return ''
  }
}

/** 拼出完整日志文本（已脱敏） */
export const buildLogText = (): string => {
  const previous = readPrevious()
  const native = nativeLog()
  const parts: string[] = []

  parts.push('=== 大飞鱼 运行日志 ===')
  parts.push(`导出时间: ${stamp(Date.now())}`)
  parts.push(`本次启动: ${stamp(startedAt)}`)
  parts.push(`应用版本: ${appVersion()}`)
  parts.push(`日志行数: 本次 ${lines.length} 行，上次 ${previous.length} 行`)
  parts.push('')
  parts.push('【脱敏说明】')
  parts.push('  以下内容不会出现在日志中：API Key、登录令牌、Cookie、密码（仅保留头尾几位）；')
  parts.push('  邮箱、手机号、本机路径中的用户名；账号昵称、头像、余额；')
  parts.push('  聊天正文、思考内容、会话标题、附件内容（仅保留类型与字符数）。')
  parts.push('  会话 id、请求参数结构、状态码、耗时、错误信息保留完整，便于定位问题。')
  parts.push('')

  if (previous.length > 0) {
    parts.push(`--- 上次运行（最多 ${PERSIST_MAX} 行，可能是崩溃前最后一段） ---`)
    parts.push(...previous)
    parts.push('')
  }

  parts.push('--- 本次运行 ---')
  parts.push(...lines)
  parts.push('')

  if (native) {
    parts.push('--- 原生侧 ---')
    parts.push(native)
  }

  return parts.join('\n')
}

const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x2000
  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

export type LogExportResult = 'saved' | 'downloaded' | 'failed'

/**
 * 导出：原生壳直接写进系统「下载」目录（和导出历史一致，不弹分享面板），
 * 网页版退回浏览器下载。
 */
export const exportLogFile = (): LogExportResult => {
  let text: string
  try {
    text = buildLogText()
  } catch (error) {
    logError('log', '生成日志失败', error)
    return 'failed'
  }
  const name = `dafeiyu-log-${fileStamp()}.txt`
  try {
    const bridge = (
      window as unknown as { AndroidApp?: { saveLog?: (name: string, base64: string) => boolean } }
    ).AndroidApp
    if (typeof bridge?.saveLog === 'function') {
      const saved = bridge.saveLog(name, toBase64(text))
      push('info', 'log', saved ? '日志已保存到下载目录' : '保存日志失败', { chars: text.length })
      return saved ? 'saved' : 'failed'
    }
  } catch (error) {
    logError('log', '原生保存失败，回退到浏览器下载', error)
  }
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    push('info', 'log', '日志已下载', { chars: text.length })
    return 'downloaded'
  } catch (error) {
    logError('log', '下载日志失败', error)
    return 'failed'
  }
}

// 排障入口：控制台里 __dsLog.text() 可以先看导出内容，__dsLog.redact(x) 检查脱敏效果
;(window as unknown as { __dsLog?: unknown }).__dsLog = {
  text: buildLogText,
  redact,
  export: exportLogFile,
}
