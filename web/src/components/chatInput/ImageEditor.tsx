import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { pushBackHandler } from '../../services/backStack.js'
import {
  IconCheckOutline20,
  IconCloseOutline20,
  IconCropOutline20,
  IconRedoOutline20,
  IconUndoOutline20,
} from '../base/icons-extra.js'
import styles from './ImageEditor.module.css'

type Props = {
  file: File
  onDone: (file: File) => void
  onCancel: () => void
}

type Point = { x: number; y: number }
type Stroke = { color: string; width: number; points: Point[] }
type Rect = { x: number; y: number; w: number; h: number }

/** 固定蓝色画笔；粗细取滑块的约 25% 位置 */
const PEN_COLOR = '#0a84ff'
const WIDTHS = { min: 2, max: 40 }
const PEN_WIDTH = Math.round(WIDTHS.min + (WIDTHS.max - WIDTHS.min) * 0.25)
/** base 图最长边，控制内存 */
const MAX_SIDE = 1600

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 两点之间的最小距离，避免单次移动堆积大量重复点 */
const farEnough = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) > 1.2

/**
 * 图片标注：自由涂画 + 缩放平移 + 裁切 + 撤销/重做。
 *
 * 笔画用矢量保存（颜色/粗细/点序列），撤销重做只需重绘，不吃内存；
 * 裁切会把当前笔画并进底图再裁剪。多指按下时立刻结束当前笔画，
 * 避免两指之间连出一条直线，也让缩放不被误判成画笔。
 */
export const ImageEditor = ({ file, onDone, onCancel }: Props) => {
  const t = useTranslate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)

  const [ready, setReady] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [redoStack, setRedoStack] = useState<Stroke[]>([])
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [crop, setCrop] = useState<Rect | null>(null)
  const [version, setVersion] = useState(0)
  /** 画布可用区域（像素）：图片按它做等比缩放，尽量铺满屏幕 */
  const [box, setBox] = useState({ w: 0, h: 0 })

  // 返回键 / 侧滑返回：裁切中先退出裁切，否则关闭编辑器
  useEffect(
    () =>
      pushBackHandler(() => {
        if (crop) {
          setCrop(null)
          return
        }
        onCancel()
      }),
    [crop, onCancel]
  )

  const drawing = useRef<{ id: number; points: Point[] } | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{
    distance: number
    scale: number
    mid: Point
    x: number
    y: number
  } | null>(null)
  const cropDrag = useRef<
    { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; start: Point; rect: Rect } | null
  >(null)

  /** 把 base 图 + 所有笔画画到可见 canvas 上 */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const base = baseRef.current
    if (!canvas || !base) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(base, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const paint = (stroke: Stroke) => {
      if (stroke.points.length === 0) {
        return
      }
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.beginPath()
      const [first, ...rest] = stroke.points
      ctx.moveTo(first.x, first.y)
      if (rest.length === 0) {
        // 单点也要留下一个圆点
        ctx.lineTo(first.x + 0.01, first.y + 0.01)
      } else {
        for (const point of rest) {
          ctx.lineTo(point.x, point.y)
        }
      }
      ctx.stroke()
    }
    for (const stroke of strokes) {
      paint(stroke)
    }
    // 正在画的这一笔也要实时显示；单点不画，避免手指刚落下就留下墨点
    const active = drawing.current
    if (active && active.points.length > 1) {
      paint({ color: PEN_COLOR, width: PEN_WIDTH, points: active.points })
    }
  }, [strokes])

  useEffect(() => {
    redraw()
  }, [redraw, version])

  /** 载入图片：等比缩放到 MAX_SIDE 以内 */
  const loadImage = useCallback((source: CanvasImageSource, width: number, height: number) => {
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
    baseRef.current = canvas
    const visible = canvasRef.current
    if (visible) {
      visible.width = canvas.width
      visible.height = canvas.height
    }
    setStrokes([])
    setRedoStack([])
    setView({ scale: 1, x: 0, y: 0 })
    setCrop(null)
    setVersion((value) => value + 1)
    setReady(true)
  }, [])

  useEffect(() => {
    let url = ''
    const image = new Image()
    image.onload = () => loadImage(image, image.naturalWidth, image.naturalHeight)
    url = URL.createObjectURL(file)
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [file, loadImage])

  /** 量出可用区域，图片据此铺满（不用百分比设上限，避免 flex 高度解析不到） */
  useEffect(() => {
    const element = wrapRef.current
    if (!element) {
      return
    }
    const measure = () => setBox({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /** 屏幕坐标 → 图片像素坐标（rect 已包含 CSS 缩放） */
  const toImagePoint = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current
    if (!canvas) {
      return { x: 0, y: 0 }
    }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    }
  }, [])

  const endStroke = useCallback(() => {
    const active = drawing.current
    drawing.current = null
    if (!active || active.points.length === 0) {
      return
    }
    setStrokes((current) => [
      ...current,
      { color: PEN_COLOR, width: PEN_WIDTH, points: active.points },
    ])
    setRedoStack([])
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!ready) {
      return
    }
    // 主指针按下说明是一轮新的触摸：清掉可能残留的旧指针，
    // 避免个别机型漏发 pointerup 后把单指绘制误判成双指缩放
    if (event.isPrimary) {
      pointers.current.clear()
      pinch.current = null
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    // 第二根手指落下 → 结束当前笔画，转入缩放，绝不在两指之间连线。
    // 只有「已经拖动过」的笔画才保留，刚落下就被第二指打断的不留墨点。
    if (pointers.current.size > 1) {
      const active = drawing.current
      drawing.current = null
      if (active && active.points.length > 1) {
        setStrokes((current) => [
          ...current,
          { color: PEN_COLOR, width: PEN_WIDTH, points: active.points },
        ])
        setRedoStack([])
      } else {
        // 丢掉被打断的单点，同时清掉可能已经画上去的预览
        setVersion((value) => value + 1)
      }
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        x: view.x,
        y: view.y,
      }
      return
    }
    const point = toImagePoint(event.clientX, event.clientY)
    if (crop) {
      const handle = hitHandle(crop, point)
      cropDrag.current = {
        mode: handle ?? (inside(crop, point) ? 'move' : 'nw'),
        start: point,
        rect: crop,
      }
      if (!handle && !inside(crop, point)) {
        cropDrag.current = null
      }
      return
    }
    drawing.current = { id: event.pointerId, points: [point] }
    setVersion((value) => value + 1)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!pointers.current.has(event.pointerId)) {
      return
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const start = pinch.current
      const scale = clamp((distance / start.distance) * start.scale, 1, 5)
      // 双指同时平移：按两指中点位移移动画面，放大后能拖到图片边缘
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const canvas = canvasRef.current
      const maxX = canvas ? (canvas.offsetWidth * (scale - 1)) / 2 : Infinity
      const maxY = canvas ? (canvas.offsetHeight * (scale - 1)) / 2 : Infinity
      setView({
        scale,
        x: clamp(start.x + (mid.x - start.mid.x), -maxX, maxX),
        y: clamp(start.y + (mid.y - start.mid.y), -maxY, maxY),
      })
      return
    }

    const point = toImagePoint(event.clientX, event.clientY)

    if (cropDrag.current) {
      const { mode, start, rect } = cropDrag.current
      const dx = point.x - start.x
      const dy = point.y - start.y
      if (mode === 'move') {
        setCrop({
          ...rect,
          x: clamp(rect.x + dx, 0, (baseRef.current?.width ?? 0) - rect.w),
          y: clamp(rect.y + dy, 0, (baseRef.current?.height ?? 0) - rect.h),
        })
      } else {
        setCrop(resizeRect(rect, mode, dx, dy))
      }
      return
    }

    const active = drawing.current
    if (!active || active.id !== event.pointerId) {
      return
    }
    const last = active.points.at(-1)
    if (!last || farEnough(last, point)) {
      active.points.push(point)
      setVersion((value) => value + 1)
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) {
      pinch.current = null
    }
    if (drawing.current?.id === event.pointerId) {
      endStroke()
    }
    if (pointers.current.size === 0) {
      cropDrag.current = null
    }
  }

  const undo = () => {
    setStrokes((current) => {
      if (current.length === 0) {
        return current
      }
      const last = current.at(-1) as Stroke
      setRedoStack((stack) => [...stack, last])
      return current.slice(0, -1)
    })
  }

  const redo = () => {
    setRedoStack((stack) => {
      if (stack.length === 0) {
        return stack
      }
      const last = stack.at(-1) as Stroke
      setStrokes((current) => [...current, last])
      return stack.slice(0, -1)
    })
  }

  /** 裁切：把当前笔画并进底图，再按选框裁剪 */
  const applyCrop = () => {
    const base = baseRef.current
    if (!base || !crop) {
      return
    }
    const merged = document.createElement('canvas')
    merged.width = base.width
    merged.height = base.height
    const mergedCtx = merged.getContext('2d')
    if (!mergedCtx) {
      return
    }
    mergedCtx.drawImage(base, 0, 0)
    mergedCtx.lineCap = 'round'
    mergedCtx.lineJoin = 'round'
    for (const stroke of strokes) {
      mergedCtx.strokeStyle = stroke.color
      mergedCtx.lineWidth = stroke.width
      mergedCtx.beginPath()
      const [first, ...rest] = stroke.points
      mergedCtx.moveTo(first.x, first.y)
      for (const point of rest) {
        mergedCtx.lineTo(point.x, point.y)
      }
      mergedCtx.stroke()
    }
    const x = Math.round(clamp(crop.x, 0, merged.width - 1))
    const y = Math.round(clamp(crop.y, 0, merged.height - 1))
    const w = Math.round(clamp(crop.w, 1, merged.width - x))
    const h = Math.round(clamp(crop.h, 1, merged.height - y))
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d')?.drawImage(merged, x, y, w, h, 0, 0, w, h)
    loadImage(out, w, h)
  }

  const handleDone = () => {
    redraw()
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    canvas.toBlob((blob) => {
      if (blob) {
        const base = file.name.replace(/\.[^.]+$/, '')
        onDone(new File([blob], `${base}_marked.png`, { type: 'image/png' }))
      }
    }, 'image/png')
  }

  return createPortal(
    <div className={styles.overlay} data-ds-no-swipe="">
      <div className={styles.panel}>
        {/* 顶部：左关闭 · 中间撤销/重做 · 右裁切 */}
        <div className={styles.topBar}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t('cancel')}
            onClick={onCancel}
          >
            <IconCloseOutline20 />
          </button>

          <div className={styles.centerActions}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('editorUndo')}
              disabled={strokes.length === 0}
              onClick={undo}
            >
              <IconUndoOutline20 />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('editorRedo')}
              disabled={redoStack.length === 0}
              onClick={redo}
            >
              <IconRedoOutline20 />
            </button>
          </div>

          <button
            type="button"
            className={`${styles.iconButton} ${crop ? styles.iconButtonActive : ''}`}
            aria-label={t('editorCrop')}
            disabled={!ready}
            onClick={() =>
              setCrop(
                crop
                  ? null
                  : { x: 0, y: 0, w: baseRef.current?.width ?? 0, h: baseRef.current?.height ?? 0 }
              )
            }
          >
            <IconCropOutline20 />
          </button>
        </div>

        {/* 图像展示：占据剩余全部高度 */}
        <div ref={wrapRef} className={styles.canvasWrap}>
          <div
            className={styles.stage}
            style={{
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
            }}
          >
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              data-strokes={strokes.length}
              data-scale={view.scale}
              style={{
                maxWidth: box.w > 0 ? `${box.w}px` : undefined,
                maxHeight: box.h > 0 ? `${box.h}px` : undefined,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
            />
            {crop ? (
              <CropOverlay
                crop={crop}
                imageWidth={baseRef.current?.width ?? 0}
                imageHeight={baseRef.current?.height ?? 0}
              />
            ) : null}
          </div>
          {!ready ? <div className={styles.loading}>…</div> : null}
        </div>

        {/* 底部：裁切模式给取消/应用，普通模式右下角确认 */}
        <div className={styles.footer}>
          {crop ? (
            <>
              <span className={styles.cropHint}>{t('editorCropHint')}</span>
              <button type="button" className={styles.textButton} onClick={() => setCrop(null)}>
                {t('cancel')}
              </button>
              <button type="button" className={styles.confirmButton} onClick={applyCrop}>
                {t('editorCropApply')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.confirmButton}
              aria-label={t('editorConfirm')}
              disabled={!ready}
              onClick={handleDone}
            >
              <IconCheckOutline20 />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

const inside = (rect: Rect, point: Point) =>
  point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h

/** 命中裁切框角上的把手（按图片像素计，30px 容差） */
const hitHandle = (rect: Rect, point: Point): 'nw' | 'ne' | 'sw' | 'se' | null => {
  const size = Math.max(24, Math.min(rect.w, rect.h) * 0.12)
  const corners: [string, Point][] = [
    ['nw', { x: rect.x, y: rect.y }],
    ['ne', { x: rect.x + rect.w, y: rect.y }],
    ['sw', { x: rect.x, y: rect.y + rect.h }],
    ['se', { x: rect.x + rect.w, y: rect.y + rect.h }],
  ]
  for (const [name, corner] of corners) {
    if (Math.abs(point.x - corner.x) <= size && Math.abs(point.y - corner.y) <= size) {
      return name as 'nw' | 'ne' | 'sw' | 'se'
    }
  }
  return null
}

const resizeRect = (rect: Rect, mode: 'nw' | 'ne' | 'sw' | 'se', dx: number, dy: number): Rect => {
  let { x, y, w, h } = rect
  if (mode === 'nw' || mode === 'sw') {
    x += dx
    w -= dx
  } else {
    w += dx
  }
  if (mode === 'nw' || mode === 'ne') {
    y += dy
    h -= dy
  } else {
    h += dy
  }
  if (w < 24) {
    w = 24
  }
  if (h < 24) {
    h = 24
  }
  return { x, y, w, h }
}

/** 裁切选框（绝对定位在 stage 内，随缩放一起变换） */
const CropOverlay = ({
  crop,
  imageWidth,
  imageHeight,
}: {
  crop: Rect
  imageWidth: number
  imageHeight: number
}) => (
  <div className={styles.cropOverlay} aria-hidden>
    <div
      className={styles.cropRect}
      style={{
        left: `${(crop.x / imageWidth) * 100}%`,
        top: `${(crop.y / imageHeight) * 100}%`,
        width: `${(crop.w / imageWidth) * 100}%`,
        height: `${(crop.h / imageHeight) * 100}%`,
      }}
    >
      <span className={`${styles.handle} ${styles.handleNw}`} />
      <span className={`${styles.handle} ${styles.handleNe}`} />
      <span className={`${styles.handle} ${styles.handleSw}`} />
      <span className={`${styles.handle} ${styles.handleSe}`} />
    </div>
  </div>
)
