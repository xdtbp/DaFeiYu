import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { useProgress } from '../../services/chat/progress.js'
import styles from '../settings/Settings.module.css'

/** 导入 / 导出进度条：显示百分比与「已处理/总数」，让用户知道还要等多久 */
export const HistoryProgress = ({ kind }: { kind: 'import' | 'export' }) => {
  const t = useTranslate()
  const progress = useProgress()
  const reading = kind === 'import' && progress.kind === 'reading'
  if (progress.kind !== kind && !reading) {
    return null
  }
  const percent = Math.round((reading ? 0 : progress.value) * 100)
  return (
    <div className={styles.progress}>
      <div className={styles.progressTrack}>
        <div
          className={clsx(styles.progressFill, reading && styles.progressIndeterminate)}
          style={reading ? undefined : { width: `${percent}%` }}
        />
      </div>
      <span className={styles.progressText}>
        {reading ? t('importReading') : progress.detail || `${percent}%`}
      </span>
    </div>
  )
}
