import { useSyncExternalStore } from 'react'
import { useSettings, type ThemePreference } from '../services/settings.js'

export type Theme = 'light' | 'dark'

const query = window.matchMedia('(prefers-color-scheme: dark)')

type NativeThemeBridge = {
  applyTheme: (background: string, dark: boolean) => void
  setTextZoom: (percent: number) => void
  isSystemDark?: () => boolean
}

const nativeTheme = () =>
  (window as unknown as { AndroidTheme?: NativeThemeBridge }).AndroidTheme

/** 读取系统深浅色：原生壳优先（WebView 的 prefers-color-scheme 在固定亮色主题下不跟随系统） */
const readOsTheme = (): Theme => {
  const native = nativeTheme()
  if (native?.isSystemDark) {
    try {
      return native.isSystemDark() ? 'dark' : 'light'
    } catch {
      /* 回退到媒体查询 */
    }
  }
  return query.matches ? 'dark' : 'light'
}

let osTheme: Theme = readOsTheme()

const osListeners = new Set<() => void>()

const setOsTheme = (theme: Theme) => {
  if (theme !== osTheme) {
    osTheme = theme
    for (const listener of osListeners) {
      listener()
    }
  }
}

const subscribeOsTheme = (listener: () => void) => {
  osListeners.add(listener)
  if (osListeners.size === 1) {
    query.addEventListener('change', onMediaQueryChange)
  }
  return () => {
    osListeners.delete(listener)
    if (osListeners.size === 0) {
      query.removeEventListener('change', onMediaQueryChange)
    }
  }
}

const onMediaQueryChange = () => setOsTheme(query.matches ? 'dark' : 'light')

// 原生在系统暗色模式变化时回调（onConfigurationChanged）
;(window as unknown as { __dsSystemDarkChange?: (dark: boolean) => void }).__dsSystemDarkChange =
  (dark: boolean) => setOsTheme(dark ? 'dark' : 'light')

const getOsTheme = (): Theme => osTheme

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：手动选择优先，「跟随系统」时取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  return resolveTheme(preference, osTheme)
}

/** rgb(a) 转 #rrggbb，供原生状态栏使用 */
const toHex = (color: string): string => {
  const match = /rgba?\(([^)]+)\)/.exec(color)
  if (!match) {
    return color.startsWith('#') ? color : '#ffffff'
  }
  const [r, g, b] = match[1].split(',').map((part) => Number(part.trim()) || 0)
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

const syncPageBackground = () => {
  const backgroundColor = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
  // 让原生状态栏/导航栏与页面背景一致，同时切换状态栏图标明暗
  nativeTheme()?.applyTheme(toHex(backgroundColor), document.body.classList.contains('dark'))
}

/** 同步页面主题、根画布背景和支持 theme-color 的浏览器栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  // 首次背景色同步在样式表加载完成后执行，适配 WebKit 的 defer 脚本执行顺序。
  if (document.readyState === 'complete') {
    syncPageBackground()
  }
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
}

let appliedTheme: Theme | null = null

const syncTheme = () => {
  const theme = resolveTheme(useSettings.getState().themePreference, getOsTheme())
  if (theme !== appliedTheme) {
    appliedTheme = theme
    applyTheme(theme)
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  syncTheme()
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  subscribeOsTheme(syncTheme)
  useSettings.subscribe(syncTheme)
}
