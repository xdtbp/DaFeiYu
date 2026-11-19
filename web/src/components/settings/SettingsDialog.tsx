import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  hasNativeArchivePicker,
  pickArchiveNative,
  registerArchiveHandlers,
} from '../../services/chat/archivePicker.js'
import { useChatStore } from '../../services/chat/store.js'
import { useAccount } from '../../services/account.js'
import { finishProgress, startProgress, useProgress } from '../../services/chat/progress.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setAuthRoute,
  setCollapseThinking,
  setModel,
  setFontScale,
  setLocale,
  setLocation,
  setMaxTokens,
  setReasoningEffort,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import type { ThinkingEffort } from '../../services/api/types.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { BalanceCard } from './BalanceCard.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
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
              <CollapseThinkingSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
            </>
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <BalanceCard />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <HistoryProgress kind="import" />
              <ExportHistory disabled={historyBusy} />
              <HistoryProgress kind="export" />
              <SettingCell
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
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
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
  const signedIn = useAccount((state) => state.status === 'signed-in')
  const value = `${authRoute}:${model}`
  const options = [
    { value: 'apikey:deepseek-flash', label: `${t('modelSourceApikey')} · DeepSeek-V4.1-Flash` },
    { value: 'apikey:deepseek-v4-pro', label: `${t('modelSourceApikey')} · DeepSeek-V4-Pro` },
    { value: 'account:deepseek-flash', label: `${t('modelSourceAccount')} · DeepSeek-V4.1-Flash` },
    { value: 'account:deepseek-v4-pro', label: `${t('modelSourceAccount')} · DeepSeek-V4-Pro` },
  ]
  const onChange = (next: string) => {
    const [route, id] = next.split(':')
    setAuthRoute(route === 'account' ? 'account' : 'apikey')
    setModel(id === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash')
  }
  const warning =
    authRoute === 'account' && !signedIn
      ? { key: 'modelAccountNotSignedIn' as const, error: true }
      : null
  return (
    <SettingCell
      label={t('settingsModel')}
      status={warning}
      action={<Select ariaLabel={t('settingsModel')} value={value} options={options} onChange={onChange} />}
    />
  )
}

/** 思考过程默认折叠：只显示「已思考（用时 N 秒）」，点标题展开 */
const CollapseThinkingSetting = () => {
  const t = useTranslate()
  const collapseThinking = useSettings((state) => state.collapseThinking)
  return (
    <SettingCell
      label={t('settingsCollapseThinking')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsCollapseThinking')}
          value={collapseThinking ? 'on' : 'off'}
          options={[
            { value: 'on', label: t('collapseThinkingOn') },
            { value: 'off', label: t('collapseThinkingOff') },
          ]}
          onChange={(value) => setCollapseThinking(value === 'on')}
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
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
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
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  // 原生选择器把选中的 ZIP 复制好之后会回调到这里
  useEffect(() => {
    if (!hasNativeArchivePicker()) {
      return
    }
    registerArchiveHandlers({
      onReady: (picked) => {
        setReading(false)
        setStatus(null)
        setFile(picked)
        finishProgress()
      },
      onError: () => {
        setReading(false)
        setStatus({ key: 'historyImportFailed', error: true })
        finishProgress()
      },
      onBusy: (busy) => {
        setReading(busy)
        if (busy) {
          startProgress('reading')
        } else {
          finishProgress()
        }
      },
    })
    return () => registerArchiveHandlers(null)
  }, [])

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const result = await importHistory(file)
      setStatus(
        result.skipped > 0
          ? {
              key: 'importPartial',
              params: { count: result.count, skipped: result.skipped },
            }
          : {
              key: result.count === 1 ? 'historyImportedOne' : 'historyImported',
              params: { count: result.count },
            }
      )
    } catch (error) {
      // BackupError 带着具体原因（版本过新/内容不完整…），直接展示给用户
      setStatus({
        key: error instanceof BackupError ? error.key : 'historyImportFailed',
        error: true,
      })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  const pick = (fallback: () => void) => {
    if (!hasNativeArchivePicker()) {
      fallback()
      return
    }
    setStatus({ key: 'importReading' })
    setReading(true)
    startProgress('reading')
    void pickArchiveNative()
  }

  return {
    file,
    busy,
    reading,
    status,
    select: setFile,
    cancel: () => setFile(null),
    confirm,
    pick,
  }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
/** 导入 / 导出进度条：显示百分比与「已处理/总数」，让用户知道还要等多久 */
const HistoryProgress = ({ kind }: { kind: 'import' | 'export' }) => {
  const t = useTranslate()
  const progress = useProgress()
  const reading = kind === 'import' && progress.kind === 'reading'
  if (progress.kind !== kind && !reading) {
    return null
  }
  const percent = Math.round((reading ? 0 : progress.value) * 100)
  return (
    <div className={styles.progress}>
      <div className={styles.progressTrack}>
        <div
          className={clsx(styles.progressFill, reading && styles.progressIndeterminate)}
          style={reading ? undefined : { width: `${percent}%` }}
        />
      </div>
      <span className={styles.progressText}>
        {reading ? t('importReading') : progress.detail || `${percent}%`}
      </span>
    </div>
  )
}

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
