import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { setAuthRoute, useSettings } from '../services/settings.js'
import { useAccount } from '../services/account.js'
import { setupAccount } from '../services/account.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  continueReply,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { canContinueReply } from '../services/chat/reply.js'
import { runBackHandler } from '../services/backStack.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import {
  closeAbout,
  closeSettings,
  ensureApiKey,
  popSettingsPage,
  useSettingsDialog,
} from '../components/settings/settingsDialogState.js'
import { DisclaimerGate, isDisclaimerAccepted } from '../components/onboarding/DisclaimerGate.js'
import { isOnboarded, Onboarding } from '../components/onboarding/Onboarding.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { UpdateDialog } from '../components/update/UpdateDialog.js'
import { checkUpdate, skippedVersion, skipVersion, type UpdateInfo } from '../services/update.js'
import { startBalanceRefresh } from '../services/balanceRefresh.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { log, logError } from '../services/log.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import {
  closeMobileSider,
  openMobileSider,
  useMobileSider,
  SIDER_WIDTH,
  applySiderDrag,
  beginSiderDrag,
  currentSiderOffset,
  endSiderDrag,
  SETTLE_RATIO,
} from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { Modal } from '../components/base/Modal.js'
import { useRelay, type RelayServer } from '../services/relay.js'
import { hasRemoteChanges, syncAllRelays, syncWithRelay } from '../services/relaySync.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const fontScale = useSettings((state) => state.fontScale)
  const accountStatus = useAccount((state) => state.status)
  const apiKey = useSettings((state) => state.apiKey)
  // 启动门槛：先同意免责与权限说明，再决定是否展示首次引导
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(() => isDisclaimerAccepted())
  // 首次使用引导：完成后写入本地标记，之后不再出现；老用户已配置过 API Key 也不再打扰
  const [showOnboarding, setShowOnboarding] = useState(
    () => !isOnboarded() && !useSettings.getState().apiKey
  )
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  /** 启动时发现中继有更新的会话：询问是否同步（与更新弹窗互斥，先更新后同步） */
  const [syncAsk, setSyncAsk] = useState<RelayServer | null>(null)
  // 只有抽屉开着/正在拖时才给 <main> 加 transform：常驻合成层会让文字发虚
  const siderOpen = useMobileSider((state) => state.open)
  const siderDragging = useMobileSider((state) => state.dragging)
  const siderClosing = useMobileSider((state) => state.closing)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  // 启动检查更新：发现更高版本时弹窗，可更新 / 稍后 / 跳过此版本
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const updateChecked = useRef(false)
  // 加载态：对话渲染完成后淡出，避免白屏闪烁
  const loading = !ready || (activeId !== null && !session)
  const [loadingExiting, setLoadingExiting] = useState(false)
  const loadingExitDoneRef = useRef(false)

  usePreventPageScroll(isMobile)

  // 加载结束：等两帧确保对话已渲染，再淡出加载层
  useEffect(() => {
    if (loading) {
      loadingExitDoneRef.current = false
      setLoadingExiting(false)
      return
    }
    if (loadingExitDoneRef.current || loadingExiting) {
      return
    }
    let raf2 = 0
    const raf = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        loadingExitDoneRef.current = true
        setLoadingExiting(true)
      })
    })
    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(raf2)
    }
  }, [loading, loadingExiting])

  // 淡出动画结束后卸载加载层
  useEffect(() => {
    if (!loadingExiting) {
      return
    }
    const timer = setTimeout(() => setLoadingExiting(false), 180)
    return () => clearTimeout(timer)
  }, [loadingExiting])

  // 点击消息 / 附件里的图片，全屏预览
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target || target.tagName !== 'IMG') {
        return
      }
      const img = target as HTMLImageElement
      const inContent =
        img.closest('[class*="main-content"]') !== null ||
        img.closest('[class*="attachments"]') !== null ||
        img.closest('[class*="attachment"]') !== null ||
        img.closest('[data-ds-image-preview]') !== null
      if (!inContent || !img.src) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setPreviewImage(img.src)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [])

  // 移动端手势：右滑拉出侧边栏、侧边栏内左滑收起。
  // 只在「这一下手势不是给内容用的」时候生效：选中文字、输入框、图片查看/编辑、
  // 横向可滚动的公式/表格/代码块/缩略图条，都不抢手势。
  useEffect(() => {
    if (!isMobile) {
      return
    }
    let startX = 0
    let startY = 0
    let blocked = false

    const ownsHorizontalGesture = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) {
        return false
      }
      if (target.closest('input, textarea, [contenteditable="true"], canvas, [data-ds-no-swipe]')) {
        return true
      }
      for (
        let element: Element | null = target;
        element && element !== document.documentElement;
        element = element.parentElement
      ) {
        const style = getComputedStyle(element)
        const overflowX = element.scrollWidth - element.clientWidth
        // 已经能横向滚动的容器：滑动属于它自己
        if (overflowX > 4 && /auto|scroll/.test(style.overflowX)) {
          return true
        }
        // 内容比视口宽（超长公式、宽表格、横向代码）：留给内容。
        // overflowX 为 hidden 的容器是布局裁剪（侧边栏推出主界面也会撑出滚动宽度），不算横向内容。
        if (
          overflowX > 4 &&
          style.overflowX !== 'hidden' &&
          element.clientWidth >= window.innerWidth * 0.6
        ) {
          return true
        }
      }
      return false
    }

    const hasTextSelection = () => {
      const selection = window.getSelection()
      return selection !== null && selection.toString().trim().length > 0
    }

    let baseOpen = false
    let dragging = false

    const onStart = (event: TouchEvent) => {
      dragging = false
      if (event.touches.length !== 1) {
        blocked = true
        return
      }
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      baseOpen = useMobileSider.getState().open
      // 有弹层 / 预览 / 设置时不抢手势
      blocked =
        hasTextSelection() ||
        ownsHorizontalGesture(event.target) ||
        document.querySelector('[role="dialog"], [data-ds-no-swipe]') !== null
    }

    // 跟手：向右滑多少，抽屉就拉出多少（0 ~ 270）
    const onMove = (event: TouchEvent) => {
      if (blocked || event.touches.length !== 1) {
        return
      }
      // 弹层（设置等）打开时绝不拖抽屉。有些子元素会 stopPropagation 掉 touchstart，
      // 导致上面那次判定被跳过，这里每次移动都兜一次底。
      if (document.querySelector('[role="dialog"]')) {
        blocked = true
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (!dragging) {
        if (Math.abs(dx) < 8) {
          return
        }
        // 纵向为主的手势交还给页面滚动
        if (Math.abs(dx) < Math.abs(dy) * 1.2) {
          blocked = true
          return
        }
        if (baseOpen ? dx >= 0 : dx <= 0) {
          return
        }
        dragging = true
        // 只在这里切一次状态（挂上拖动标记），后续每帧都不进 React
        beginSiderDrag()
      }
      // 判定为横滑后阻止浏览器接管，保证位移跟手
      if (event.cancelable) {
        event.preventDefault()
      }
      const offset = baseOpen ? SIDER_WIDTH + dx : dx
      // 直接写 CSS 变量：不触发渲染，长上下文也不会掉帧
      applySiderDrag(offset)
    }

    // 跟手拖到一半被系统取消（来电、切后台、输入法抢手势）时，按当前位移收口，
    // 否则抽屉会停在半开位置、过渡也被拖住出不来。
    const settleByOffset = () => {
      // 打开：offset 即向右拖动的距离；关闭：offset 是剩余拉出的宽度，
      // 换算成「朝动作方向拖动的距离」，开与关都用同一个 25% 阈值。
      const offset = currentSiderOffset()
      const dragged = baseOpen ? SIDER_WIDTH - offset : offset
      const shouldOpen = baseOpen
        ? dragged < SIDER_WIDTH * SETTLE_RATIO
        : dragged >= SIDER_WIDTH * SETTLE_RATIO
      endSiderDrag(shouldOpen)
    }

    const onEnd = (event: TouchEvent) => {
      const wasDragging = dragging
      dragging = false
      if (blocked && !wasDragging) {
        blocked = false
        return
      }
      const touch = event.changedTouches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      blocked = false
      if (wasDragging) {
        settleByOffset()
        return
      }
      // 快速轻扫（没进入跟手阶段）也允许开合
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) {
        return
      }
      const open = useMobileSider.getState().open
      if (!open && dx > 0) {
        openMobileSider()
      } else if (open && dx < 0) {
        closeMobileSider()
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    // 必须是非 passive 才能在判定横滑后 preventDefault
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    const onCancel = () => {
      const wasDragging = dragging
      dragging = false
      blocked = false
      if (wasDragging) {
        settleByOffset()
      }
    }
    window.addEventListener('touchcancel', onCancel)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onCancel)
    }
  }, [isMobile])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 字号缩放交给原生 WebView 的 textZoom：只放大文字，不缩放布局，底部不会被裁掉
  useEffect(() => {
    const bridge = (
      window as unknown as { AndroidTheme?: { setTextZoom: (percent: number) => void } }
    ).AndroidTheme
    bridge?.setTextZoom(Math.round(fontScale * 100))
  }, [fontScale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
    setupAccount()
  }, [])

  // 启动同步：开了「始终同步」就静默拉取，否则先问一句
  useEffect(() => {
    if (!ready || !disclaimerAccepted) {
      return
    }
    const servers = useRelay.getState().servers
    if (servers.length === 0) {
      return
    }
    if (useRelay.getState().alwaysSync) {
      void syncAllRelays().then((results) => {
        const pulled = results.reduce((sum, item) => sum + item.pulled, 0)
        if (pulled > 0) {
          showToast({ key: 'relaySynced', params: { pulled: String(pulled), pushed: '0' } })
        }
      })
      return
    }
    let cancelled = false
    void (async () => {
      for (const server of servers) {
        if (cancelled) {
          return
        }
        if (await hasRemoteChanges(server)) {
          if (!cancelled) {
            setSyncAsk(server)
          }
          return
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, disclaimerAccepted])

  // 布局与偏好变化记一笔：排障时能对上是手机还是宽屏、什么语言和字号
  useEffect(() => {
    log.info('ui', '布局/偏好', { isMobile, locale, fontScale })
  }, [isMobile, locale, fontScale])

  // 余额：启动刷新一次，之后每分钟刷新一次（页面在后台时跳过）
  useEffect(() => startBalanceRefresh(), [])

  // 同意免责后检查一次更新；「跳过此版本」只屏蔽当前线上版本
  useEffect(() => {
    if (!disclaimerAccepted || updateChecked.current) {
      return
    }
    updateChecked.current = true
    let cancelled = false
    void (async () => {
      try {
        const info = await checkUpdate()
        log.info('update', '检查更新完成', { upToDate: info.upToDate, version: info.version })
        if (cancelled || info.upToDate || skippedVersion() === info.version) {
          return
        }
        setUpdateInfo(info)
      } catch (error) {
        // 检查失败保持静默，不打扰启动流程，但日志里要留痕
        logError('update', '检查更新失败', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [disclaimerAccepted])

  // 保证「通道」与可用凭证一致：未登录账号不能走 account，没 Key 不能走 apikey
  useEffect(() => {
    const { authRoute } = useSettings.getState()
    const signedIn = accountStatus === 'signed-in'
    if (authRoute === 'account' && !signedIn && apiKey) {
      setAuthRoute('apikey')
    } else if (authRoute === 'apikey' && !apiKey && signedIn) {
      setAuthRoute('account')
    }
  }, [accountStatus, apiKey])

  // 同意免责且不在引导中时，才检查 API Key，避免弹层被门槛页遮挡
  useEffect(() => {
    if (disclaimerAccepted && !showOnboarding) {
      ensureApiKey()
    }
  }, [disclaimerAccepted, showOnboarding])

  // 退到后台被打断的回答：回到前台自动续写一次，不用用户手动点
  const resumedRef = useRef(new Set<string>())
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const state = useChatStore.getState()
      const id = state.activeId
      const session = id === null ? undefined : state.sessionCache[id]
      if (id === null || !session) {
        return
      }
      const last = [...session.messages].reverse().find((message) => message.role === 'assistant')
      if (!last || last.status !== 'error') {
        return
      }
      const kind = last.error?.kind
      if (kind !== 'interrupted' && kind !== 'network') {
        return
      }
      if (!canContinueReply(last) || Object.hasOwn(state.streaming, id)) {
        return
      }
      const key = `${id}:${last.id}`
      if (resumedRef.current.has(key)) {
        return
      }
      resumedRef.current.add(key)
      continueReply(id, last.id)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // 图片预览是否打开（返回键优先关闭它）
  const previewRef = useRef<string | null>(null)
  useEffect(() => {
    previewRef.current = previewImage
  }, [previewImage])

  // 免责 / 引导等启动门槛展示期间，返回键只消费事件，不退出应用
  const gateRef = useRef(!disclaimerAccepted || showOnboarding)
  useEffect(() => {
    gateRef.current = !disclaimerAccepted || showOnboarding
  }, [disclaimerAccepted, showOnboarding])

  // 暴露给原生返回键：优先关闭弹层，返回 true 表示已处理，false 交给原生退出
  useEffect(() => {
    const handler = (): boolean => {
      // 引导期间忽略返回键，避免误触直接退出
      if (gateRef.current) {
        return true
      }
      // 顺序必须按「视觉层级从高到低」：
      // 全屏图片预览 > 设置弹窗 > 侧边栏 > 搜索面板 > 组件内浮层（编辑器 / 附件预览 / 加号面板）。
      // 否则底层的加号面板会先把返回吃掉，导致设置界面关不掉。
      if (previewRef.current !== null) {
        setPreviewImage(null)
        return true
      }
      // 「关于软件」叠在设置之上，先关它再关设置
      if (useSettingsDialog.getState().aboutOpen) {
        log.info('ui', '返回键：关闭关于')
        closeAbout()
        return true
      }
      if (useSettingsDialog.getState().open) {
        // 二级页面还在时，返回先退一层，最后才关设置
        if (useSettingsDialog.getState().pages.length > 0) {
          log.info('ui', '返回键：退出设置二级页面')
          popSettingsPage()
          return true
        }
        log.info('ui', '返回键：关闭设置')
        closeSettings()
        return true
      }
      if (useMobileSider.getState().open) {
        log.info('ui', '返回键：关闭侧边栏')
        closeMobileSider()
        return true
      }
      if (useSearchPanel.getState().entry) {
        log.info('ui', '返回键：关闭搜索面板')
        closeSearchPanel()
        return true
      }
      if (runBackHandler()) {
        return true
      }
      return false
    }
    ;(window as unknown as { __dsHandleBack?: () => boolean }).__dsHandleBack = handler
    return () => {
      delete (window as unknown as { __dsHandleBack?: () => boolean }).__dsHandleBack
    }
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main
          className={
            isMobile && (siderOpen || siderDragging || siderClosing)
              ? `${styles.main} ${styles.mobileMain}`
              : styles.main
          }
        >
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!loading ? (
              session ? (
                <SessionView
                  session={session}
                  streaming={streaming}
                  siderCollapsed={siderCollapsed}
                />
              ) : (
                <Welcome />
              )
            ) : null}
            {loading || loadingExiting ? (
              <div
                className={`${styles.loadingView}${loadingExiting ? ` ${styles.loadingExit}` : ''}`}
              >
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  {!(!ready ? initError : sessionLoadError) ? (
                    <span className={styles.spinner} aria-hidden />
                  ) : null}
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </main>
        <SearchPanel />
      </div>
      {!disclaimerAccepted ? (
        <DisclaimerGate onAccept={() => setDisclaimerAccepted(true)} />
      ) : showOnboarding ? (
        <Onboarding onDone={() => setShowOnboarding(false)} />
      ) : null}
      <SettingsDialog />
      {updateInfo ? (
        <UpdateDialog
          info={updateInfo}
          onClose={() => setUpdateInfo(null)}
          onSkip={() => {
            skipVersion(updateInfo.version)
            setUpdateInfo(null)
          }}
        />
      ) : null}
      {syncAsk && !updateInfo ? (
        <Modal
          title={t('relaySyncAskTitle')}
          closable
          onClose={() => setSyncAsk(null)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setSyncAsk(null)}>
                {t('relaySyncLater')}
              </Button>
              <Button
                size="m"
                onClick={() => {
                  const server = syncAsk
                  setSyncAsk(null)
                  void syncWithRelay(server.id)
                    .then((result) =>
                      showToast({
                        key: 'relaySynced',
                        params: { pulled: String(result.pulled), pushed: String(result.pushed) },
                      })
                    )
                    .catch((error: unknown) =>
                      showToast({
                        key: 'relaySyncFailed',
                        params: { message: error instanceof Error ? error.message : String(error) },
                        type: 'error',
                      })
                    )
                }}
              >
                {t('relaySyncNow')}
              </Button>
            </>
          }
        >
          <p>{t('relaySyncAskBody', { name: syncAsk.name })}</p>
        </Modal>
      ) : null}
      {previewImage ? (
        <div
          className={styles.imagePreview}
          role="dialog"
          aria-modal="true"
          data-ds-no-swipe=""
          onClick={() => setPreviewImage(null)}
        >
          <img src={previewImage} alt="" data-ds-no-swipe="" />
        </div>
      ) : null}
      <Toast />
    </>
  )
}
