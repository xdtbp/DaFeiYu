import { create } from 'zustand'
import { getBalanceByApiKey } from './api/client.js'
import { useSettings } from './settings.js'

/** 查询超时：超过这个时间就当作失败，避免界面一直停在「获取中」 */
const TIMEOUT = 8000

type ApiBalanceState = {
  /** 总余额（如 ¥5.00），空串表示未查询到 */
  total: string
  /** 充值部分 */
  toppedUp: string
  /** 赠送部分 */
  granted: string
  loading: boolean
  /** 是否已经尝试查询过 */
  loaded: boolean
  /** 上次查询是否失败（超时 / 401 / 网络错误） */
  error: boolean
  refresh: () => Promise<void>
}

const format = (value: string | undefined): string => {
  const amount = Number(value)
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : ''
}

/**
 * API Key 所属账户的余额。
 * 登录 Harness 账号时 `/user/balance` 会优先用账号令牌，这里固定用 API Key 查询，
 * 以便同时展示「账户余额」和「API 余额」两个数字。
 */
export const useApiBalance = create<ApiBalanceState>((set) => ({
  total: '',
  toppedUp: '',
  granted: '',
  loading: false,
  loaded: false,
  error: false,
  refresh: async () => {
    const apiKey = useSettings.getState().apiKey
    if (!apiKey) {
      set({ total: '', toppedUp: '', granted: '', loading: false, loaded: true, error: false })
      return
    }
    set({ loading: true, error: false })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT)
    try {
      const data = await getBalanceByApiKey(apiKey, controller.signal)
      const cny = data.balance_infos?.find((item) => item.currency === 'CNY')
      set({
        total: format(cny?.total_balance),
        toppedUp: format(cny?.topped_up_balance),
        granted: format(cny?.granted_balance),
        loading: false,
        loaded: true,
        error: false,
      })
    } catch {
      set({ total: '', toppedUp: '', granted: '', loading: false, loaded: true, error: true })
    } finally {
      clearTimeout(timer)
    }
  },
}))
