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
import { pinSessions, unpinSessions, usePinnedSessions } from '../../services/chat/pins.js'
import { removeSession, selectSession, useChatStore } from '../../services/chat/store.js'
import { searchHistory, type SearchMatch } from '../../services/chat/search.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, siderOffset, SIDER_WIDTH, useMobileSider } from './mobileSiderState.js'
import { AccountFooter } from './AccountFooter.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 侧边栏会话列表每次渲染的条数；滚动到底部附近继续追加 */
const PAGE_SIZE = 40

/** 置顶分组的 key，永远排在所有时间分组之前 */
const PINNED_GROUP_KEY = '__pinned'

type SiderGroup = {
  key: string
  label: string
  sessions: SessionSummary[]
  /** 置顶分组：顶部固定，样式与时间分组一致 */
  pinned?: boolean
}

/** 展开的侧边栏：名称与收起按钮、搜索历史、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const pinnedIds = usePinnedSessions((state) => state.pinned)
  /** 置顶分组永远在最前，其余仍是今天 / 昨天 / 7 天内… */
  const allGroups = useMemo<SiderGroup[]>(() => {
    const byId = new Map(sessions.map((session) => [session.id, session]))
    const pinnedSessions = pinnedIds
      .map((id) => byId.get(id))
      .filter((session): session is SessionSummary => Boolean(session))
    const pinnedSet = new Set(pinnedSessions.map((session) => session.id))
    const rest: SiderGroup[] = groups
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter((session) => !pinnedSet.has(session.id)),
      }))
      .filter((group) => group.sessions.length > 0)
    return pinnedSessions.length > 0
      ? [
          {
            key: PINNED_GROUP_KEY,
            label: t('sessionPinnedGroup'),
            sessions: pinnedSessions,
            pinned: true,
          },
          ...rest,
        ]
      : rest
  }, [groups, pinnedIds, sessions, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkPending, setBulkPending] = useState(false)
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
    const out: SiderGroup[] = []
    for (const group of allGroups) {
      if (remaining <= 0) {
        break
      }
      const take = Math.min(remaining, group.sessions.length)
      remaining -= take
      out.push(take === group.sessions.length ? group : { ...group, sessions: group.sessions.slice(0, take) })
    }
    return out
  }, [allGroups, visibleCount])

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedIds([])
  }

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

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
      </div>
      {selectionMode ? (
        <div className={styles.selectionBar}>
          <div className={styles.selectionHead}>
            <span className={styles.selectionCount}>
              {t('sessionSelectedCount', { count: String(selectedIds.length) })}
            </span>
            <button type="button" className={styles.selectionCancel} onClick={exitSelection}>
              {t('cancel')}
            </button>
          </div>
          <div className={styles.selectionActions}>
            <button
              type="button"
              className={styles.selectionAction}
              disabled={selectedIds.length === 0}
              onClick={() => {
                pinSessions(selectedIds)
                exitSelection()
              }}
            >
              {t('sessionMenuPin')}
            </button>
            <button
              type="button"
              className={styles.selectionAction}
              disabled={selectedIds.length === 0}
              onClick={() => {
                unpinSessions(selectedIds)
                exitSelection()
              }}
            >
              {t('sessionMenuUnpin')}
            </button>
            <button
              type="button"
              className={clsx(styles.selectionAction, styles.selectionDanger)}
              disabled={selectedIds.length === 0}
              onClick={() => setBulkDeleteOpen(true)}
            >
              {t('delete')}
            </button>
          </div>
        </div>
      ) : null}
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
              <div
                key={group.key}
                className={clsx(styles.section, group.pinned && styles.pinnedSection)}
              >
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    selectionMode={selectionMode}
                    selected={selectedIds.includes(session.id)}
                    onToggleSelect={() => toggleSelected(session.id)}
                    onMultiSelect={() => setSelectionMode(true)}
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
        {mobile ? null : (
          <IconButton
            size="m"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            tooltipPlacement="top"
            className={styles.collapseButton}
            onClick={() => setSiderCollapsed(true)}
          />
        )}
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
      {bulkDeleteOpen ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!bulkPending) {
              setBulkDeleteOpen(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={bulkPending}
                onClick={() => setBulkDeleteOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={bulkPending}
                onClick={async () => {
                  setBulkPending(true)
                  try {
                    for (const id of selectedIds) {
                      await removeSession(id)
                    }
                    setBulkDeleteOpen(false)
                    exitSelection()
                  } finally {
                    setBulkPending(false)
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

/** 移动端抽屉：浮在页面上方，点空白区域关闭；拖动时跟手移动。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const drag = useMobileSider((state) => state.drag)
  const dragging = useMobileSider((state) => state.dragging)
  // 从拖动开始展开时不要再播放入场关键帧，否则松手会从 -100% 重新滑入
  const fromDragRef = useRef(false)
  if (drag !== null) {
    fromDragRef.current = true
  }
  useEffect(() => {
    if (!open && drag === null) {
      fromDragRef.current = false
    }
  }, [open, drag])
  if (!open && drag === null) {
    return null
  }
  // 与主界面共用同一个位移：抽屉右边缘始终贴着主界面左边缘
  const offset = siderOffset(open, drag)
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div
        className={styles.drawer}
        style={
          fromDragRef.current
            ? {
                transform: `translateX(${offset - SIDER_WIDTH}px)`,
                animation: 'none',
                // 只有手指拖动中才关过渡；松手后的开合仍要动画
                transition: dragging ? 'none' : undefined,
              }
            : undefined
        }
      >
        <Sider mobile />
      </div>
    </>
  )
}
