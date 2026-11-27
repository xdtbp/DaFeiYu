import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconLocateOutline16,
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { pinSessions, unpinSessions, usePinnedSessions } from '../../services/chat/pins.js'
import { removeSession, selectSession, useChatStore } from '../../services/chat/store.js'
import { searchHistory, type SearchMatch } from '../../services/chat/search.js'
import { syncAllRelays } from '../../services/relaySync.js'
import { useRelay } from '../../services/relay.js'
import { haptic } from '../../services/haptics.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { bindSiderElements, closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { setKeyboardResize } from '../../services/keyboard.js'
import {
  clearSiderReveal,
  registerSiderList,
  revealSiderSession,
  SIDER_PAGE_SIZE,
  useSiderListControl,
} from './siderListControl.js'
import { AccountFooter } from './AccountFooter.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

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
/** 下拉刷新阈值与阻尼：手指走 1px，指示器走 0.5px */
const PULL_THRESHOLD = 64

export const Sider = ({ mobile = false, open = true }: { mobile?: boolean; open?: boolean }) => {
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
  const searchingMode = query.trim().length > 0
  const [results, setResults] = useState<SearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  // 会话可能有上千条，一次全量渲染会把抽屉动画拖到卡死：按页增量渲染
  const [visibleCount, setVisibleCount] = useState(SIDER_PAGE_SIZE)
  // 首屏先不构建会话行：等页面空下来再渲染，避免和启动抢主线程
  const [listReady, setListReady] = useState(!mobile)

  // 用户急着打开抽屉时立刻补上，别让他看到空列表
  useEffect(() => {
    if (open && !listReady) {
      setListReady(true)
    }
  }, [open, listReady])

  // 用户急着打开抽屉时立刻补上，别让他看到空列表
  useEffect(() => {
    if (open && !listReady) {
      setListReady(true)
    }
  }, [open, listReady])

  useEffect(() => {
    if (listReady) {
      return
    }
    let cancelled = false
    const show = () => {
      if (!cancelled) {
        setListReady(true)
      }
    }
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
      }
    ).requestIdleCallback
    const timer = idle ? (idle(show, { timeout: 2000 }), null) : window.setTimeout(show, 1200)
    return () => {
      cancelled = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [listReady])
  // 待定位的会话：搜索命中后滚到视野中间
  const [pendingReveal, setPendingReveal] = useState<string | null>(null)
  /** 下拉指示器：直接改它的 style，不走 React 渲染，保证跟手 */
  const indicatorRef = useRef<HTMLDivElement>(null)
  const refreshingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const orderedIds = useMemo(
    () => allGroups.flatMap((group) => group.sessions.map((session) => session.id)),
    [allGroups]
  )

  // 列表常驻，滚动位置天然保留；只有搜索命中需要主动定位：
  // 先把目标所在的那一页渲染出来，再由下面的 layoutEffect 滚到中间。
  const reveal = useSiderListControl((state) => state.reveal)
  useEffect(() => {
    if (!reveal) {
      return
    }
    clearSiderReveal()
    const index = orderedIds.indexOf(reveal.id)
    if (index < 0) {
      return
    }
    // 多渲染半屏，目标下方才有内容，才能滚到视口中间而不是贴在底部
    setVisibleCount((prev) => Math.max(prev, index + 1 + Math.floor(SIDER_PAGE_SIZE / 2)))
    setPendingReveal(reveal.id)
  }, [reveal, orderedIds])

  useLayoutEffect(() => {
    if (!pendingReveal) {
      return
    }
    const element = listRef.current
    const target = element?.querySelector(`[data-session-id="${CSS.escape(pendingReveal)}"]`)
    if (!element || !(target instanceof HTMLElement)) {
      // 列表还没挂出来（搜索面板仍占据位置），等下一次渲染再看
      return
    }
    const listRect = element.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const desired =
      targetRect.top - listRect.top + element.scrollTop - (element.clientHeight - targetRect.height) / 2
    element.scrollTop = Math.max(0, desired)
    setPendingReveal(null)
  }, [pendingReveal, visibleCount, searchingMode])

  // 列表节点登记给「新建对话回到顶部」用
  useEffect(() => {
    registerSiderList(listRef.current)
    return () => registerSiderList(null)
  }, [searchingMode])

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

  const toggleSelected = useCallback(
    (id: string) =>
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id])),
    []
  )

  const onListScroll = useCallback(() => {
    const element = listRef.current
    if (!element) {
      return
    }
    const nextVisible =
      element.scrollTop + element.clientHeight >= element.scrollHeight - 320
        ? Math.min(sessions.length, Math.max(visibleCount, visibleCount + SIDER_PAGE_SIZE))
        : visibleCount
    if (nextVisible !== visibleCount) {
      setVisibleCount(nextVisible)
    }
  }, [sessions.length, visibleCount])

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

  const openResult = (sessionId: string) => {
    revealSiderSession(sessionId)
    selectSession(sessionId)
    closeMobileSider()
    setQuery('')
  }

  // 列表不再卸载，抽屉关掉时手动清搜索、收键盘，行为跟以前一致
  useEffect(() => {
    if (open) {
      return
    }
    setQuery('')
    searchInputRef.current?.blur()
    if (mobile) {
      setKeyboardResize(true)
    }
  }, [open, mobile])

  /**
   * 下拉刷新：自己接管触摸事件（touchmove 用非 passive 监听，才能 preventDefault），
   * 实时改 transform 保证跟手；到阈值震一下；松手过阈值就留在顶部转圈。
   */
  useEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) {
      return
    }
    const ease = 'cubic-bezier(.2,.8,.2,1)'
    let startY: number | null = null
    let distance = 0
    let armed = false
    let dragging = false

    const paint = (value: number, animate: boolean) => {
      indicator.style.transition = animate ? `transform .3s ${ease}, opacity .2s linear` : 'none'
      list.style.transition = animate ? `transform .3s ${ease}` : 'none'
      // 圆圈停在让位空隙的中间
      indicator.style.transform = `translateY(${value / 2 - 18}px)`
      indicator.style.opacity = value > 2 ? '1' : '0'
      indicator.style.setProperty('--p', Math.min(1, value / PULL_THRESHOLD).toFixed(3))
      // 列表一起下移，给指示器让位
      list.style.transform = `translateY(${value}px)`
    }

    const reset = (animate: boolean) => {
      distance = 0
      armed = false
      paint(0, animate)
    }

    const runRefresh = async () => {
      if (refreshingRef.current || useRelay.getState().servers.length === 0) {
        refreshingRef.current = false
        indicator.dataset.spinning = 'false'
        reset(true)
        return
      }
      refreshingRef.current = true
      indicator.dataset.spinning = 'true'
      paint(PULL_THRESHOLD, true)
      try {
        const results = await syncAllRelays()
        const pulled = results.reduce((sum, item) => sum + item.pulled, 0)
        const pushed = results.reduce((sum, item) => sum + item.pushed, 0)
        showToast({ key: 'relaySynced', params: { pulled: String(pulled), pushed: String(pushed) } })
      } catch (error) {
        showToast({
          key: 'relaySyncFailed',
          params: { message: error instanceof Error ? error.message : String(error) },
          type: 'error',
        })
      } finally {
        refreshingRef.current = false
        indicator.dataset.spinning = 'false'
        reset(true)
      }
    }

    /** 正在拉的那根手指；多指时只认它，别人的手指既不接管也不打断 */
    let touchId: number | null = null

    const onStart = (event: TouchEvent) => {
      if (refreshingRef.current || list.scrollTop > 0 || touchId !== null) {
        return
      }
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      touchId = touch.identifier
      startY = touch.clientY
      distance = 0
      armed = false
      dragging = false
    }

    const onMove = (event: TouchEvent) => {
      if (touchId === null || refreshingRef.current) {
        return
      }
      // 中途多了一根手指：放弃这次下拉、平滑回弹，别把它冻在半路
      if (event.touches.length > 1) {
        touchId = null
        startY = null
        dragging = false
        armed = false
        reset(true)
        return
      }
      const touch = [...event.touches].find((item) => item.identifier === touchId)
      if (!touch || startY === null) {
        return
      }
      const dy = touch.clientY - startY
      if (dy <= 0) {
        if (dragging) {
          dragging = false
          reset(true)
        }
        startY = null
        touchId = null
        return
      }
      if (list.scrollTop > 0) {
        startY = null
        touchId = null
        return
      }
      // 手指移动超过 6px 才接管，避免影响轻点和横向滑动
      if (!dragging && dy < 6) {
        return
      }
      dragging = true
      // 接管后阻止浏览器自己的滚动/回弹，动画完全由我们控制
      event.preventDefault()
      distance = Math.min(100, dy * 0.5)
      paint(distance, false)
      if (!armed && distance >= PULL_THRESHOLD) {
        armed = true
        haptic()
      } else if (armed && distance < PULL_THRESHOLD - 4) {
        armed = false
      }
    }

    const onEnd = (event: TouchEvent) => {
      if (touchId === null) {
        return
      }
      // 只认「拉的那根手指」抬起；另一根手指抬起时什么都不做
      const isMine = [...event.changedTouches].some((item) => item.identifier === touchId)
      if (!isMine) {
        return
      }
      touchId = null
      startY = null
      dragging = false
      if (!armed) {
        reset(true)
        return
      }
      void runRefresh()
    }

    /** 手势被系统打断（来电、切后台）：按「没拉到阈值」处理 */
    const onCancel = () => {
      touchId = null
      startY = null
      dragging = false
      armed = false
      reset(true)
    }

    list.addEventListener('touchstart', onStart, { passive: true })
    list.addEventListener('touchmove', onMove, { passive: false })
    list.addEventListener('touchend', onEnd)
    list.addEventListener('touchcancel', onCancel)
    return () => {
      list.removeEventListener('touchstart', onStart)
      list.removeEventListener('touchmove', onMove)
      list.removeEventListener('touchend', onEnd)
      list.removeEventListener('touchcancel', onCancel)
    }
  }, [])

  /** 滚动到当前对话（平滑滚动，不直接跳） */
  const locateActive = () => {
    const list = listRef.current
    if (!list || !activeId) {
      return
    }
    const target = list.querySelector<HTMLElement>(`[data-session-id="${activeId}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 点击列表里的某个会话：位置不用管，列表一直在，浏览器自然记得
  const handleSessionSelect = useCallback((sessionId: string) => {
    selectSession(sessionId)
    closeMobileSider()
  }, [])

  // 每行都是 memo 的，回调必须保持引用稳定，否则列表一重渲染就是几百个子组件全跑一遍
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const handleDelete = useCallback((id: string) => {
    const target = sessionsRef.current.find((item) => item.id === id)
    if (target) {
      setDeleting(target)
    }
  }, [])
  const handleMultiSelect = useCallback(() => setSelectionMode(true), [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>
            <IconSearchOutline16 />
          </span>
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            type="text"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('searchHistoryPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // 搜索时键盘只覆盖、不挤压窗口，底部输入框不会被顶起来
            onFocus={() => {
              if (mobile) {
                setKeyboardResize(false)
              }
            }}
            onBlur={() => {
              if (mobile) {
                setKeyboardResize(true)
              }
            }}
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
        <div ref={indicatorRef} className={styles.pullIndicator} aria-hidden>
          <svg className={styles.pullRing} viewBox="0 0 36 36">
            <circle className={styles.pullTrack} cx="18" cy="18" r="14" />
            <circle className={styles.pullArc} cx="18" cy="18" r="14" />
          </svg>
        </div>
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
          <div
            className={styles.list}
            ref={listRef}
            onScroll={onListScroll}
          >
            {listReady
              ? limitedGroups.map((group) => (
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
                        onToggleSelect={toggleSelected}
                        onMultiSelect={handleMultiSelect}
                        onSelect={handleSessionSelect}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                ))
              : null}
            {/* 末尾留白：定位按钮浮在这里时不会挡住最后一条对话 */}
            <div className={styles.listEndSpacer} aria-hidden />
          </div>
        )}
        {activeId ? (
          <button
            type="button"
            className={styles.locateButton}
            aria-label={t('siderLocateActive')}
            onClick={locateActive}
          >
            <IconLocateOutline16 />
          </button>
        ) : null}
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

/**
 * 移动端抽屉：浮在页面上方，点空白区域关闭；拖动时跟手移动。
 *
 * 抽屉只做位移、始终挂载：列表和滚动位置由浏览器自己保留，
 * 不再有「关闭保存 / 打开恢复」那一套，也就不会出现恢复错位或回顶。
 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const drawerRef = useRef<HTMLDivElement>(null)

  // 把抽屉元素交给手势模块：拖动时只改它的 transform
  useEffect(() => {
    bindSiderElements({ drawer: drawerRef.current })
    return () => bindSiderElements({ drawer: null })
  }, [])
  return (
    <>
      <div
        className={clsx(styles.drawerMask, !open && styles.drawerHidden)}
        onClick={open ? closeMobileSider : undefined}
      />
      <div
        ref={drawerRef}
        className={clsx(styles.drawer, !open && styles.drawerHidden)}
        aria-hidden={!open}
      >
        <Sider mobile open={open} />
      </div>
    </>
  )
}
