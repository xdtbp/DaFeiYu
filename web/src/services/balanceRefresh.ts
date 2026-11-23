import { refreshAccount, useAccount } from './account.js'
import { useApiBalance } from './apiBalance.js'
import { useSettings } from './settings.js'

/** 刷新间隔：1 分钟 */
export const BALANCE_REFRESH_INTERVAL = 60_000

/**
 * 同时刷新两个余额：
 * - 已登录账号 → 刷新账号钱包
 * - 配置了 API Key → 刷新 API Key 所属账户余额
 * quiet 用于轮询，避免每次刷新都把界面打回「获取中」。
 */
export const refreshBalances = (quiet = false) => {
  if (useAccount.getState().status === 'signed-in') {
    refreshAccount(quiet)
  }
  if (useSettings.getState().apiKey) {
    void useApiBalance.getState().refresh(quiet)
  }
}

/**
 * 启动后立即刷新一次，之后每分钟刷新一次；页面在后台时跳过。
 * 返回取消函数，App 卸载时调用。
 */
export const startBalanceRefresh = () => {
  refreshBalances(true)
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      refreshBalances(true)
    }
  }, BALANCE_REFRESH_INTERVAL)
  return () => clearInterval(timer)
}
