import { useCallback, useEffect, useState } from 'react'
import { getBalance } from '../../services/api/client.js'
import type { BalanceResponse } from '../../services/api/types.js'
import { useAccount } from '../../services/account.js'
import { useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** 账户余额卡片：调用 /user/balance，显示总余额 + 充值/赠送明细，支持手动刷新 */
export const BalanceCard = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  // 账号通道没有 API Key，用登录令牌也能查 /user/balance
  const accountToken = useAccount((state) => state.token)
  const hasAuth = Boolean(apiKey) || Boolean(accountToken)
  const [balance, setBalance] = useState<BalanceResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    if (!apiKey && !accountToken) {
      setBalance(null)
      return
    }
    setLoading(true)
    setError(false)
    try {
      setBalance(await getBalance(apiKey ?? ''))
    } catch {
      setError(true)
      setBalance(null)
    } finally {
      setLoading(false)
    }
  }, [apiKey, accountToken])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const cny = balance?.balance_infos?.find((item) => item.currency === 'CNY')

  return (
    <div className={styles.cell}>
      <div className={styles.row}>
        <div className={styles.text}>
          <div className={styles.label}>{t('balanceLabel')}</div>
          {cny ? (
            <div className={styles.balanceTotal}>¥ {cny.total_balance}</div>
          ) : (
            <div className={styles.description}>
              {loading ? t('balanceLoading') : error ? t('balanceLoadFailed') : t('balanceNotAvailable')}
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.confirm}
          disabled={loading || !hasAuth}
          onClick={() => void refresh()}
        >
          {t('balanceRefresh')}
        </button>
      </div>
      {cny ? (
        <div className={styles.description}>
          {t('balanceToppedUp')} {cny.topped_up_balance} · {t('balanceGranted')} {cny.granted_balance}
        </div>
      ) : null}
    </div>
  )
}
