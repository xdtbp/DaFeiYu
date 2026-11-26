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

/**
 * 与相册比对一次。
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
  const next: CachedPhoto[] = []
  const fresh: string[] = []
  for (const id of ids) {
    const cached = known.get(id)
    if (cached) {
      next.push(cached)
      continue
    }
    const preview = readPreview(id)
    if (!preview) {
      continue
    }
    next.push({ id, preview })
    if (ready) {
      fresh.push(id)
    }
  }
  const trimmed = next.slice(0, LIMIT)
  const changed =
    trimmed.length !== photos.length || trimmed.some((photo, index) => photo.id !== photos[index]?.id)
  if (changed || !ready) {
    usePhotoCache.setState({ photos: trimmed, fresh, ready: true })
  }
  return fresh.length > 0
}

/** 立刻把当前列表读进缓存（首次打开面板前也可以调用） */
export const hydratePhotos = (): void => {
  refreshPhotos()
}

let timer: number | null = null

/** 常驻轮询：应用在前台时每 20 秒比对一次，新照片静默进缓存 */
export const startPhotoWatcher = (intervalMs = 20_000) => {
  if (timer !== null || !bridge()) {
    return
  }
  refreshPhotos()
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
