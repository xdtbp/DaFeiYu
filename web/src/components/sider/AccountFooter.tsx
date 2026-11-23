import { useEffect } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  hasNativeAccount,
  refreshAccount,
  signInAccount,
  signOutAccount,
  totalBalance,
  useAccount,
} from '../../services/account.js'
import { useApiBalance } from '../../services/apiBalance.js'
import { useSettings } from '../../services/settings.js'
import styles from './Sider.module.css'

/**
 * 侧边栏底部账号卡片，按登录状态与 API Key 配置分三种形态：
 *
 * - 已登录：显示账号余额；同时填了 API Key 时额外显示 API 余额（两行）
 * - 未登录但填了 API Key：显示 API 余额，整行可点击去登录
 * - 未登录也没有 Key：提示未登录，右侧独立登录按钮（避免误触拉起授权）
 */
export const AccountFooter = () => {
  const t = useTranslate()
  const { status, name, avatar, balance, bonus, message, refreshing } = useAccount()
  const apiKey = useSettings((state) => state.apiKey)
  const apiBalance = useApiBalance()

  // API Key 变化后重新查询 API 余额
  useEffect(() => {
    if (apiKey) {
      void apiBalance.refresh()
    }
  }, [apiKey, apiBalance.refresh])

  if (!hasNativeAccount()) {
    return null
  }

  const signedIn = status === 'signed-in'
  const hasKey = Boolean(apiKey)
  const accountAmount = totalBalance([...balance, ...bonus])
  const apiText = apiBalance.loading
    ? '…'
    : apiBalance.error
      ? t('balanceFetchFailed')
      : apiBalance.total

  const refreshBoth = () => {
    refreshAccount()
    void apiBalance.refresh()
  }

  // 已登录：账号余额；配置了 API Key 时再加一行 API 余额
  if (signedIn) {
    return (
      <div className={styles.account}>
        <button
          type="button"
          className={styles.accountMain}
          onClick={refreshBoth}
          title={t('accountTapToRefresh')}
        >
          <span className={styles.avatar}>
            {avatar ? (
              <img src={avatar} alt="" className={styles.avatarImage} />
            ) : (
              <span className={styles.avatarFallback}>
                {(name || 'D').slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          <span className={styles.accountText}>
            <span className={styles.accountName}>{name || t('accountUnnamed')}</span>
            {hasKey ? (
              <span className={styles.accountBalances}>
                <span className={styles.accountMeta}>
                  {t('accountLineAccount', {
                    amount: refreshing
                      ? t('accountRefreshing')
                      : accountAmount || t('accountBalanceUnknown'),
                  })}
                </span>
                <span className={styles.accountMeta}>
                  {t('accountLineApi', { amount: apiText || t('accountBalanceUnknown') })}
                </span>
              </span>
            ) : (
              <span className={styles.accountMeta}>
                {refreshing
                  ? t('accountRefreshing')
                  : accountAmount
                    ? `${t('accountBalance')} ${accountAmount}`
                    : t('accountBalanceUnknown')}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          className={styles.accountAction}
          onClick={signOutAccount}
          title={t('accountSignOut')}
        >
          {t('accountSignOut')}
        </button>
      </div>
    )
  }

  // 未登录但填了 API Key：显示 API 余额，整行点击去登录
  if (hasKey) {
    return (
      <button
        type="button"
        className={`${styles.account} ${styles.accountClickable}`}
        onClick={signInAccount}
        title={t('accountTapToSignIn')}
      >
        <span className={styles.avatar}>
          <span className={styles.avatarFallback}>D</span>
        </span>
        <span className={styles.accountText}>
          <span className={styles.accountName}>
            {apiBalance.loading
              ? t('accountRefreshing')
              : apiText
                ? t('accountBalanceValue', { amount: apiText })
                : t('accountBalanceUnknown')}
          </span>
          <span className={styles.accountMeta}>{t('accountTapToSignIn')}</span>
        </span>
      </button>
    )
  }

  const authorizing = status === 'authorizing'
  return (
    <div className={styles.account}>
      <span className={styles.avatar}>
        <span className={styles.avatarFallback}>D</span>
      </span>
      <span className={styles.accountText}>
        <span className={styles.accountName}>{t('accountSignedOutTitle')}</span>
        <span className={styles.accountMeta}>
          {status === 'error' && message ? message : t('accountSignInHint')}
        </span>
      </span>
      <button
        type="button"
        className={styles.accountAction}
        onClick={signInAccount}
        disabled={authorizing}
      >
        {authorizing ? t('accountAuthorizing') : t('accountSignInShort')}
      </button>
    </div>
  )
}
