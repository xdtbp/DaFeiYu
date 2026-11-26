import { create } from 'zustand'
import { useAccount } from '../../services/account.js'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置内的二级页面（叠加在分组内容之上，返回时逐层退栈） */
export type SettingsPage =
  | { key: 'routes' }
  | { key: 'profile' }
  | { key: 'model-config' }
  | { key: 'interface' }
  | { key: 'relay' }
  | { key: 'relay-edit'; relayId: string | null }

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'data' as SettingsSection,
  /** 「关于软件」弹窗叠在设置之上，返回时先关它 */
  aboutOpen: false,
  /** 二级页面栈：栈顶在最上面，返回逐层弹出 */
  pages: [] as SettingsPage[],
  /** 正在播放退出动画的页面（已经从栈里移除，但仍留在 DOM 240ms） */
  closingPage: null as SettingsPage | null,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section, pages: [] })

export const closeSettings = () =>
  useSettingsDialog.setState({ open: false, aboutOpen: false, pages: [], closingPage: null })

/** 切换分组会清空二级页面：顶栏是一级导航 */
export const setSettingsSection = (section: SettingsSection) =>
  useSettingsDialog.setState({ section, pages: [], closingPage: null })

export const pushSettingsPage = (page: SettingsPage) =>
  useSettingsDialog.setState((state) => ({ pages: [...state.pages, page], closingPage: null }))

/** 弹出栈顶：先把页面留给退出动画，再从栈里移除 */
let closeTimer: ReturnType<typeof setTimeout> | null = null
export const popSettingsPage = () => {
  const { pages } = useSettingsDialog.getState()
  const top = pages.at(-1)
  if (!top) {
    return
  }
  if (closeTimer) {
    clearTimeout(closeTimer)
  }
  useSettingsDialog.setState({ pages: pages.slice(0, -1), closingPage: top })
  closeTimer = setTimeout(() => useSettingsDialog.setState({ closingPage: null }), 240)
}

export const openAbout = () => useSettingsDialog.setState({ aboutOpen: true })

export const closeAbout = () => useSettingsDialog.setState({ aboutOpen: false })

/**
 * 发消息前确认「有可用的凭据」：
 * API Key 通道看设置里的 Key，账号通道看是否已登录 Harness 账号。
 * 都没有时打开设置（账号用户会被引导去侧边栏登录）。
 */
export const ensureApiKey = () => {
  const { apiKey, authRoute, chatRelayId } = useSettings.getState()
  // 对话走中继时，凭据由中继持有
  if (chatRelayId) {
    return true
  }
  if (authRoute === 'account' && useAccount.getState().token !== '') {
    return true
  }
  if (apiKey) {
    return true
  }
  openSettings(authRoute === 'account' ? 'general' : 'data')
  return false
}
