import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { BackupError, clearHistory, exportHistory } from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { HistoryProgress } from '../history/HistoryProgress.js'
import { useHistoryImport } from '../history/useHistoryImport.js'
import { useChatStore } from '../../services/chat/store.js'
import { useAccount } from '../../services/account.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setAuthRoute,
  setModel,
  setFontScale,
  setLocale,
  setLocation,
  setMaxTokens,
  setReasoningEffort,
  setThemePreference,
  setThinkingDisplay,
  setTtsVoice,
  useSettings,
  type ThemePreference,
  type ThinkingDisplay,
} from '../../services/settings.js'
import type { ThinkingEffort } from '../../services/api/types.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { BalanceCard } from './BalanceCard.js'
import {
  IconSettingBolt,
  IconSettingFont,
  IconSettingGlobe,
  IconSettingInfo,
  IconSettingLength,
  IconSettingLocation,
  IconSettingModel,
  IconSettingMoon,
  IconSettingSpeaker,
  IconSettingThinking,
  IconSettingWallet,
} from './settingsIcons.js'
import {
  closeAbout,
  closeSettings,
  openAbout,
  useSettingsDialog,
  type SettingsSection,
} from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory

  // 左右滑动切换「通用设置 / 数据管理」：只在内容区横向滑动时生效，
  // 输入框和横向可滚区域内的手势仍交给它们自己处理。
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const switchSection = (direction: 1 | -1) => {
    const index = sections.findIndex((item) => item.value === section)
    const next = sections[index + direction]
    if (next) {
      setSection(next.value)
    }
  }
  const onPanelTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      swipeStart.current = null
      return
    }
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [data-ds-no-swipe]')) {
      swipeStart.current = null
      return
    }
    // 落在可横向滚动的元素上时不要抢手势
    for (let node = target; node && node !== event.currentTarget; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (/auto|scroll/.test(style.overflowX) && node.scrollWidth - node.clientWidth > 4) {
        swipeStart.current = null
        return
      }
    }
    swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }
  const onPanelTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) {
      return
    }
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) {
      return
    }
    switchSection(dx < 0 ? 1 : -1)
  }

  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div
          key={section}
          role="tabpanel"
          className={styles.content}
          onTouchStart={onPanelTouchStart}
          onTouchEnd={onPanelTouchEnd}
          onTouchCancel={() => {
            swipeStart.current = null
          }}
        >
          {section === 'general' ? (
            <>
              <ModelSetting />
              <ThemeSetting />
              <FontSizeSetting />
              <ReasoningSetting />
              <MaxTokensSetting />
              <ThinkingDisplaySetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
              <AboutSetting />
            </>
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <BalanceCard />
              <SettingCell
                icon={<IconSettingWallet />}
                label={t('settingsTopUp')}
                status={null}
                action={
                  <a
                    className={styles.topUpLink}
                    href={TOP_UP_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('topUp')}
                  </a>
                }
              />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <HistoryProgress kind="import" />
              <ExportHistory disabled={historyBusy} />
              <HistoryProgress kind="export" />
              <SettingCell
                icon={<IconTrashOutline16 />}
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      icon={<IconSettingLocation />}
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      icon={<IconSettingGlobe />}
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      icon={<IconSettingSpeaker />}
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 深色设置：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('settingsDarkMode')
  return (
    <div className={styles.theme}>
      <div className={styles.themeTitle}>
        <span className={styles.cellIcon}>
          <IconSettingMoon />
        </span>
        {label}
      </div>
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 字号缩放：整体界面 zoom，1 为标准 */
const FontSizeSetting = () => {
  const t = useTranslate()
  const fontScale = useSettings((state) => state.fontScale)
  return (
    <SettingCell
      icon={<IconSettingFont />}
      label={t('settingsFontSize')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsFontSize')}
          value={String(fontScale)}
          options={[
            { value: '0.9', label: t('fontSizeSmall') },
            { value: '1', label: t('fontSizeStandard') },
            { value: '1.1', label: t('fontSizeLarge') },
            { value: '1.25', label: t('fontSizeXLarge') },
          ]}
          onChange={(value) => setFontScale(Number(value))}
        />
      }
    />
  )
}

/** 推理强度：仅开启深度思考时生效，对应 output_config.effort */
const ReasoningSetting = () => {
  const t = useTranslate()
  const effort = useSettings((state) => state.reasoningEffort)
  return (
    <SettingCell
      icon={<IconSettingBolt />}
      label={t('settingsReasoningEffort')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsReasoningEffort')}
          value={effort}
          options={[
            { value: 'low', label: t('reasoningLow') },
            { value: 'high', label: t('reasoningHigh') },
            { value: 'max', label: t('reasoningMax') },
          ]}
          onChange={(value) => setReasoningEffort(value as ThinkingEffort)}
        />
      }
    />
  )
}

/** 最大输出长度：max_tokens，默认交给服务端 */
/**
 * 模型与通道：API Key / Harness 账号 × Flash / Pro，或第三方 OpenAI 兼容服务。
 * 账号通道用登录令牌代替 API Key，登录即可对话。
 */
const ModelSetting = () => {
  const t = useTranslate()
  const authRoute = useSettings((state) => state.authRoute)
  const model = useSettings((state) => state.model)
  const apiKey = useSettings((state) => state.apiKey)
  const signedIn = useAccount((state) => state.status === 'signed-in')
  const hasKey = Boolean(apiKey)

  // 只展示当前可用凭证对应的模型：有账号时账号模型排在前面，没配置 Key 就不出现 API Key 模型
  const options = [
    ...(signedIn
      ? [
          {
            value: 'account:deepseek-flash',
            label: `${t('modelSourceAccount')} · DeepSeek-V4.1-Flash`,
          },
          { value: 'account:deepseek-v4-pro', label: `${t('modelSourceAccount')} · DeepSeek-V4-Pro` },
        ]
      : []),
    ...(hasKey
      ? [
          {
            value: 'apikey:deepseek-flash',
            label: `${t('modelSourceApikey')} · DeepSeek-V4.1-Flash`,
          },
          { value: 'apikey:deepseek-v4-pro', label: `${t('modelSourceApikey')} · DeepSeek-V4-Pro` },
        ]
      : []),
  ]

  if (options.length === 0) {
    return (
      <SettingCell
        icon={<IconSettingModel />}
        label={t('settingsModel')}
        status={{ key: 'modelNoCredential', error: true }}
        action={<span />}
      />
    )
  }

  const preferred = `${authRoute}:${model}`
  const value = options.some((option) => option.value === preferred)
    ? preferred
    : options[0].value

  const onChange = (next: string) => {
    const [route, id] = next.split(':')
    setAuthRoute(route === 'account' ? 'account' : 'apikey')
    setModel(id === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash')
  }

  return (
    <SettingCell
      icon={<IconSettingModel />}
      label={t('settingsModel')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsModel')}
          value={value}
          options={options}
          onChange={onChange}
        />
      }
    />
  )
}

/** 思考过程展示：折叠 / 展开 / 仅展示最新部分（限高滚动） */
const ThinkingDisplaySetting = () => {
  const t = useTranslate()
  const thinkingDisplay = useSettings((state) => state.thinkingDisplay)
  return (
    <SettingCell
      icon={<IconSettingThinking />}
      label={t('settingsThinkingDisplay')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsThinkingDisplay')}
          value={thinkingDisplay}
          options={[
            { value: 'collapsed', label: t('thinkingDisplayCollapsed') },
            { value: 'full', label: t('thinkingDisplayFull') },
            { value: 'latest', label: t('thinkingDisplayLatest') },
          ]}
          onChange={(value) => setThinkingDisplay(value as ThinkingDisplay)}
        />
      }
    />
  )
}

const MaxTokensSetting = () => {
  const t = useTranslate()
  const maxTokens = useSettings((state) => state.maxTokens)
  return (
    <SettingCell
      icon={<IconSettingLength />}
      label={t('settingsMaxTokens')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsMaxTokens')}
          value={maxTokens === null ? 'default' : String(maxTokens)}
          options={[
            { value: 'default', label: t('maxTokensDefault') },
            { value: '4096', label: '4096' },
            { value: '8192', label: '8192' },
            { value: '16384', label: '16384' },
            { value: '32768', label: '32768' },
          ]}
          onChange={(value) => setMaxTokens(value === 'default' ? null : Number(value))}
        />
      }
    />
  )
}

/** DeepSeek 开放平台充值页 */
const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

/** GitHub 仓库信息，用于「关于软件」与检查更新 */
const GITHUB_OWNER = 'xdtbp'
const GITHUB_REPO = 'DaFeiYu'
const GITHUB_HOME = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
const DEV_AVATAR = `https://github.com/${GITHUB_OWNER}.png`

/** 当前版本号：优先从原生壳读取 versionName，回退到固定值 */
const getAppVersion = (): string => {
  const bridge = (window as unknown as { AndroidApp?: { version?: () => string } }).AndroidApp
  try {
    const version = bridge?.version?.()
    if (version) {
      return version
    }
  } catch {
    /* 回退到默认 */
  }
  return '0.5.0'
}

type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'error'

/** 语义化版本比较：a > b 返回正数，a < b 返回负数，相等返回 0 */
const compareVersion = (a: string, b: string): number => {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

/** 检查更新：GitHub 最新 Release 的 tag 与当前版本按语义化版本比较 */
const checkUpdate = async (): Promise<{ latest: boolean; version: string; url: string }> => {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  )
  if (!response.ok) {
    throw new Error(String(response.status))
  }
  const data = (await response.json()) as { tag_name?: string; html_url?: string }
  const version = (data.tag_name ?? '').replace(/^v/, '')
  return {
    // 线上版本不高于当前版本即视为最新（本地比线上新时也成立）
    latest: compareVersion(version, getAppVersion()) <= 0,
    version,
    url: data.html_url ?? GITHUB_HOME,
  }
}

/** 关于软件：通用设置最底部，弹窗展示开发者、项目、版本与免责声明，可检查更新 */
const AboutSetting = () => {
  const t = useTranslate()
  const aboutOpen = useSettingsDialog((state) => state.aboutOpen)
  return (
    <>
      <SettingCell
        icon={<IconSettingInfo />}
        label={t('settingsAbout')}
        status={null}
        action={
          <Button variant="outlined" size="m" className={styles.cellButton} onClick={openAbout}>
            {t('about')}
          </Button>
        }
      />
      {aboutOpen ? <AboutDialog onClose={closeAbout} /> : null}
    </>
  )
}

const AboutDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [update, setUpdate] = useState<UpdateState>('idle')
  const [latestVersion, setLatestVersion] = useState('')
  const [releaseUrl, setReleaseUrl] = useState(GITHUB_HOME)

  const onCheck = async () => {
    setUpdate('checking')
    try {
      const result = await checkUpdate()
      setLatestVersion(result.version)
      setReleaseUrl(result.url)
      setUpdate(result.latest ? 'latest' : 'available')
    } catch {
      setUpdate('error')
    }
  }

  return (
    <Modal title={t('settingsAbout')} closable className={styles.aboutDialog} onClose={onClose}>
      <div className={styles.about}>
        <img className={styles.aboutAvatar} src={DEV_AVATAR} alt="" />
        <div className={styles.aboutName}>{t('aboutDeveloperName')}</div>
        <a className={styles.aboutProject} href={GITHUB_HOME} target="_blank" rel="noreferrer">
          {t('aboutProject')}
        </a>
        <div className={styles.aboutVersion}>{t('aboutVersion', { version: getAppVersion() })}</div>
        <p className={styles.aboutDisclaimer}>{t('aboutDisclaimer')}</p>
        <Button
          variant="outlined"
          size="m"
          className={styles.aboutCheckButton}
          disabled={update === 'checking'}
          onClick={() => void onCheck()}
        >
          {update === 'checking' ? t('aboutChecking') : t('aboutCheckUpdate')}
        </Button>
        {update === 'latest' ? (
          <div className={styles.aboutUpdate}>
            {t('aboutLatest', { version: latestVersion || getAppVersion() })}
          </div>
        ) : null}
        {update === 'available' ? (
          <a className={styles.aboutUpdate} href={releaseUrl} target="_blank" rel="noreferrer">
            {t('aboutAvailable', { version: latestVersion })}
          </a>
        ) : null}
        {update === 'error' ? (
          <div className={styles.aboutUpdate}>{t('aboutCheckFailed')}</div>
        ) : null}
      </div>
    </Modal>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  icon,
  label,
  description,
  status,
  action,
  className,
}: {
  icon?: ReactNode
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      {icon ? <span className={styles.cellIcon}>{icon}</span> : null}
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      icon={<IconUploadOutline14 />}
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled || historyImport.busy || historyImport.reading}
            onClick={() => historyImport.pick(() => inputRef.current?.click())}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
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
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      icon={<IconDownloadOutline16 />}
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
