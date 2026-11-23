import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import type { ThinkingEffort } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 思考过程展示：折叠 / 完整展开 / 仅展示最新部分（限高滚动） */
export type ThinkingDisplay = 'collapsed' | 'full' | 'latest'

/** 对话通道：官方 API Key / Harness 登录账号 / 第三方 OpenAI 兼容服务 */
export type AuthRoute = 'apikey' | 'account'

/** 可选的官方模型 */
export type ChatModelId = 'deepseek-flash' | 'deepseek-v4-pro'



/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  /** 推理强度（开启深度思考时生效）：low / high / max */
  reasoningEffort: ThinkingEffort
  /** 输出 token 上限；null 表示交给服务端默认 */
  maxTokens: number | null
  /** 界面字号缩放，1 为标准 */
  fontScale: number
  /** 当前对话走哪条通道；account 需要先登录 Harness 账号 */
  authRoute: AuthRoute
  /** 官方模型选择 */
  model: ChatModelId
  siderCollapsed: boolean
  /** 思考过程展示方式 */
  thinkingDisplay: ThinkingDisplay
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  reasoningEffort: 'chat-demo:reasoning-effort',
  maxTokens: 'chat-demo:max-tokens',
  fontScale: 'chat-demo:font-scale',
  /** 旧版「默认折叠」开关，仅用于迁移到三态 */
  legacyCollapseThinking: 'chat-demo:collapse-thinking',
  authRoute: 'chat-demo:auth-route',
  model: 'chat-demo:model',
  siderCollapsed: 'chat-demo:sider-collapsed',
  thinkingDisplay: 'chat-demo:thinking-display',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 思考过程默认「仅展示最新部分」；旧版「默认折叠」开关迁移到三态 */
const initialThinkingDisplay = (): ThinkingDisplay => {
  const saved = read(KEYS.thinkingDisplay)
  if (saved === 'collapsed' || saved === 'full' || saved === 'latest') {
    return saved
  }
  const legacy = read(KEYS.legacyCollapseThinking)
  if (legacy !== null) {
    return legacy === 'false' ? 'full' : 'collapsed'
  }
  return 'latest'
}

/** 推理强度默认 high，与服务端思考模式默认强度一致 */
const initialReasoningEffort = (): ThinkingEffort => {
  const saved = read(KEYS.reasoningEffort)
  return saved === 'low' || saved === 'high' || saved === 'max' ? saved : 'high'
}

/** 输出上限默认交给服务端决定 */
const initialMaxTokens = (): number | null => {
  const saved = read(KEYS.maxTokens)
  if (!saved) {
    return null
  }
  const value = Number(saved)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 字号缩放档位：小 / 标准 / 大 / 特大（整体比旧版更小一档） */
export const FONT_SCALES = [0.85, 0.95, 1.05, 1.15] as const

/** 默认 0.95（标准）；旧版保存的 1 / 1.1 / 1.25 不在档位内时回落到标准 */
const initialFontScale = (): number => {
  const value = Number(read(KEYS.fontScale))
  return (FONT_SCALES as readonly number[]).includes(value) ? value : 0.95
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  reasoningEffort: initialReasoningEffort(),
  maxTokens: initialMaxTokens(),
  fontScale: initialFontScale(),
  authRoute: read(KEYS.authRoute) === 'apikey' ? 'apikey' : 'account',
  model: read(KEYS.model) === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  thinkingDisplay: initialThinkingDisplay(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setReasoningEffort = (reasoningEffort: ThinkingEffort) => {
  write(KEYS.reasoningEffort, reasoningEffort)
  useSettings.setState({ reasoningEffort })
}

export const setMaxTokens = (maxTokens: number | null) => {
  write(KEYS.maxTokens, maxTokens === null ? null : String(maxTokens))
  useSettings.setState({ maxTokens })
}

export const setFontScale = (fontScale: number) => {
  write(KEYS.fontScale, String(fontScale))
  useSettings.setState({ fontScale })
}

export const setAuthRoute = (authRoute: AuthRoute) => {
  write(KEYS.authRoute, authRoute)
  useSettings.setState({ authRoute })
}

export const setModel = (model: ChatModelId) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setThinkingDisplay = (thinkingDisplay: ThinkingDisplay) => {
  write(KEYS.thinkingDisplay, thinkingDisplay)
  useSettings.setState({ thinkingDisplay })
}
