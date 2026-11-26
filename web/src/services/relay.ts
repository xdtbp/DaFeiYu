import { create } from 'zustand'
import { useSettings } from './settings.js'
import { createId } from '../utils/id.js'

/**
 * 中继（自建服务层）：配置、登录换令牌、接口分流。
 *
 * 令牌单独走 `x-relay-token`，Authorization / x-api-key 留给上游 API Key，
 * 这样中继有没有配服务端 Key 都不会互相打架。
 */

export type ApiKind = 'chat' | 'search' | 'parse' | 'speech'
export type RouteTarget = 'account' | 'apikey' | 'relay'

export type RelayServer = {
  id: string
  /** 显示名称，接口分流里用它 */
  name: string
  /** 形如 https://relay.example.com:8443，不带结尾斜杠 */
  url: string
  username: string
  /** 仅存本机，用于令牌过期后自动重新登录 */
  password: string
  token: string
  tokenExpiresAt: number
  /** 中继返回的账号名，用于「用户信息」来源 */
  userName: string
  lastStatus: 'unknown' | 'ok' | 'error'
  lastError: string
  lastCheckedAt: number
}

export type RouteChoice = {
  target: RouteTarget
  /** target 为 relay 时指向某台中继 */
  relayId: string | null
}

type Persisted = {
  servers: RelayServer[]
  routes: Record<ApiKind, RouteChoice>
  alwaysSync: boolean
  identitySource: 'account' | 'local' | 'relay'
  identityRelayId: string | null
}

const KEY = 'chat-demo:relay'

const defaultRoutes = (): Record<ApiKind, RouteChoice> => ({
  chat: { target: 'account', relayId: null },
  search: { target: 'account', relayId: null },
  parse: { target: 'account', relayId: null },
  speech: { target: 'account', relayId: null },
})

const load = (): Persisted => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      throw new Error('empty')
    }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    const routes = defaultRoutes()
    for (const kind of Object.keys(routes) as ApiKind[]) {
      const saved = parsed.routes?.[kind]
      if (saved && (saved.target === 'account' || saved.target === 'apikey' || saved.target === 'relay')) {
        routes[kind] = { target: saved.target, relayId: saved.relayId ?? null }
      }
    }
    return {
      servers: Array.isArray(parsed.servers) ? (parsed.servers as RelayServer[]) : [],
      routes,
      alwaysSync: parsed.alwaysSync === true,
      identitySource:
        parsed.identitySource === 'relay' || parsed.identitySource === 'local'
          ? parsed.identitySource
          : 'account',
      identityRelayId: parsed.identityRelayId ?? null,
    }
  } catch {
    return {
      servers: [],
      routes: defaultRoutes(),
      alwaysSync: false,
      identitySource: 'account',
      identityRelayId: null,
    }
  }
}

const save = (state: Persisted) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 配额满时忽略：配置丢失比崩溃好
  }
}

type RelayState = Persisted & {
  saveServer: (server: Omit<RelayServer, 'lastStatus' | 'lastError' | 'lastCheckedAt'> & Partial<RelayServer>) => void
  removeServer: (id: string) => void
  patchServer: (id: string, patch: Partial<RelayServer>) => void
  setRoute: (kind: ApiKind, choice: RouteChoice) => void
  setAlwaysSync: (value: boolean) => void
  setIdentity: (source: 'account' | 'local' | 'relay', relayId: string | null) => void
}

const persist = (get: () => RelayState) => {
  const { servers, routes, alwaysSync, identitySource, identityRelayId } = get()
  save({ servers, routes, alwaysSync, identitySource, identityRelayId })
}

export const useRelay = create<RelayState>((set) => ({
  ...load(),
  saveServer: (server) =>
    set((state) => {
      const exists = state.servers.some((item) => item.id === server.id)
      const next: RelayServer = {
        lastStatus: 'unknown',
        lastError: '',
        lastCheckedAt: 0,
        ...server,
        id: server.id || createId(),
      } as RelayServer
      const servers = exists
        ? state.servers.map((item) => (item.id === next.id ? { ...item, ...next } : item))
        : [...state.servers, next]
      return { servers }
    }),
  removeServer: (id) =>
    set((state) => {
      const routes = { ...state.routes }
      for (const kind of Object.keys(routes) as ApiKind[]) {
        if (routes[kind].relayId === id) {
          routes[kind] = { target: 'account', relayId: null }
        }
      }
      return {
        servers: state.servers.filter((item) => item.id !== id),
        routes,
        identityRelayId: state.identityRelayId === id ? null : state.identityRelayId,
        identitySource: state.identitySource === 'relay' && state.identityRelayId === id ? 'account' : state.identitySource,
      }
    }),
  patchServer: (id, patch) =>
    set((state) => ({
      servers: state.servers.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),
  setRoute: (kind, choice) => set((state) => ({ routes: { ...state.routes, [kind]: choice } })),
  setAlwaysSync: (value) => set({ alwaysSync: value }),
  setIdentity: (source, relayId) => set({ identitySource: source, identityRelayId: relayId }),
}))

// zustand 的 subscribe 在每次 set 后触发，统一落盘，避免每个 action 里都写一遍
useRelay.subscribe(() => persist(useRelay.getState))

/* ------------------------------------------------------------------ 工具 */

/** 允许用户只填 IP 或漏写协议：默认补 https，本机地址补 http */
export const normalizeUrl = (raw: string): string => {
  let text = raw.trim()
  if (!text) {
    return ''
  }
  if (!/^https?:\/\//i.test(text)) {
    text = /^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(text)
      ? `http://${text}`
      : `https://${text}`
  }
  return text.replace(/\/+$/, '')
}

export const findServer = (id: string | null | undefined): RelayServer | null =>
  useRelay.getState().servers.find((server) => server.id === id) ?? null

/**
 * 某个接口类别当前走哪台中继；没配或找不到就返回 null（回落直连）。
 * 对话不走这里：它跟随「模型」里选的来源（账号 / API Key），避免两处设置打架。
 */
export const relayFor = (kind: ApiKind): RelayServer | null => {
  if (kind === 'chat') {
    // 对话由「模型」里选的来源决定，不再单独配置
    const id = useSettings.getState().chatRelayId
    return id ? findServer(id) : null
  }
  const choice = useRelay.getState().routes[kind]
  if (choice.target !== 'relay') {
    return null
  }
  return findServer(choice.relayId)
}

export const isRelayRoute = (kind: ApiKind): boolean =>
  useRelay.getState().routes[kind].target === 'relay'

/* -------------------------------------------------------------- 网络请求 */

const withTimeout = async (url: string, init: RequestInit, ms = 8000): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 中继公开信息：地址是否可用、是否要登录 */
export const fetchRelayInfo = async (url: string) => {
  const base = normalizeUrl(url)
  const response = await withTimeout(`${base}/api/v1/relay/info`, { method: 'GET' })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return (await response.json()) as { name?: string; version?: string; authRequired?: boolean }
}

/** 用户名 + 密码换令牌 */
export const loginRelay = async (url: string, username: string, password: string, device = 'android') => {
  const base = normalizeUrl(url)
  const response = await withTimeout(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, device }),
  })
  const data = (await response.json().catch(() => ({}))) as {
    token?: string
    expiresAt?: number
    user?: { username?: string }
    error?: string
  }
  if (!response.ok || !data.token) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }
  return {
    token: data.token,
    tokenExpiresAt: data.expiresAt ?? Date.now() + 30 * 86400_000,
    userName: data.user?.username ?? username,
  }
}

/** 令牌快过期就重登一次；失败时把错误挂到服务器状态上 */
export const ensureRelayToken = async (server: RelayServer): Promise<RelayServer> => {
  if (server.token && server.tokenExpiresAt - Date.now() > 60_000) {
    return server
  }
  if (!server.username || !server.password) {
    throw new Error('中继未保存账号密码')
  }
  const result = await loginRelay(server.url, server.username, server.password)
  const next = { ...server, ...result }
  useRelay.getState().patchServer(server.id, result)
  return next
}

/** 测试连接：先拿公开信息，再用账号登录并读一次同步状态 */
export const testRelay = async (server: RelayServer): Promise<{ ok: boolean; message: string }> => {
  try {
    const info = await fetchRelayInfo(server.url)
    const login = await loginRelay(server.url, server.username, server.password)
    const response = await withTimeout(`${normalizeUrl(server.url)}/api/v1/sync/state`, {
      method: 'GET',
      headers: { 'x-relay-token': login.token },
    })
    if (!response.ok) {
      throw new Error(`同步接口 HTTP ${response.status}`)
    }
    const state = (await response.json()) as { sessions?: number }
    useRelay.getState().patchServer(server.id, {
      ...login,
      lastStatus: 'ok',
      lastError: '',
      lastCheckedAt: Date.now(),
    })
    return {
      ok: true,
      message: `连接成功 · ${info.name ?? '中继'} v${info.version ?? '?'} · ${state.sessions ?? 0} 个会话`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    useRelay.getState().patchServer(server.id, {
      lastStatus: 'error',
      lastError: message,
      lastCheckedAt: Date.now(),
    })
    return { ok: false, message }
  }
}

/** 带中继令牌的请求；401 时自动重登一次再试 */
export const relayFetch = async (
  server: RelayServer,
  path: string,
  init: RequestInit = {}
): Promise<Response> => {
  let current = await ensureRelayToken(server)
  const send = (token: string) =>
    fetch(`${normalizeUrl(current.url)}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), 'x-relay-token': token },
    })
  let response = await send(current.token)
  if (response.status === 401) {
    current = await ensureRelayToken({ ...current, token: '' })
    response = await send(current.token)
  }
  return response
}
