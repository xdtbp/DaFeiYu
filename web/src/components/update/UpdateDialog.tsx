import { useTranslate } from '../../i18n/index.js'
import type { UpdateInfo } from '../../services/update.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './UpdateDialog.module.css'

/**
 * 启动时发现新版本：可以前往更新、稍后再说，或跳过这个版本。
 * 跳过只屏蔽当前版本，等线上出现更高版本时仍会提示。
 */
export const UpdateDialog = ({
  info,
  onClose,
  onSkip,
}: {
  info: UpdateInfo
  onClose: () => void
  onSkip: () => void
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('updateFoundTitle')}
      closable
      className={styles.dialog}
      onClose={onClose}
      footer={
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={onSkip}>
            {t('updateSkipVersion')}
          </button>
          <div className={styles.right}>
            <Button variant="outlined" size="m" onClick={onClose}>
              {t('updateLater')}
            </Button>
            <Button
              size="m"
              onClick={() => {
                window.open(info.url, '_blank', 'noreferrer')
                onClose()
              }}
            >
              {t('updateNow')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.body}>
        <p className={styles.text}>{t('updateFoundDescription', { version: info.version })}</p>
        <p className={styles.hint}>{t('updateFoundHint')}</p>
      </div>
    </Modal>
  )
}
