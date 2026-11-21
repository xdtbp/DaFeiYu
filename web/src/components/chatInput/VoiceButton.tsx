import clsx from 'clsx'
import { useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconMicFill16, IconMicOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import type { VoiceInputStatus } from './useVoiceInput.js'
import styles from './VoiceButton.module.css'

/**
 * 语音输入按钮（按住说话）。
 * 按住开始录音、松手结束并转写；按住时上滑一段距离取消本次输入。
 * 录音中为两层圆：外层半透明光圈 + 内层实心品牌色；
 * 外层先展开、内层随后放大，之后外层按固定节奏呼吸，与音量无关。
 * 按钮左侧显示「录音中 Ns」，窄屏不展示读秒。
 */
export const VoiceButton = ({
  status,
  disabled = false,
  seconds,
  onStart,
  onFinish,
  onCancel,
}: {
  status: VoiceInputStatus
  /** 非安全上下文中按钮置灰，tooltip 提示录音需要 HTTPS */
  disabled?: boolean
  /** 本次录音已录秒数，录音中显示在按钮左侧 */
  seconds: number
  onStart: () => void
  onFinish: () => void
  onCancel: () => void
}) => {
  const t = useTranslate()
  const recording = status === 'recording'
  const startYRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)

  const label = disabled
    ? t('voiceInputRequiresHttps')
    : recording
      ? t('voiceReleaseToFinish')
      : status === 'transcribing'
        ? t('voiceInputCancel')
        : t('voiceHoldToRecord')

  return (
    <>
      {recording ? <span className={styles.timer}>{t('voiceInputTimer', { seconds })}</span> : null}
      <Tooltip content={label}>
        <button
          type="button"
          className={clsx(
            styles.button,
            recording && styles.recording,
            disabled && styles.disabled
          )}
          aria-label={label}
          aria-pressed={recording}
          aria-disabled={disabled}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) {
              return
            }
            startYRef.current = event.clientY
            cancelledRef.current = false
            onStart()
          }}
          onPointerMove={(event) => {
            const startY = startYRef.current
            if (startY === null || cancelledRef.current) {
              return
            }
            // 按住时上滑超过 48px 视为取消
            if (startY - event.clientY > 48) {
              cancelledRef.current = true
              onCancel()
            }
          }}
          onPointerUp={() => {
            const wasActive = startYRef.current !== null
            startYRef.current = null
            if (wasActive && !cancelledRef.current) {
              onFinish()
            }
          }}
          onPointerCancel={() => {
            startYRef.current = null
            if (!cancelledRef.current) {
              onCancel()
            }
          }}
        >
          {recording ? (
            <span className={styles.active}>
              <span className={styles.halo} />
              <span className={styles.core} />
              <span className={styles.outline}>
                <IconMicOutline16 />
              </span>
              <span className={styles.glyph}>
                <IconMicFill16 />
              </span>
            </span>
          ) : status === 'transcribing' ? (
            <span className={styles.loading} />
          ) : (
            <IconMicOutline16 />
          )}
        </button>
      </Tooltip>
    </>
  )
}
