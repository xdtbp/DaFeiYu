import { useState } from 'react'
import deepseekLogo from '../../assets/deepseek.svg'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import styles from './Onboarding.module.css'

const ACCEPTED_KEY = 'chat-demo:disclaimer-accepted'
const GITHUB_HOME = 'https://github.com/xdtbp/DaFeiYu'

/** 是否已经同意过免责与权限说明 */
export const isDisclaimerAccepted = (): boolean => {
  try {
    return localStorage.getItem(ACCEPTED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * 启动门槛：权限说明 + 免责声明 + 开源仓库。
 * 不同意则退出应用，同意后进入首次引导或主界面。
 */
export const DisclaimerGate = ({ onAccept }: { onAccept: () => void }) => {
  const t = useTranslate()
  const [declined, setDeclined] = useState(false)

  const accept = () => {
    try {
      localStorage.setItem(ACCEPTED_KEY, 'true')
    } catch {
      /* 隐私模式下写入失败时，本次会话内仍可使用 */
    }
    onAccept()
  }

  const decline = () => {
    setDeclined(true)
    const bridge = (window as unknown as { AndroidApp?: { exitApp?: () => void } }).AndroidApp
    bridge?.exitApp?.()
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.disclaimerCard}>
        <div className={styles.disclaimerBody}>
          <img className={styles.disclaimerLogo} src={deepseekLogo} alt="" />
          <h1 className={styles.title}>{t('disclaimerTitle')}</h1>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('disclaimerPermissionsTitle')}</h2>
            <ul className={styles.list}>
              <li>{t('disclaimerPermStorage')}</li>
              <li>{t('disclaimerPermMic')}</li>
              <li>{t('disclaimerPermNetwork')}</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('disclaimerNoticeTitle')}</h2>
            <p className={styles.descLeft}>{t('disclaimerNoticeBody')}</p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('disclaimerOpenSourceTitle')}</h2>
            <a className={styles.link} href={GITHUB_HOME} target="_blank" rel="noreferrer">
              {GITHUB_HOME}
            </a>
          </section>
        </div>

        <div className={styles.disclaimerFooter}>
          {declined ? <p className={styles.hintError}>{t('disclaimerDeclineHint')}</p> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.skip} onClick={decline}>
              {t('disclaimerDecline')}
            </button>
            <Button onClick={accept}>{t('disclaimerAccept')}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
