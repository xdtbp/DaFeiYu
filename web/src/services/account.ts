import { create } from 'zustand'

/** Platform 钱包：currency 为 CNY / USD，balance 为十进制字符串 */
export type AccountWallet = { currency: string; balance: string }

export type AccountStatus = 'signed-out' | 'authorizing' | 'signed-in' | 'error'

export type AccountState = {
  /** Harness 账号令牌：account 通道用它代替 API Key 调官方接口 */
  token: string
  status: AccountStatus
  name: string
  avatar: string
  email: string
  balance: AccountWallet[]
  bonus: AccountWallet[]
  message: string
  /** 是否正在刷新资料/余额 */
  refreshing: boolean
}

type NativeAccountPayload = Partial<AccountState> & { status?: AccountStatus }

type NativeAuthBridge = {
  cached: () => string
  token?: () => string
  signIn: () => void
  refresh: () => void
  signOut: () => void
}

const initial: AccountState = {
  token: '',
  status: 'signed-out',
  name: '',
  avatar: '',
  email: '',
  balance: [],
  bonus: [],
  message: '',
  refreshing: false,
}

export const useAccount = create<AccountState>(() => ({ ...initial }))

const bridge = (): NativeAuthBridge | undefined =>
  (window as unknown as { AndroidAuth?: NativeAuthBridge }).AndroidAuth

/** 是否运行在带账号能力的原生壳里 */
export const hasNativeAccount = () => bridge() !== undefined

const parse = (raw: unknown): NativeAccountPayload => {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as NativeAccountPayload
    } catch {
      return {}
    }
  }
  return (raw ?? {}) as NativeAccountPayload
}

const wallets = (value: unknown): AccountWallet[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is AccountWallet =>
          typeof item === 'object' && item !== null && 'balance' in item
      )
    : []

const apply = (payload: NativeAccountPayload) => {
  clearTimeout(pendingTimer)
  const status = payload.status as string | undefined
  if (status === 'authorize') {
    // 原生自己会打开系统浏览器，这里只更新提示状态
    useAccount.setState({ status: 'authorizing', message: '' })
    return
  }
  if (status === 'error') {
    useAccount.setState({
      status: 'error',
      refreshing: false,
      message: payload.message || '登录失败',
    })
    return
  }
  if (status === 'signed-out') {
    useAccount.setState({ ...initial })
    return
  }
  if (status === 'signed-in') {
    clearTimeout(refreshTimer)
    let token = ''
    try {
      token = bridge()?.token?.() ?? ''
    } catch {
      token = ''
    }
    useAccount.setState({
      token,
      status: 'signed-in',
      name: payload.name ?? '',
      avatar: payload.avatar ?? '',
      email: payload.email ?? '',
      balance: wallets(payload.balance),
      bonus: wallets(payload.bonus),
      message: '',
      refreshing: false,
    })
    return
  }
  if (status === 'authorizing') {
    useAccount.setState({ status: 'authorizing', message: '' })
  }
}

/** 挂上原生回调并读取已缓存的账号，App 启动时调用一次 */
export const setupAccount = () => {
  ;(window as unknown as { __dshAuth?: (payload: unknown) => void }).__dshAuth = (payload) =>
    apply(parse(payload))
  const native = bridge()
  if (!native) {
    return
  }
  try {
    apply(parse(native.cached()))
  } catch {
    /* 读取缓存失败时保持未登录状态 */
  }
}

let pendingTimer: ReturnType<typeof setTimeout> | undefined

export const signInAccount = () => {
  const native = bridge()
  if (!native) {
    return
  }
  useAccount.setState({ status: 'authorizing', message: '', refreshing: true })
  native.signIn()
  // 浏览器里没完成授权 / 找不到浏览器时，别让界面一直卡在「等待授权」
  clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    if (useAccount.getState().status === 'authorizing') {
      useAccount.setState({
        status: 'error',
        refreshing: false,
        message: '未完成登录，请重试',
      })
    }
  }, 180_000)
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined

export const refreshAccount = (quiet = false) => {
  const native = bridge()
  if (!native) {
    return
  }
  // 轮询时不显示「刷新中」，避免设置页每次轮询都闪一下
  if (!quiet) {
    useAccount.setState({ refreshing: true })
  }
  native.refresh()
  // 原生迟迟不回调时结束「刷新中」，避免界面一直停在加载态
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    if (useAccount.getState().refreshing) {
      useAccount.setState({ refreshing: false })
    }
  }, 10_000)
}

export const signOutAccount = () => {
  bridge()?.signOut()
  useAccount.setState({ ...initial })
}

/** 取主要币种的余额，用于侧边栏展示 */
export const primaryBalance = (wallets: AccountWallet[]): string => {
  const wallet = wallets[0]
  if (!wallet) {
    return ''
  }
  const symbol = wallet.currency === 'USD' ? '$' : '¥'
  const value = Number(wallet.balance)
  const text = Number.isFinite(value) ? value.toFixed(2) : wallet.balance
  return `${symbol}${text}`
}

/** 同一币种多条钱包相加后展示 */
export const totalBalance = (wallets: AccountWallet[]): string => {
  if (wallets.length === 0) {
    return ''
  }
  const currency = wallets[0].currency
  const sum = wallets
    .filter((wallet) => wallet.currency === currency)
    .reduce((acc, wallet) => acc + (Number(wallet.balance) || 0), 0)
  const symbol = currency === 'USD' ? '$' : '¥'
  return `${symbol}${sum.toFixed(2)}`
}
