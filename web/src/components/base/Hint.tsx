import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import styles from './Hint.module.css'

/**
 * 小问号 + 气泡说明。
 *
 * 统一成「对话金额估计」那一套：14px 的细圈 ?、11px 正文、带缩放淡入的动画。
 * 点击出现，点空白处或再点一次收起。
 */
export const Hint = ({
  text,
  placement = 'right',
}: {
  text: string
  /** right：气泡在问号右侧（设置行里用）；top：气泡在上方（正文里用） */
  placement?: 'right' | 'top'
}) => {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

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
      {open ? (
        <span role="tooltip" className={clsx(styles.tip, placement === 'top' && styles.tipTop)}>
          {text}
        </span>
      ) : null}
    </span>
  )
}
