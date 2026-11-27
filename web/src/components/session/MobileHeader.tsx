import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutline14,
  IconMenuOutline20,
  IconNewChatOutline20,
  IconSettingsOutline16,
} from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import type { Message } from '../../services/chat/types.js'
import { scrollSiderToTop } from '../sider/siderListControl.js'
import { IconButton } from '../base/IconButton.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import { scrollToMessage } from '../messages/scrollControl.js'
import styles from './MobileHeader.module.css'

/** 菜单一条：只列用户自己发过的话 */
const userText = (message: Message): string => {
  if (message.role !== 'user') {
    return ''
  }
  const text = message.content.replace(/\s+/g, ' ').trim()
  if (text) {
    return text
  }
  return message.files.length > 0 ? '[图片/文件]' : ''
}

/** 移动端顶栏：菜单开侧边栏；标题可展开「我发过的消息」列表；右侧新建对话与设置 */
export const MobileHeader = ({ title, messages }: { title?: string; messages?: Message[] }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)

  const items = useMemo(
    () =>
      (messages ?? [])
        .map((message) => ({ id: message.id, text: userText(message) }))
        .filter((item) => item.text !== ''),
    [messages]
  )

  const close = useCallback(() => {
    if (!open) {
      return
    }
    setOpen(false)
    setClosing(true)
    window.setTimeout(() => setClosing(false), 180)
  }, [open])

  // 点列表以外的地方收起
  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        close()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, close])

  const jumpTo = (id: string) => {
    close()
    // 交给 MessageList 处理：它会在滚动前退出底部跟随，避免长距离跳转被拽回底部。
    // 略延迟让收起动画起步，但不超过 closing 的 180ms。
    window.setTimeout(() => scrollToMessage(id), 60)
  }

  const expandable = items.length > 0

  return (
    <div ref={headerRef} className={styles.wrap}>
      <div className={styles.header}>
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconMenuOutline20 />}
          aria-label={t('expandSiderbarButton')}
          onClick={openMobileSider}
        />
        <div className={styles.titleWrap}>
        {expandable ? (
          <button
            type="button"
            className={clsx(styles.titleButton, open && styles.titleButtonOpen)}
            aria-expanded={open}
            aria-label={t('sessionJumpToMessage')}
            onClick={() => (open ? close() : setOpen(true))}
          >
            <span className={styles.titleText}>{title ?? ''}</span>
            <span className={styles.chevron} aria-hidden>
              <IconChevronDownOutline14 />
            </span>
          </button>
        ) : (
          <div className={styles.title}>
            <span className={styles.titleText}>{title ?? ''}</span>
          </div>
        )}
        {open || closing ? (
          <div
            className={clsx(styles.jumpPanel, !open && closing && styles.jumpPanelClosing)}
            role="menu"
            aria-label={t('sessionJumpToMessage')}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={styles.jumpItem}
                onClick={() => jumpTo(item.id)}
              >
                {item.text}
              </button>
            ))}
          </div>
        ) : null}
        </div>
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconNewChatOutline20 />}
          aria-label={t('newChat')}
          onClick={() => {
            close()
            scrollSiderToTop()
            newChat()
          }}
        />
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconSettingsOutline16 />}
          aria-label={t('settings')}
          onClick={() => {
            close()
            openSettings('general')
          }}
        />
      </div>
    </div>
  )
}
