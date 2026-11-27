import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPinOutline16,
  IconSelectAllOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import { isPinned, togglePinned, usePinnedSessions } from '../../services/chat/pins.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  selectionMode = false,
  selected = false,
  onDelete,
  onToggleSelect,
  onMultiSelect,
  onSelect,
}: {
  session: SessionSummary
  active: boolean
  selectionMode?: boolean
  selected?: boolean
  onDelete: (id: string) => void
  onToggleSelect?: (id: string) => void
  onMultiSelect?: (id: string) => void
  onSelect?: (id: string) => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  // 订阅置顶列表，菜单里的「置顶 / 取消置顶」文案跟着变
  usePinnedSessions((state) => state.pinned)
  const pinned = isPinned(session.id)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(
        styles.item,
        active && !selectionMode && styles.active,
        selectionMode && styles.selectable,
        selected && styles.selected
      )}
      data-session-id={session.id}
      onClick={() => {
        if (selectionMode) {
          onToggleSelect?.(session.id)
          return
        }
        if (onSelect) {
          onSelect(session.id)
          return
        }
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      {selectionMode ? (
        <span className={clsx(styles.check, selected && styles.checkOn)} aria-hidden>
          {selected ? <IconCheckOutline16 /> : null}
        </span>
      ) : null}
      <div className={styles.title}>{displayTitle}</div>
      {selectionMode ? null : (
        <div className={styles.action} onClick={(event) => event.stopPropagation()}>
          <Menu
            options={[
              {
                key: 'rename',
                label: t('sessionItemMenuRenameOption'),
                icon: <IconEditOutline16 />,
                onSelect: () => setEditing(true),
              },
              {
                key: 'select',
                label: t('sessionMenuMultiSelect'),
                icon: <IconSelectAllOutline16 />,
                onSelect: () => onMultiSelect?.(session.id),
              },
              {
                key: 'pin',
                label: pinned ? t('sessionMenuUnpin') : t('sessionMenuPin'),
                icon: <IconPinOutline16 />,
                onSelect: () => togglePinned(session.id),
              },
              {
                key: 'delete',
                label: t('delete'),
                icon: <IconTrashOutline16 />,
                danger: true,
                onSelect: () => onDelete(session.id),
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
            )}
          </Menu>
        </div>
      )}
    </div>
  )
})
