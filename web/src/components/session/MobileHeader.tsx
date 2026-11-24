import {
  IconMenuOutline20,
  IconNewChatOutline20,
  IconSettingsOutline16,
} from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { scrollSiderToTop } from '../sider/siderListControl.js'
import { IconButton } from '../base/IconButton.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：菜单开侧边栏；显示标题；右侧新建对话与设置 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      <div className={styles.title}>{title ?? ''}</div>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconNewChatOutline20 />}
        aria-label={t('newChat')}
        onClick={() => {
          scrollSiderToTop()
          newChat()
        }}
      />
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconSettingsOutline16 />}
        aria-label={t('settings')}
        onClick={() => openSettings('general')}
      />
    </div>
  )
}
