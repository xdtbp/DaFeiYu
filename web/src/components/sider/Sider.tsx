import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { removeSession, selectSession, useChatStore } from '../../services/chat/store.js'
import { searchHistory, type SearchMatch } from '../../services/chat/search.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { AccountFooter } from './AccountFooter.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 侧边栏会话列表每次渲染的条数；滚动到底部附近继续追加 */
const PAGE_SIZE = 40

/** 展开的侧边栏：名称与收起按钮、搜索历史、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const appName = t('appName')
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  // 会话可能有上千条，一次全量渲染会把抽屉动画拖到卡死：按页增量渲染
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [sessions.length, query])

  const limitedGroups = useMemo(() => {
    let remaining = visibleCount
    const out: typeof groups = []
    for (const group of groups) {
      if (remaining <= 0) {
        break
      }
      const take = Math.min(remaining, group.sessions.length)
      remaining -= take
      out.push(take === group.sessions.length ? group : { ...group, sessions: group.sessions.slice(0, take) })
    }
    return out
  }, [groups, visibleCount])

  const onListScroll = useCallback(() => {
    const element = listRef.current
    if (!element) {
      return
    }
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 320) {
      setVisibleCount((count) => (count >= sessions.length ? count : count + PAGE_SIZE))
    }
  }, [sessions.length])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // 搜索防抖：输入停止 250ms 后遍历所有会话搜索，新输入会取消上一次
  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchHistory(keyword, controller.signal)
        .then((matches) => {
          if (!controller.signal.aborted) {
            setResults(matches)
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearching(false)
          }
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const searchingMode = query.trim().length > 0

  const openResult = (sessionId: string) => {
    selectSession(sessionId)
    closeMobileSider()
    setQuery('')
  }

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{appName}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <div className={styles.searchBox}>
        <span className={styles.searchIcon}>
          <IconSearchOutline16 />
        </span>
        <input
          className={styles.searchInput}
          type="text"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('searchHistoryPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className={styles.listWrap}>
        {searchingMode ? (
          <div className={styles.searchResults}>
            {results.length === 0 ? (
              <div className={styles.searchEmpty}>
                {searching ? t('searchHistorySearching') : t('searchHistoryNoResult')}
              </div>
            ) : (
              results.map((match, index) => (
                <button
                  key={`${match.sessionId}:${match.kind}:${index}`}
                  type="button"
                  className={styles.searchItem}
                  onClick={() => openResult(match.sessionId)}
                >
                  <div className={styles.searchItemHead}>
                    <span className={styles.searchItemTitle}>{match.sessionTitle}</span>
                    {match.kind === 'user' ? (
                      <span className={styles.roleBadge}>{t('searchHistoryRoleUser')}</span>
                    ) : match.kind === 'assistant' ? (
                      <span className={clsx(styles.roleBadge, styles.roleBadgeAi)}>
                        {t('searchHistoryRoleAi')}
                      </span>
                    ) : null}
                  </div>
                  <span className={styles.searchSnippet}>{match.snippet}</span>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className={styles.list} ref={listRef} onScroll={onListScroll}>
            {limitedGroups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    onDelete={() => setDeleting(session)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <AccountFooter />
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
