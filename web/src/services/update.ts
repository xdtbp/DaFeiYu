export const GITHUB_OWNER = 'xdtbp'
export const GITHUB_REPO = 'DaFeiYu'
export const GITHUB_HOME = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`

const SKIP_KEY = 'chat-demo:skip-version'

/** 当前版本号：优先从原生壳读取 versionName，回退到固定值 */
export const getAppVersion = (): string => {
  const bridge = (window as unknown as { AndroidApp?: { version?: () => string } }).AndroidApp
  try {
    const version = bridge?.version?.()
    if (version) {
      return version
    }
  } catch {
    /* 回退到默认 */
  }
  return '0.8.7'
}

/** 语义化版本比较：a > b 返回正数，a < b 返回负数，相等返回 0 */
export const compareVersion = (a: string, b: string): number => {
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

export type UpdateInfo = {
  /** 线上版本不高于本地（无需更新） */
  upToDate: boolean
  version: string
  url: string
}

/** 读取 GitHub 最新 Release，与本地版本按语义化版本比较 */
export const checkUpdate = async (): Promise<UpdateInfo> => {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  )
  if (!response.ok) {
    throw new Error(String(response.status))
  }
  const data = (await response.json()) as { tag_name?: string; html_url?: string }
  const version = (data.tag_name ?? '').replace(/^v/, '')
  return {
    upToDate: compareVersion(version, getAppVersion()) <= 0,
    version,
    url: data.html_url ?? GITHUB_HOME,
  }
}

/** 用户选择「跳过此版本」后记住，等更高版本出现时再提示 */
export const skippedVersion = (): string => {
  try {
    return localStorage.getItem(SKIP_KEY) ?? ''
  } catch {
    return ''
  }
}

export const skipVersion = (version: string) => {
  try {
    localStorage.setItem(SKIP_KEY, version)
  } catch {
    /* 存储不可用时本次会话内不再提示 */
  }
}
