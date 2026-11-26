import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconDataOutline16,
  IconDownloadOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { BackupError, clearHistory, exportHistory } from '../../services/chat/backup.js'
import { exportLogFile } from '../../services/log.js'
import {
  checkUpdate,
  GITHUB_HOME,
  GITHUB_OWNER,
  getAppVersion,
} from '../../services/update.js'
import {
  setWebviewDebug,
  webviewDebugEnabled,
  webviewDebugSupported,
} from '../../services/webviewDebug.js'
import { HistoryProgress } from '../history/HistoryProgress.js'
import { useHistoryImport } from '../history/useHistoryImport.js'
import { useChatStore } from '../../services/chat/store.js'
import { useAccount } from '../../services/account.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setAuthRoute,
  setChatRelay,
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
import { ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { BalanceCard } from './BalanceCard.js'
import { useLocalProfile, readAvatar } from '../../services/localProfile.js'
import { RelayEditPage, RelayListPage, RoutesPage, SubPage } from './RelayPages.js'
import { useRelay } from '../../services/relay.js'
import {
  IconSettingBolt,
  IconSettingDebug,
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
  popSettingsPage,
  pushSettingsPage,
  setSettingsSection,
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
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const section = useSettingsDialog((state) => state.section)
  const pages = useSettingsDialog((state) => state.pages)
  const closingPage = useSettingsDialog((state) => state.closingPage)
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
      setSettingsSection(next.value)
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
              aria-selected={section === item.value && pages.length === 0}
              className={clsx(
                styles.navItem,
                section === item.value && pages.length === 0 && styles.navItemActive
              )}
              onClick={() => setSettingsSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div className={styles.body}>
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
              <ModelConfigSetting onOpen={() => pushSettingsPage({ key: 'model-config' })} />
              <InterfaceSetting onOpen={() => pushSettingsPage({ key: 'interface' })} />
              <ProfileSetting onOpen={() => pushSettingsPage({ key: 'profile' })} />
              <RoutesSetting onOpen={() => pushSettingsPage({ key: 'routes' })} />
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
              <RelaySetting onOpen={() => pushSettingsPage({ key: 'relay' })} />
              <AlwaysSyncSetting />
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
            </>
          )}
        </div>
          {[...pages, ...(closingPage ? [closingPage] : [])].map((page, index) => {
            const closing = closingPage === page
            const zIndex = 10 + index
            if (page.key === 'routes') {
              return <RoutesPage key="routes" onBack={popSettingsPage} closing={closing} zIndex={zIndex} />
            }
            if (page.key === 'model-config') {
              return (
                <SubPage
                  key="model-config"
                  title={t('settingsModelConfig')}
                  onBack={popSettingsPage}
                  closing={closing}
                  zIndex={zIndex}
                >
                  <ReasoningSetting />
                  <MaxTokensSetting />
                </SubPage>
              )
            }
            if (page.key === 'interface') {
              return (
                <SubPage
                  key="interface"
                  title={t('settingsInterface')}
                  onBack={popSettingsPage}
                  closing={closing}
                  zIndex={zIndex}
                >
                  <FontSizeSetting />
                  <ThemeSetting />
                  <LocaleSetting />
                  <ThinkingDisplaySetting />
                  <TtsVoiceSetting />
                </SubPage>
              )
            }
            if (page.key === 'profile') {
              return (
                <SubPage
                  key="profile"
                  title={t('relayIdentityTitle')}
                  onBack={popSettingsPage}
                  closing={closing}
                  zIndex={zIndex}
                >
                  <ProfileSourceSetting />
                  <LocalProfileEditor />
                  <LocationSetting />
                </SubPage>
              )
            }
            if (page.key === 'relay') {
              return (
                <RelayListPage
                  key="relay"
                  onBack={popSettingsPage}
                  closing={closing}
                  zIndex={zIndex}
                  onEdit={(relayId) => pushSettingsPage({ key: 'relay-edit', relayId })}
                />
              )
            }
            return (
              <RelayEditPage
                key={`relay-edit-${page.relayId ?? 'new'}`}
                relayId={page.relayId}
                onBack={popSettingsPage}
                closing={closing}
                zIndex={zIndex}
              />
            )
          })}
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
    <div className={clsx(styles.cell, styles.locationCell)}>
      <div className={styles.locationHead}>
        <span className={styles.cellIcon}>
          <IconSettingLocation />
        </span>
        <div className={styles.label}>{t('settingsLocation')}</div>
      </div>
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
    </div>
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

const themeOptions: { value: ThemePreference; label: TranslationKey }[] = [
  { value: 'light', label: 'avatarMenuSettingsDialogThemeSelectLightOption' },
  { value: 'dark', label: 'avatarMenuSettingsDialogThemeSelectDarkOption' },
  { value: 'system', label: 'avatarMenuSettingsDialogThemeSelectSystemOption' },
]

/**
 * 深色设置：与其它设置项同排，右侧是分段选项卡，省出三张卡片的高度。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('settingsDarkMode')
  return (
    <SettingCell
      icon={<IconSettingMoon />}
      label={label}
      status={null}
      action={
        <div role="radiogroup" aria-label={label} className={styles.segmented}>
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={themePreference === option.value}
              className={clsx(
                styles.segment,
                themePreference === option.value && styles.segmentActive
              )}
              onClick={() => setThemePreference(option.value)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      }
    />
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
            { value: '0.85', label: t('fontSizeSmall') },
            { value: '0.95', label: t('fontSizeStandard') },
            { value: '1.05', label: t('fontSizeLarge') },
            { value: '1.15', label: t('fontSizeXLarge') },
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
  const chatRelayId = useSettings((state) => state.chatRelayId)
  const signedIn = useAccount((state) => state.status === 'signed-in')
  const hasKey = Boolean(apiKey)
  const relays = useRelay((state) => state.servers)

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
    // 中继也能对话：共用中继侧配置的 Key，多设备不用各填一份
    ...relays.flatMap((server) => [
      {
        value: `relay:${server.id}:deepseek-flash`,
        label: `${server.name || server.url} · DeepSeek-V4.1-Flash`,
      },
      {
        value: `relay:${server.id}:deepseek-v4-pro`,
        label: `${server.name || server.url} · DeepSeek-V4-Pro`,
      },
    ]),
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

  const preferred = chatRelayId ? `relay:${chatRelayId}:${model}` : `${authRoute}:${model}`
  const value = options.some((option) => option.value === preferred)
    ? preferred
    : options[0].value

  const onChange = (next: string) => {
    if (next.startsWith('relay:')) {
      const [, relayId, modelId] = next.split(':')
      setChatRelay(relayId ?? null)
      setModel(modelId === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash')
      return
    }
    setChatRelay(null)
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
const DEV_AVATAR = `https://github.com/${GITHUB_OWNER}.png`

type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'error'

/** WebView 调试：默认关闭，开启前必须确认风险 */
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
  // 打开时及时刷新作者头像：通过可用的 api.github.com 解析真实头像地址，避免 github.com 直链加载失败
  const [avatarUrl, setAvatarUrl] = useState(DEV_AVATAR)

  useEffect(() => {
    let cancelled = false
    fetch(`https://api.github.com/users/${GITHUB_OWNER}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { avatar_url?: string } | null) => {
        if (!cancelled && typeof data?.avatar_url === 'string' && data.avatar_url) {
          setAvatarUrl(data.avatar_url)
        }
      })
      .catch(() => {
        // 解析失败保留默认地址
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 连点作者头像 5 次：切换 WebView 调试（原「关于软件」里的开关入口）
  const taps = useRef(0)
  const tapTimer = useRef<number | null>(null)
  const onAvatarTap = () => {
    if (!webviewDebugSupported()) {
      return
    }
    taps.current += 1
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current)
    }
    tapTimer.current = window.setTimeout(() => {
      taps.current = 0
    }, 1500)
    if (taps.current < 5) {
      return
    }
    taps.current = 0
    const next = !webviewDebugEnabled()
    setWebviewDebug(next)
    showToast({ key: next ? 'webviewDebugOn' : 'webviewDebugOff' })
  }

  const onCheck = async () => {
    setUpdate('checking')
    try {
      const result = await checkUpdate()
      setLatestVersion(result.version)
      setReleaseUrl(result.url)
      setUpdate(result.upToDate ? 'latest' : 'available')
    } catch {
      setUpdate('error')
    }
  }

  // 日志在写入时就已脱敏，这里直接把文件交给系统分享（选微信 / 邮件发出去）
  const onExportLog = () => {
    try {
      if (exportLogFile() === 'failed') {
        showToast({ key: 'logExportFailed', type: 'error' })
      }
    } catch {
      showToast({ key: 'logExportFailed', type: 'error' })
    }
  }

  return (
    <Modal title={t('settingsAbout')} closable className={styles.aboutDialog} onClose={onClose}>
      <div className={styles.about}>
        {/* 连点头像 5 次开关 WebView 调试：藏起来，避免误触 */}
        <img
          className={styles.aboutAvatar}
          src={avatarUrl}
          referrerPolicy="no-referrer"
          alt=""
          onClick={onAvatarTap}
        />
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
        <Button variant="outlined" size="m" className={styles.aboutCheckButton} onClick={onExportLog}>
          {t('aboutExportLog')}
        </Button>
        <div className={styles.aboutLogHint}>{t('aboutExportLogHint')}</div>
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

/** 通用设置 → 模型配置（推理强度、最大输出长度） */
const ModelConfigSetting = ({ onOpen }: { onOpen: () => void }) => {
  const t = useTranslate()
  return (
    <SettingCell
      icon={<IconSettingThinking />}
      label={t('settingsModelConfig')}
      status={null}
      description={t('settingsModelConfigDesc')}
      action={<SubPageLink />}
      onClick={onOpen}
    />
  )
}

/** 通用设置 → 界面设置（字体、主题、语言、思考过程、朗读音色） */
const InterfaceSetting = ({ onOpen }: { onOpen: () => void }) => {
  const t = useTranslate()
  return (
    <SettingCell
      icon={<IconSettingFont />}
      label={t('settingsInterface')}
      status={null}
      description={t('settingsInterfaceDesc')}
      action={<SubPageLink />}
      onClick={onOpen}
    />
  )
}

/** 通用设置 → 用户信息（来源、本地账号、位置） */
const ProfileSetting = ({ onOpen }: { onOpen: () => void }) => {
  const t = useTranslate()
  const servers = useRelay((state) => state.servers)
  const source = useRelay((state) => state.identitySource)
  const relayId = useRelay((state) => state.identityRelayId)
  const nickname = useLocalProfile((state) => state.nickname)
  const label =
    source === 'local'
      ? `${t('profileLocal')}${nickname ? ` · ${nickname}` : ''}`
      : source === 'relay'
        ? servers.find((server) => server.id === relayId)?.name || t('relayTargetAccount')
        : t('relayTargetAccount')
  return (
    <SettingCell
      icon={<IconSettingInfo />}
      label={t('relayIdentityTitle')}
      status={null}
      description={label}
      action={<SubPageLink />}
      onClick={onOpen}
    />
  )
}

/** 用户信息页：显示来源（账号 / 本地 / 某台中继） */
const ProfileSourceSetting = () => {
  const t = useTranslate()
  const servers = useRelay((state) => state.servers)
  const source = useRelay((state) => state.identitySource)
  const relayId = useRelay((state) => state.identityRelayId)
  const setIdentity = useRelay((state) => state.setIdentity)
  const value = source === 'relay' ? `relay:${relayId}` : source

  return (
    <SettingCell
      icon={<IconSettingInfo />}
      label={t('profileSource')}
      status={null}
      description={t('profileSourceDesc')}
      action={
        <Select
          ariaLabel={t('profileSource')}
          value={value}
          options={[
            { value: 'account', label: t('relayTargetAccount') },
            { value: 'local', label: t('profileLocal') },
            ...servers.map((server) => ({
              value: `relay:${server.id}`,
              label: server.name || server.url,
            })),
          ]}
          onChange={(next) => {
            if (next.startsWith('relay:')) {
              setIdentity('relay', next.slice(6))
            } else {
              setIdentity(next === 'local' ? 'local' : 'account', null)
            }
          }}
        />
      }
    />
  )
}

/** 用户信息页里的本地账号：昵称 + 头像（头像自动裁成正方形并压缩） */
const LocalProfileEditor = () => {
  const t = useTranslate()
  const nickname = useLocalProfile((state) => state.nickname)
  const avatar = useLocalProfile((state) => state.avatar)
  const setNickname = useLocalProfile((state) => state.setNickname)
  const setAvatar = useLocalProfile((state) => state.setAvatar)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className={styles.profileEditor}>
      <button
        type="button"
        className={styles.profileAvatar}
        onClick={() => fileRef.current?.click()}
        aria-label={t('profileAvatarChange')}
      >
        {avatar ? (
          <img src={avatar} alt="" />
        ) : (
          <span>{(nickname || t('profileLocalDefault')).slice(0, 1).toUpperCase()}</span>
        )}
      </button>
      <div className={styles.profileName}>
        <div className={styles.label}>{t('profileNickname')}</div>
        <input
          className={styles.profileInput}
          value={nickname}
          placeholder={t('profileNicknamePlaceholder')}
          onChange={(event) => setNickname(event.target.value.slice(0, 24))}
        />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className={styles.hiddenFile}
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) {
            return
          }
          const data = await readAvatar(file)
          if (data) {
            setAvatar(data)
            showToast({ key: 'profileAvatarSaved' })
          }
        }}
      />
    </div>
  )
}

/** 二级页面入口右侧的箭头（整行都可点，这里只做提示） */
const SubPageLink = () => (
  <span className={styles.subPageLink} aria-hidden>
    ›
  </span>
)

/** 数据管理 → 接口设置 */
const RoutesSetting = ({ onOpen }: { onOpen: () => void }) => {
  const t = useTranslate()
  return (
    <SettingCell
      icon={<IconSettingModel />}
      label={t('relayRoutesTitle')}
      status={null}
      description={t('relayRoutesDesc')}
      action={<SubPageLink />}
      onClick={onOpen}
    />
  )
}

/** 数据管理 → 中继服务器 */
const RelaySetting = ({ onOpen }: { onOpen: () => void }) => {
  const t = useTranslate()
  const servers = useRelay((state) => state.servers)
  const description =
    servers.length === 0
      ? t('relaySectionDesc')
      : servers.map((server) => server.name || server.url).join('、')
  return (
    <SettingCell
      icon={<IconSettingGlobe />}
      label={t('relaySectionTitle')}
      status={null}
      description={description}
      action={<SubPageLink />}
      onClick={onOpen}
    />
  )
}

/** 数据管理 → 始终同步最新消息 */
const AlwaysSyncSetting = () => {
  const t = useTranslate()
  const alwaysSync = useRelay((state) => state.alwaysSync)
  const setAlwaysSync = useRelay((state) => state.setAlwaysSync)
  return (
    <SettingCell
      icon={<IconSettingDebug />}
      label={t('relaySyncAlways')}
      status={null}
      description={t('relaySyncAlwaysDesc')}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={alwaysSync}
          aria-label={t('relaySyncAlways')}
          className={clsx(styles.switch, alwaysSync && styles.switchOn)}
          onClick={() => setAlwaysSync(!alwaysSync)}
        >
          <span className={styles.switchKnob} />
        </button>
      }
    />
  )
}

const SettingCell = ({
  icon,
  label,
  description,
  status,
  action,
  className,
  onClick,
}: {
  icon?: ReactNode
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
  /** 整行可点：二级页面的入口别再让用户去点那个小箭头 */
  onClick?: () => void
}) => {
  const t = useTranslate()
  const content = (
    <>
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
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className={clsx(styles.cell, styles.row, styles.cellClickable, className)}
        onClick={onClick}
      >
        {content}
      </button>
    )
  }
  return <div className={clsx(styles.cell, styles.row, className)}>{content}</div>
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
