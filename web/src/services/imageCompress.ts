import { create } from 'zustand'

/**
 * 图片压缩：设置 + 实际压缩。
 *
 * 全部在本地用 canvas 做，不依赖原生：
 *  - 无损：原样返回；
 *  - 均衡：跟随原格式、缩到 85%、JPEG/WebP 质量 82（接近官方导出的观感）；
 *  - 极限：转 WebP、缩到 60%、质量 55；
 *  - 自定义：格式 / 分辨率百分比 / 质量 / PNG 压缩级别 / 有损 PNG 量化。
 *
 * PNG 的「压缩级别」「量化」浏览器没有直接开关，这里用降色近似：
 * 级别越高、量化越强，颜色桶越少，体积越小。
 */

export type CompressMode = 'lossless' | 'balanced' | 'extreme' | 'custom'
export type ImageFormat = 'follow' | 'jpeg' | 'png' | 'webp'

export type CompressSettings = {
  format: ImageFormat
  /** 分辨率百分比 1-100 */
  scale: number
  /** 有损格式质量 1-100 */
  quality: number
  /** PNG 压缩级别 0-9（越大越狠） */
  pngLevel: number
  /** PNG 有损量化开关 */
  pngQuantize: boolean
  /** 量化强度 65-80（越小颜色越少、体积越小） */
  pngQuantizeLevel: number
}

export const DEFAULT_CUSTOM: CompressSettings = {
  format: 'follow',
  scale: 100,
  quality: 80,
  pngLevel: 6,
  pngQuantize: false,
  pngQuantizeLevel: 72,
}

/** 均衡：官方导出图的观感——尺寸略缩、质量不低 */
export const BALANCED: CompressSettings = {
  format: 'follow',
  scale: 85,
  quality: 82,
  pngLevel: 6,
  pngQuantize: false,
  pngQuantizeLevel: 72,
}

/** 极限：WebP + 更低质量，体积优先 */
export const EXTREME: CompressSettings = {
  format: 'webp',
  scale: 60,
  quality: 55,
  pngLevel: 9,
  pngQuantize: true,
  pngQuantizeLevel: 68,
}

const KEY = 'chat-demo:image-compress'

type Persisted = {
  mode: CompressMode
  custom: CompressSettings
}

const load = (): Persisted => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      throw new Error('empty')
    }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      mode:
        parsed.mode === 'lossless' || parsed.mode === 'extreme' || parsed.mode === 'custom'
          ? parsed.mode
          : 'balanced',
      custom: { ...DEFAULT_CUSTOM, ...(parsed.custom ?? {}) },
    }
  } catch {
    return { mode: 'balanced', custom: DEFAULT_CUSTOM }
  }
}

type State = Persisted & {
  setMode: (mode: CompressMode) => void
  setCustom: (patch: Partial<CompressSettings>) => void
}

const persist = (state: Persisted) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 配额满时忽略
  }
}

export const useImageCompress = create<State>((set, get) => ({
  ...load(),
  setMode: (mode) => {
    set({ mode })
    persist({ mode, custom: get().custom })
  },
  setCustom: (patch) => {
    const custom = { ...get().custom, ...patch }
    set({ custom })
    persist({ mode: get().mode, custom })
  },
}))

/** 把「均衡 / 极限 / 自定义 / 无损」解析成具体参数 */
export const resolveSettings = (mode: CompressMode, custom: CompressSettings): CompressSettings | null => {
  if (mode === 'lossless') {
    return null
  }
  if (mode === 'extreme') {
    return EXTREME
  }
  if (mode === 'custom') {
    return custom
  }
  return BALANCED
}

const mimeOf = (format: ImageFormat, sourceType: string): string => {
  if (format === 'jpeg') {
    return 'image/jpeg'
  }
  if (format === 'png') {
    return 'image/png'
  }
  if (format === 'webp') {
    return 'image/webp'
  }
  // 跟随原图：不认识的一律当 JPEG
  return sourceType === 'image/png' || sourceType === 'image/webp' ? sourceType : 'image/jpeg'
}

const decode = async (blob: Blob): Promise<ImageBitmap | HTMLImageElement | null> => {
  try {
    if ('createImageBitmap' in window) {
      return await createImageBitmap(blob)
    }
  } catch {
    // 退回 <img>
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

/** 量化：把颜色按位数砍掉，模拟有损 PNG 的观感 */
const posterize = (context: CanvasRenderingContext2D, width: number, height: number, level: number) => {
  // level 65-80 映射到保留 5-7 位/通道
  const bits = Math.max(4, Math.min(7, Math.round((level - 50) / 5)))
  const step = 255 / (2 ** bits - 1)
  const data = context.getImageData(0, 0, width, height)
  for (let i = 0; i < data.data.length; i += 4) {
    data.data[i] = Math.round(data.data[i] / step) * step
    data.data[i + 1] = Math.round(data.data[i + 1] / step) * step
    data.data[i + 2] = Math.round(data.data[i + 2] / step) * step
  }
  context.putImageData(data, 0, 0)
}

/**
 * 按设置压缩一张图。
 * @returns 压缩后的 Blob；没变小时返回原图（无损也返回原图）
 */
export const compressImage = async (blob: Blob, settings: CompressSettings | null): Promise<Blob> => {
  if (!settings) {
    return blob
  }
  const bitmap = await decode(blob)
  if (!bitmap) {
    return blob
  }
  const sourceWidth = 'width' in bitmap ? bitmap.width : 0
  const sourceHeight = 'height' in bitmap ? bitmap.height : 0
  if (!sourceWidth || !sourceHeight) {
    return blob
  }

  const ratio = Math.min(1, Math.max(0.01, settings.scale / 100))
  const width = Math.max(1, Math.round(sourceWidth * ratio))
  const height = Math.max(1, Math.round(sourceHeight * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    return blob
  }
  context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height)

  const mime = mimeOf(settings.format, blob.type)
  if (mime === 'image/png') {
    // PNG 压缩级别：级别越高降色越狠
    const bits = Math.max(1, 8 - Math.round(settings.pngLevel / 2))
    posterize(context, width, height, settings.pngQuantize ? settings.pngQuantizeLevel : 50 + bits * 5)
  }

  const encoded = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (result) => resolve(result),
      mime,
      mime === 'image/png' ? undefined : Math.min(1, Math.max(0.05, settings.quality / 100))
    )
  })
  if (bitmap instanceof ImageBitmap) {
    bitmap.close()
  }
  if (!encoded || encoded.size >= blob.size) {
    return blob
  }
  return encoded
}

export type CompressProgress = { done: number; total: number; saved: number }

/** 批量压缩本地已存的图片原件（大于阈值的才处理） */
export const compressBlobs = async (
  items: { id: string; blob: Blob }[],
  threshold: number,
  settings: CompressSettings | null,
  onProgress?: (progress: CompressProgress) => void,
  write?: (id: string, blob: Blob) => Promise<void>
): Promise<CompressProgress> => {
  const targets = items.filter(
    (item) => item.blob.type.startsWith('image/') && item.blob.size > threshold
  )
  let saved = 0
  let done = 0
  for (const item of targets) {
    const next = await compressImage(item.blob, settings)
    if (next !== item.blob && write) {
      await write(item.id, next)
      saved += item.blob.size - next.size
    }
    done += 1
    onProgress?.({ done, total: targets.length, saved })
  }
  return { done, total: targets.length, saved }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * 上传前按当前设置处理一张图片。
 * 非图片、无损模式、压缩后反而更大时原样返回。
 */
export const prepareUploadFile = async (file: File): Promise<File> => {
  const { mode, custom } = useImageCompress.getState()
  const settings = resolveSettings(mode, custom)
  if (!settings || !file.type.startsWith('image/')) {
    return file
  }
  try {
    const next = await compressImage(file, settings)
    if (next === file || next.size >= file.size) {
      return file
    }
    const ext = EXT_BY_MIME[next.type] ?? 'jpg'
    const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext
    return new File([next], name, { type: next.type })
  } catch {
    return file
  }
}
