import { useState } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { Hint } from '../base/Hint.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import {
  compressBlobs,
  resolveSettings,
  useImageCompress,
  type CompressMode,
  type ImageFormat,
} from '../../services/imageCompress.js'
import { listFiles, replaceFileBlob } from '../../services/chat/db.js'
import { logError } from '../../services/log.js'
import styles from './Settings.module.css'

const MODES = [
  { value: 'lossless', label: 'compressLossless', desc: 'compressLosslessDesc' },
  { value: 'balanced', label: 'compressBalanced', desc: 'compressBalancedDesc' },
  { value: 'extreme', label: 'compressExtreme', desc: 'compressExtremeDesc', hint: 'compressExtremeHint' },
  { value: 'custom', label: 'compressCustom', desc: 'compressCustomDesc' },
] as const satisfies readonly { value: CompressMode; label: string; desc: string; hint?: string }[]

/** 一行滑块：左边标题，右边数值 */
const SliderRow = ({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  hint,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  hint?: string
  onChange: (value: number) => void
}) => (
  <div className={clsx(styles.compressRow, disabled && styles.compressRowDisabled)}>
    <div className={styles.compressRowHead}>
      <span className={styles.label}>
        {label}
        {hint ? <Hint text={hint} /> : null}
      </span>
      <span className={styles.compressValue}>
        {value}
        {suffix}
      </span>
    </div>
    <input
      type="range"
      className={styles.slider}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      aria-label={label}
    />
  </div>
)

/** 自定义参数：格式 / 分辨率 / 质量 / PNG 级别 / PNG 量化 */
const CustomParams = () => {
  const t = useTranslate()
  const custom = useImageCompress((state) => state.custom)
  const setCustom = useImageCompress((state) => state.setCustom)
  const isPng = custom.format === 'png' || custom.format === 'follow'
  const lossy = custom.format !== 'png'

  return (
    <div className={styles.compressCustom}>
      <div className={styles.compressRow}>
        <div className={styles.compressRowHead}>
          <span className={styles.label}>{t('compressFormat')}</span>
        </div>
        <Select
          ariaLabel={t('compressFormat')}
          value={custom.format}
          options={[
            { value: 'follow', label: t('compressFormatFollow') },
            { value: 'jpeg', label: 'JPG' },
            { value: 'png', label: 'PNG' },
            { value: 'webp', label: 'WebP' },
          ]}
          onChange={(value) => setCustom({ format: value as ImageFormat })}
        />
      </div>
      <SliderRow
        label={t('compressScale')}
        value={custom.scale}
        min={1}
        max={100}
        suffix="%"
        onChange={(scale) => setCustom({ scale })}
      />
      <SliderRow
        label={t('compressQuality')}
        value={custom.quality}
        min={1}
        max={100}
        disabled={!lossy}
        onChange={(quality) => setCustom({ quality })}
      />
      <SliderRow
        label={t('compressPngLevel')}
        value={custom.pngLevel}
        min={0}
        max={9}
        disabled={!isPng}
        onChange={(pngLevel) => setCustom({ pngLevel })}
      />
      <div className={clsx(styles.compressRow, !isPng && styles.compressRowDisabled)}>
        <div className={styles.compressRowHead}>
          <span className={styles.label}>{t('compressPngQuantize')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={custom.pngQuantize}
            aria-label={t('compressPngQuantize')}
            disabled={!isPng}
            className={clsx(styles.switch, custom.pngQuantize && styles.switchOn)}
            onClick={() => setCustom({ pngQuantize: !custom.pngQuantize })}
          >
            <span className={styles.switchKnob} />
          </button>
        </div>
        <input
          type="range"
          className={styles.slider}
          min={65}
          max={80}
          value={custom.pngQuantizeLevel}
          disabled={!isPng || !custom.pngQuantize}
          onChange={(event) => setCustom({ pngQuantizeLevel: Number(event.target.value) })}
          aria-label={t('compressPngQuantize')}
        />
      </div>
    </div>
  )
}

/** 压缩方式选择（无损 / 均衡 / 极限 / 自定义） */
const ModePicker = ({ value, onChange }: { value: CompressMode; onChange: (mode: CompressMode) => void }) => {
  const t = useTranslate()
  return (
    <div className={styles.subPageList}>
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={clsx(styles.relayChoice, value === mode.value && styles.relayChoiceOn)}
          onClick={() => onChange(mode.value)}
        >
          <span className={styles.compressModeTitle}>
            {t(mode.label)}
            {'hint' in mode && mode.hint ? <Hint text={t(mode.hint)} /> : null}
          </span>
          {mode.desc ? <span className={styles.description}>{t(mode.desc)}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** 压缩图片：全局默认参数 */
export const ImageCompressPage = () => {
  const t = useTranslate()
  const mode = useImageCompress((state) => state.mode)
  const setMode = useImageCompress((state) => state.setMode)
  return (
    <div className={styles.compressPage}>
      <div className={styles.description}>{t('compressPageDesc')}</div>
      <ModePicker value={mode} onChange={setMode} />
      {mode === 'custom' ? <CustomParams /> : null}
    </div>
  )
}

const THRESHOLDS = [
  { value: '200', label: '200 KB', bytes: 200 * 1024 },
  { value: '300', label: '300 KB', bytes: 300 * 1024 },
  { value: '400', label: '400 KB', bytes: 400 * 1024 },
  { value: '600', label: '600 KB', bytes: 600 * 1024 },
  { value: '1024', label: '1 MB', bytes: 1024 * 1024 },
  { value: '2048', label: '2 MB', bytes: 2 * 1024 * 1024 },
]

/** 聊天图片压缩：按阈值批量压本地已有图片 */
export const ChatImageCompressPage = () => {
  const t = useTranslate()
  // 这里的压缩方式只对本次批量操作生效，不去改全局默认
  const [mode, setMode] = useState<CompressMode>('balanced')
  const custom = useImageCompress((state) => state.custom)
  const [threshold, setThreshold] = useState('400')
  // 默认跳过已压过的图，避免反复压到糊
  const [skipCompressed, setSkipCompressed] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const run = async () => {
    setConfirming(false)
    setBusy(true)
    setProgress(t('compressRunning'))
    try {
      const all = await listFiles()
      // 打标的图不再重复压：多次压缩体积收益极小，画质掉得厉害
      const files = skipCompressed ? all.filter((file) => !file.compressedAt) : all
      const bytes = THRESHOLDS.find((item) => item.value === threshold)?.bytes ?? 400 * 1024
      const result = await compressBlobs(
        files,
        bytes,
        resolveSettings(mode, custom),
        ({ done, total }) => setProgress(t('compressProgress', { done: String(done), total: String(total) })),
        (id, blob) => replaceFileBlob(id, blob)
      )
      if (result.total === 0) {
        showToast({ key: 'compressNothing' })
      } else {
        const saved = (result.saved / 1024 / 1024).toFixed(2)
        showToast({ key: 'compressDone', params: { count: String(result.done), size: saved } })
      }
    } catch (error) {
      logError('compress', '压缩聊天图片失败', error)
      showToast({ key: 'compressFailed', type: 'error' })
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  return (
    <div className={styles.compressPage}>
      <div className={styles.compressRow}>
        <div className={styles.compressRowHead}>
          <span className={styles.label}>
            {t('compressThreshold')}
            <Hint text={t('compressThresholdHint')} />
          </span>
        </div>
        <Select
          ariaLabel={t('compressThreshold')}
          value={threshold}
          options={THRESHOLDS.map((item) => ({ value: item.value, label: item.label }))}
          onChange={setThreshold}
        />
      </div>

      <div className={styles.compressRow}>
        <div className={styles.compressRowHead}>
          <span className={styles.label}>
            {t('compressSkipDone')}
            <Hint text={t('compressSkipDoneHint')} />
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={skipCompressed}
            aria-label={t('compressSkipDone')}
            className={clsx(styles.switch, skipCompressed && styles.switchOn)}
            onClick={() => setSkipCompressed((value) => !value)}
          >
            <span className={styles.switchKnob} />
          </button>
        </div>
      </div>

      <div className={styles.compressSection}>{t('compressMode')}</div>
      <ModePicker value={mode} onChange={setMode} />
      {mode === 'custom' ? <CustomParams /> : null}

      <div className={styles.compressFooter}>
        <Button size="m" disabled={busy} onClick={() => setConfirming(true)}>
          {busy ? progress || t('compressRunning') : t('compressAction')}
        </Button>
      </div>

      {confirming ? (
        <Modal
          title={t('compressConfirmTitle')}
          closable
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setConfirming(false)}>
                {t('cancel')}
              </Button>
              <Button size="m" onClick={() => void run()}>
                {t('confirm')}
              </Button>
            </>
          }
        >
          <p>{t('compressConfirmBody')}</p>
        </Modal>
      ) : null}
    </div>
  )
}
