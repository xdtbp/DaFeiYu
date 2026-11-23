import { useEffect, useRef, useState } from 'react'
import deepseekLogo from '../../assets/deepseek.svg'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { signInAccount, useAccount } from '../../services/account.js'
import {
  appPermissionGranted,
  requestAppPermission,
  type AppPermission,
} from '../../services/appPermission.js'
import { setApiKey } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { HistoryProgress } from '../history/HistoryProgress.js'
import { useHistoryImport } from '../history/useHistoryImport.js'
import styles from './Onboarding.module.css'

const ONBOARDED_KEY = 'chat-demo:onboarded'

/** 引导里可逐项申请的权限 */
const PERMISSIONS: { key: AppPermission; title: TranslationKey; desc: TranslationKey }[] = [
  { key: 'mic', title: 'permMicTitle', desc: 'permMicDesc' },
  { key: 'camera', title: 'permCameraTitle', desc: 'permCameraDesc' },
  { key: 'media', title: 'permMediaTitle', desc: 'permMediaDesc' },
]

/** 是否已经完成首次引导 */
export const isOnboarded = (): boolean => {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === 'true'
  } catch {
    return false
  }
}

const markOnboarded = () => {
  try {
    localStorage.setItem(ONBOARDED_KEY, 'true')
  } catch {
    /* 隐私模式下写入失败时，本次会话内仍可正常使用 */
  }
}

/**
 * 首次使用引导：欢迎 → 权限申请 → 登录 / 配置 API Key → 导入数据 → 完成。
 * 每一步都可以跳过，也可以返回上一步；完成后写入本地标记，不再出现。
 */
export const Onboarding = ({ onDone }: { onDone: () => void }) => {
  const t = useTranslate()
  const account = useAccount()
  const [step, setStep] = useState(0)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const historyImport = useHistoryImport()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [granted, setGranted] = useState<Record<AppPermission, boolean>>(() => ({
    mic: appPermissionGranted('mic'),
    camera: appPermissionGranted('camera'),
    media: appPermissionGranted('media'),
  }))

  const signedIn = account.status === 'signed-in'
  const authorizing = account.status === 'authorizing'

  // 选完文件后直接开始导入（首次引导本地没有数据，无需二次确认）
  useEffect(() => {
    if (historyImport.file) {
      setImporting(true)
      void historyImport.confirm()
    }
  }, [historyImport.file])

  useEffect(() => {
    if (importing && !historyImport.busy && historyImport.status) {
      setImporting(false)
    }
  }, [importing, historyImport.busy, historyImport.status])

  const finish = () => {
    markOnboarded()
    onDone()
  }

  const ask = async (key: AppPermission) => {
    const ok = await requestAppPermission(key)
    setGranted((prev) => ({ ...prev, [key]: ok }))
  }

  const saveKey = () => {
    const key = apiKeyInput.trim()
    if (!key) {
      return
    }
    setApiKey(key)
    setStep(3)
  }

  const startImport = () => {
    historyImport.pick(() => fileInputRef.current?.click())
  }

  const status = historyImport.status
  const importingNow = importing || historyImport.busy || historyImport.reading

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.card}>
        {step === 0 ? (
          <>
            <img className={styles.logo} src={deepseekLogo} alt="" />
            <h1 className={styles.title}>{t('onboardingWelcomeTitle')}</h1>
            <p className={styles.desc}>{t('onboardingWelcomeDesc')}</p>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h1 className={styles.title}>{t('onboardingPermissionTitle')}</h1>
            <p className={styles.desc}>{t('onboardingPermissionDesc')}</p>
            <div className={styles.permList}>
              {PERMISSIONS.map((item) => (
                <div key={item.key} className={styles.permRow}>
                  <div className={styles.permText}>
                    <span className={styles.permTitle}>{t(item.title)}</span>
                    <span className={styles.permDesc}>{t(item.desc)}</span>
                  </div>
                  {granted[item.key] ? (
                    <span className={styles.permGranted}>{t('permGranted')}</span>
                  ) : (
                    <Button variant="outlined" size="s" onClick={() => void ask(item.key)}>
                      {t('permRequest')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 className={styles.title}>{t('onboardingAccountTitle')}</h1>
            <p className={styles.desc}>{t('onboardingAccountDesc')}</p>
            {signedIn ? (
              <div className={styles.signedIn}>{t('onboardingSignedIn')}</div>
            ) : (
              <Button variant="outlined" size="m" disabled={authorizing} onClick={signInAccount}>
                {authorizing ? t('accountAuthorizing') : t('onboardingSignIn')}
              </Button>
            )}
            <div className={styles.apiKeyRow}>
              <input
                className={styles.apiKeyInput}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('onboardingApiKeyPlaceholder')}
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
              />
              <Button size="m" disabled={!apiKeyInput.trim()} onClick={saveKey}>
                {t('onboardingSaveKey')}
              </Button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 className={styles.title}>{t('onboardingDataTitle')}</h1>
            <p className={styles.desc}>{t('onboardingDataDesc')}</p>
            <Button variant="outlined" size="m" disabled={importingNow} onClick={startImport}>
              {t('onboardingImport')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  historyImport.select(file)
                }
              }}
            />
            {importingNow ? <p className={styles.hint}>{t('onboardingImportHint')}</p> : null}
            <HistoryProgress kind="import" />
            {status ? (
              <p className={status.error ? `${styles.hint} ${styles.hintError}` : styles.hint}>
                {t(status.key, status.reason ? { message: t(status.reason) } : status.params)}
              </p>
            ) : null}
          </>
        ) : null}

        {step === 4 ? <h1 className={styles.title}>{t('onboardingDoneTitle')}</h1> : null}

        <div className={styles.dots} aria-hidden>
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index} className={index === step ? styles.dotActive : styles.dot} />
          ))}
        </div>
      </div>

      {/* 按钮贴屏幕边角：跳过右上、上一步左下、下一步右下 */}
      {step < 4 ? (
        <button type="button" className={styles.skipCorner} onClick={() => setStep(step + 1)}>
          {t('onboardingSkip')}
        </button>
      ) : null}
      <div className={styles.bottomBar}>
        {step > 0 ? (
          <button type="button" className={styles.backButton} onClick={() => setStep(step - 1)}>
            {t('onboardingBack')}
          </button>
        ) : (
          <span />
        )}
        {step === 0 ? (
          <Button onClick={() => setStep(1)}>{t('onboardingStart')}</Button>
        ) : step === 4 ? (
          <Button onClick={finish}>{t('onboardingStartUsing')}</Button>
        ) : (
          <Button onClick={() => setStep(step + 1)}>{t('onboardingNext')}</Button>
        )}
      </div>
    </div>
  )
}
