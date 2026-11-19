import { useTranslate } from '../../i18n/index.js'
import {
  hasNativeAccount,
  refreshAccount,
  signInAccount,
  signOutAccount,
  totalBalance,
  useAccount,
} from '../../services/account.js'
import styles from './Sider.module.css'

/**
 * 侧边栏底部账号卡片：Harness 账号头像、昵称、余额。
 *
 * 未登录时整行是静态信息，登录动作放在右侧独立按钮上——避免误触直接拉起浏览器授权。
 */
export const AccountFooter = () => {
  const t = useTranslate()
  const { status, name, avatar, balance, bonus, message, refreshing } = useAccount()

  if (!hasNativeAccount()) {
    return null
  }

  if (status === 'signed-in') {
    const amount = totalBalance(balance)
    const bonusAmount = totalBalance(bonus)
    return (
      <div className={styles.account}>
        <button
          type="button"
          className={styles.accountMain}
          onClick={refreshAccount}
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
            <span className={styles.accountMeta}>
              {refreshing
                ? t('accountRefreshing')
                : amount
                  ? `${t('accountBalance')} ${amount}`
                  : t('accountBalanceUnknown')}
              {bonusAmount && !refreshing ? ` · ${t('accountBonus')} ${bonusAmount}` : ''}
            </span>
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
