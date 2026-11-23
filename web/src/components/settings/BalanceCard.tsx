import { useTranslate } from '../../i18n/index.js'
import { refreshAccount, totalBalance, useAccount } from '../../services/account.js'
import { useApiBalance } from '../../services/apiBalance.js'
import { useSettings } from '../../services/settings.js'
import styles from './Settings.module.css'

/**
 * 数据管理 → 余额：账户余额与 API 余额分开显示。
 * - 账户余额来自 Harness 账号登录后返回的钱包
 * - API 余额固定用 API Key 查询（与当前通道无关）
 */
export const BalanceCard = () => {
  const t = useTranslate()
  const { status, balance, bonus, refreshing } = useAccount()
  const apiKey = useSettings((state) => state.apiKey)
  const apiBalance = useApiBalance()

  const signedIn = status === 'signed-in'
  const hasKey = Boolean(apiKey)
  const accountTotal = totalBalance(balance)
  const accountBonus = totalBalance(bonus) || '¥0.00'

  return (
    <>
      {/* 账户余额 */}
      <div className={styles.cell}>
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.label}>{t('balanceLabel')}</div>
            {signedIn ? (
              accountTotal ? (
                <div className={styles.balanceTotal}>{accountTotal}</div>
              ) : (
                <div className={styles.description}>
                  {refreshing ? t('balanceLoading') : t('balanceNotAvailable')}
                </div>
              )
            ) : (
              <div className={styles.description}>{t('balanceAccountSignedOut')}</div>
            )}
          </div>
          <button
            type="button"
            className={styles.confirm}
            disabled={!signedIn || refreshing}
            onClick={refreshAccount}
          >
            {refreshing ? t('balanceLoading') : t('balanceRefresh')}
          </button>
        </div>
        {signedIn && accountTotal ? (
          <div className={styles.description}>
            {t('balanceToppedUp')} {accountTotal} · {t('balanceGranted')} {accountBonus}
          </div>
        ) : null}
      </div>

      {/* API 余额 */}
      <div className={styles.cell}>
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.label}>{t('balanceApiLabel')}</div>
            {!hasKey ? (
              <div className={styles.description}>{t('balanceApiNotConfigured')}</div>
            ) : apiBalance.loading ? (
              <div className={styles.description}>{t('balanceLoading')}</div>
            ) : apiBalance.total ? (
              <div className={styles.balanceTotal}>{apiBalance.total}</div>
            ) : (
              <div className={styles.description}>
                {apiBalance.error ? t('balanceFetchFailed') : t('balanceNotAvailable')}
              </div>
            )}
          </div>
          <button
            type="button"
            className={styles.confirm}
            disabled={!hasKey || apiBalance.loading}
            onClick={() => void apiBalance.refresh()}
          >
            {apiBalance.loading ? t('balanceLoading') : t('balanceRefresh')}
          </button>
        </div>
        {hasKey && apiBalance.total ? (
          <div className={styles.description}>
            {t('balanceToppedUp')} {apiBalance.toppedUp || '¥0.00'} · {t('balanceGranted')}{' '}
            {apiBalance.granted || '¥0.00'}
          </div>
        ) : null}
      </div>
    </>
  )
}
