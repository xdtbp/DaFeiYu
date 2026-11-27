import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import styles from './Hint.module.css'

/** 与可视边缘的最小间距 */
const MARGIN = 8
/** 气泡与问号的间距 */
const GAP = 6

type Placement = 'right' | 'top'

type TipPosition = { top: number; left: number; maxWidth: number; maxHeight: number }

/**
 * 可视边距：以 visualViewport 为准（移动端键盘弹起、页面缩放时会小于布局视口），
 * 包含它相对布局视口的偏移；没有时退回 window 布局视口。
 * 判断气泡是否出界必须用它，不能用 window.innerWidth/innerHeight——那是「屏幕」布局尺寸，
 * 不是用户真正看得见的那块区域。
 */
const visibleRect = () => {
  const vv = window.visualViewport
  if (vv) {
    return {
      left: vv.offsetLeft,
      top: vv.offsetTop,
      right: vv.offsetLeft + vv.width,
      bottom: vv.offsetTop + vv.height,
      width: vv.width,
      height: vv.height,
    }
  }
  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)))

/**
 * 按可视边距摆放气泡，四面都收进可视区：
 * - right：优先问号右侧，右边放不下翻到左侧；两侧都放不下就贴边并靠 maxWidth 收缩。
 * - top：优先问号上方，上方放不下翻到下方；上下都放不下就贴边并靠 maxHeight 收缩。
 */
const measurePosition = (
  anchor: DOMRect,
  tip: HTMLElement,
  placement: Placement
): TipPosition => {
  const view = visibleRect()
  const naturalWidth = tip.scrollWidth
  const naturalHeight = tip.scrollHeight
  const maxWidth = Math.max(120, Math.min(240, view.width - MARGIN * 2))
  const maxHeight = Math.max(80, view.height - MARGIN * 2)

  const width = Math.min(naturalWidth, maxWidth)
  const height = Math.min(naturalHeight, maxHeight)

  let left: number
  let top: number

  if (placement === 'right') {
    // 右侧优先，垂直居中；放不下就挪到问号下方——绝不翻到左侧，
    // 否则气泡会盖住问号按钮本身。
    const rightSide = anchor.right + GAP
    if (rightSide + width <= view.right - MARGIN) {
      left = rightSide
      top = anchor.top + anchor.height / 2 - height / 2
    } else {
      left = anchor.left
      top = anchor.bottom + GAP
      // 下方也不够时退到上方，纵向错开按钮而不是压在它上面
      if (top + height > view.bottom - MARGIN) {
        top = Math.max(view.top + MARGIN, anchor.top - GAP - height)
      }
    }
  } else {
    // 上方优先；放不下挪到下方，纵向始终与问号错开
    const above = anchor.top - GAP - height
    const below = anchor.bottom + GAP
    if (above >= view.top + MARGIN) {
      left = anchor.right - width
      top = above
    } else {
      left = anchor.left
      top = below + height <= view.bottom - MARGIN ? below : view.bottom - MARGIN - height
    }
  }

  return {
    left: clamp(left, view.left + MARGIN, view.right - MARGIN - width),
    top: clamp(top, view.top + MARGIN, view.bottom - MARGIN - height),
    maxWidth,
    maxHeight,
  }
}

/**
 * 小问号 + 气泡说明。
 *
 * 气泡挂在 body 上按可视视口坐标定位，不受滚动容器裁切；展开后按 visualViewport
 * 的可视边距测量一次，出界就翻边并把长文案收进可视区。
 */
export const Hint = ({ text, placement = 'right' }: { text: string; placement?: Placement }) => {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TipPosition | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  // 展开时同步测量；文案、方向、视口或气泡尺寸变化都重新量，保证长文案不越界
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const update = () => {
      const anchor = wrapRef.current
      const tip = tipRef.current
      if (!anchor || !tip) {
        return
      }
      const next = measurePosition(anchor.getBoundingClientRect(), tip, placement)
      setPosition((previous) =>
        previous &&
        previous.top === next.top &&
        previous.left === next.left &&
        previous.maxWidth === next.maxWidth &&
        previous.maxHeight === next.maxHeight
          ? previous
          : next
      )
    }
    update()
    const tip = tipRef.current
    let observer: ResizeObserver | null = null
    if (tip) {
      observer = new ResizeObserver(update)
      observer.observe(tip)
    }
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open, placement, text])

  return (
    <span ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.button}
        aria-label={text}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        ?
      </button>
      {open
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              className={clsx(styles.tip, !position && styles.tipMeasuring)}
              style={
                position
                  ? {
                      top: position.top,
                      left: position.left,
                      maxWidth: position.maxWidth,
                      maxHeight: position.maxHeight,
                    }
                  : undefined
              }
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </span>
  )
}
