import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import type { ThinkingEffort } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

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
  /** 思考过程默认折叠，点击标题才展开 */
  collapseThinking: boolean
  /** 当前对话走哪条通道；account 需要先登录 Harness 账号 */
  authRoute: AuthRoute
  /** 官方模型选择 */
  model: ChatModelId
  siderCollapsed: boolean
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
  collapseThinking: 'chat-demo:collapse-thinking',
  authRoute: 'chat-demo:auth-route',
  model: 'chat-demo:model',
  siderCollapsed: 'chat-demo:sider-collapsed',
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

/** 字号缩放，默认 1（标准） */
const initialFontScale = (): number => {
  const saved = read(KEYS.fontScale)
  if (!saved) {
    return 1
  }
  const value = Number(saved)
  return Number.isFinite(value) && value >= 0.8 && value <= 1.5 ? value : 1
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
  collapseThinking: read(KEYS.collapseThinking) !== 'false',
  authRoute: read(KEYS.authRoute) === 'account' ? 'account' : 'apikey',
  model: read(KEYS.model) === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
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

export const setCollapseThinking = (collapseThinking: boolean) => {
  write(KEYS.collapseThinking, String(collapseThinking))
  useSettings.setState({ collapseThinking })
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
