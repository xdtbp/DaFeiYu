import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import coverLogo from '../../assets/cover.png'
import deepseekLogo from '../../assets/deepseek.svg'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：品牌标识 + 问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const official = useSettings((state) => state.appTheme) === 'official'
  const size = isMobile ? 92 : 104
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.heroArea}>
          <img
            className={styles.logo}
            src={official ? deepseekLogo : coverLogo}
            alt=""
            style={{ width: size, height: size }}
          />
          <div className={styles.greeting}>
            {official ? t('welcomeMessageOfficial') : t('welcomeMessageChat250808')}
          </div>
        </div>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
