/**
 * 历史归档选择：走原生文件选择器 + 轮询原生准备状态。
 *
 * 为什么不用 `<input type="file">`：Android WebView 拿到的 content:// 大文件
 * 在部分机型上读不完整（size 为 0 或中途截断），导入必然失败。
 * 也不依赖原生主动回调 JS：页面重载、后台回收都会让一次性回调丢掉。
 * 这里改成：原生选择 → 复制到应用目录 → 前端轮询状态 → 用 fetch 读回普通 Blob。
 */

type AndroidFileBridge = {
  pickArchive?: () => void
  archiveState?: () => string
  resetArchiveState?: () => void
}

export type ArchiveHandlers = {
  onReady: (file: File) => void
  onError: (message: string) => void
  onBusy: (busy: boolean) => void
}

/** 原生复制好的归档固定放在这个地址，由 WebViewAssetLoader 的 /local/ 前缀提供 */
const ARCHIVE_URL = 'https://appassets.androidplatform.net/local/import.zip'
const POLL_INTERVAL = 300
const POLL_TIMEOUT = 8 * 60 * 1000

let handlers: ArchiveHandlers | null = null

const bridge = (): AndroidFileBridge | undefined =>
  (window as unknown as { AndroidFile?: AndroidFileBridge }).AndroidFile

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 原生是否提供归档选择能力 */
export const hasNativeArchivePicker = () => typeof bridge()?.pickArchive === 'function'

/** 设置面板打开时注册，关闭时传 null 注销 */
export const registerArchiveHandlers = (next: ArchiveHandlers | null) => {
  handlers = next
}

const readArchive = async (name: string): Promise<File> => {
  // 带时间戳：即使 WebView 缓存了同名 URL，也不会拿到上一次的文件
  const response = await fetch(`${ARCHIVE_URL}?v=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const blob = await response.blob()
  return new File([blob], name || 'deepseek_data.zip', { type: 'application/zip' })
}

/** 唤起原生选择器，并轮询等待它把文件复制好 */
export const pickArchiveNative = async () => {
  const native = bridge()
  if (!native?.pickArchive) {
    return
  }
  native.resetArchiveState?.()
  native.pickArchive?.()
  const deadline = Date.now() + POLL_TIMEOUT
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL)
    const raw = native.archiveState?.()
    if (!raw) {
      continue
    }
    let state: { state?: string; name?: string; message?: string } = {}
    try {
      state = JSON.parse(raw) as typeof state
    } catch {
      continue
    }
    if (state.state === 'ready') {
      try {
        const file = await readArchive(state.name ?? 'deepseek_data.zip')
        handlers?.onReady(file)
      } catch (error) {
        handlers?.onError(error instanceof Error ? error.message : String(error))
      }
      return
    }
    if (state.state === 'error') {
      handlers?.onError(state.message ?? '读取文件失败')
      return
    }
    if (state.state === 'cancelled') {
      handlers?.onBusy(false)
      return
    }
  }
  handlers?.onError('读取文件超时')
}
