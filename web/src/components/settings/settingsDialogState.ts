import { create } from 'zustand'
import { useAccount } from '../../services/account.js'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'data' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/**
 * 发消息前确认「有可用的凭据」：
 * API Key 通道看设置里的 Key，账号通道看是否已登录 Harness 账号。
 * 都没有时打开设置（账号用户会被引导去侧边栏登录）。
 */
export const ensureApiKey = () => {
  const { apiKey, authRoute } = useSettings.getState()
  if (authRoute === 'account' && useAccount.getState().token !== '') {
    return true
  }
  if (apiKey) {
    return true
  }
  openSettings(authRoute === 'account' ? 'general' : 'data')
  return false
}
