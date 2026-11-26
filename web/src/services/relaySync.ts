import { relayFetch, findServer, type RelayServer } from './relay.js'
import { applyRemoteSessions, useChatStore } from './chat/store.js'
import * as db from './chat/db.js'
import { log, logError } from './log.js'
import type { Session } from './chat/types.js'

/**
 * 中继同步：会话级 LWW（最后写入者胜）。
 *
 * 服务端只有「会话 id + rev + updatedAt + 不透明 payload」，
 * 客户端按 updatedAt 决定谁更新，冲突时用服务端返回的 rev 重推一次。
 */

const cursorKey = (id: string) => `chat-demo:relay-cursor:${id}`
const revsKey = (id: string) => `chat-demo:relay-revs:${id}`

type RevEntry = { rev: number; updatedAt: number }
type RevMap = Record<string, RevEntry>

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 配额满时忽略
  }
}

export const relayCursor = (serverId: string): number => readJson<number>(cursorKey(serverId), 0)
const readRevs = (serverId: string): RevMap => readJson<RevMap>(revsKey(serverId), {})
const writeRevs = (serverId: string, revs: RevMap) => writeJson(revsKey(serverId), revs)

export type SyncResult = { pulled: number; pushed: number; removed: number; cursor: number }

type ChangesResponse = {
  cursor: number
  changes: { seq: number; id: string; rev: number; updatedAt: number; deleted: boolean }[]
}

/** 服务端自 since 之后有哪些变更；用于「启动时判断要不要提示同步」 */
export const fetchChanges = async (server: RelayServer, since = relayCursor(server.id)) => {
  const response = await relayFetch(server, `/api/v1/sync/changes?since=${since}`)
  if (!response.ok) {
    throw new Error(`同步接口 HTTP ${response.status}`)
  }
  return (await response.json()) as ChangesResponse
}

const loadLocal = async (id: string): Promise<Session | undefined> => {
  const cached = useChatStore.getState().sessionCache[id]
  return cached ?? (await db.loadSession(id))
}

/**
 * 与某台中继做一次双向同步。
 * 1. 拉变更 → 远端更新的覆盖本地；
 * 2. 推本地比服务端新的会话；
 * 3. 本地已删、服务端还在 → 推墓碑；
 * 4. 保存新游标。
 */
export const syncWithRelay = async (serverId: string): Promise<SyncResult> => {
  const server = findServer(serverId)
  if (!server) {
    throw new Error('中继不存在')
  }
  const store = useChatStore.getState()
  if (!store.ready) {
    return { pulled: 0, pushed: 0, removed: 0, cursor: relayCursor(serverId) }
  }

  const since = relayCursor(serverId)
  const revs = readRevs(serverId)
  const remote = await fetchChanges(server, since)

  const incoming: Session[] = []
  const removed: string[] = []
  let pulled = 0

  for (const change of remote.changes) {
    const local = await loadLocal(change.id)
    if (change.deleted) {
      if (local) {
        removed.push(change.id)
        Reflect.deleteProperty(revs, change.id)
        pulled += 1
      }
      continue
    }
    if (!local || local.updatedAt < change.updatedAt) {
      const response = await relayFetch(server, `/api/v1/sync/sessions/${encodeURIComponent(change.id)}`)
      if (!response.ok) {
        continue
      }
      const body = (await response.json()) as { payload: Session | null; rev: number; updatedAt: number }
      if (body.payload) {
        incoming.push({ ...body.payload, updatedAt: body.updatedAt })
        revs[change.id] = { rev: body.rev, updatedAt: body.updatedAt }
        pulled += 1
      }
    } else {
      revs[change.id] = { rev: change.rev, updatedAt: change.updatedAt }
    }
  }

  if (incoming.length > 0 || removed.length > 0) {
    await applyRemoteSessions(incoming, removed)
  }

  // 推本地更新：服务端没有，或本地 updatedAt 更新
  let pushed = 0
  const localSessions = useChatStore.getState().sessions
  for (const summary of localSessions) {
    const known = revs[summary.id]
    if (known && summary.updatedAt <= known.updatedAt) {
      continue
    }
    const session = await loadLocal(summary.id)
    if (!session) {
      continue
    }
    const body = JSON.stringify({
      baseRev: known?.rev ?? 0,
      updatedAt: session.updatedAt,
      deleted: false,
      payload: session,
    })
    let response = await relayFetch(server, `/api/v1/sync/sessions/${encodeURIComponent(session.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (response.status === 409) {
      const conflict = (await response.json()) as {
        current?: { rev: number; updatedAt: number; payload: Session | null }
      }
      const current = conflict.current
      if (current && current.updatedAt > session.updatedAt && current.payload) {
        // 远端更新：本地让位
        await applyRemoteSessions([{ ...current.payload, updatedAt: current.updatedAt }], [])
        revs[session.id] = { rev: current.rev, updatedAt: current.updatedAt }
        continue
      }
      response = await relayFetch(server, `/api/v1/sync/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRev: current?.rev ?? 0,
          updatedAt: session.updatedAt,
          deleted: false,
          payload: session,
        }),
      })
    }
    if (response.ok) {
      const result = (await response.json()) as { rev: number }
      revs[session.id] = { rev: result.rev, updatedAt: session.updatedAt }
      pushed += 1
    }
  }

  // 本地删掉、服务端还留着的：推墓碑
  const localIds = new Set(useChatStore.getState().sessions.map((item) => item.id))
  for (const [id, entry] of Object.entries(revs)) {
    if (localIds.has(id)) {
      continue
    }
    const response = await relayFetch(server, `/api/v1/sync/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRev: entry.rev }),
    })
    if (response.ok) {
      Reflect.deleteProperty(revs, id)
      pushed += 1
    }
  }

  writeJson(cursorKey(serverId), remote.cursor)
  writeRevs(serverId, revs)
  const result = { pulled, pushed, removed: removed.length, cursor: remote.cursor }
  log.info('sync', '同步完成', { serverId, ...result })
  return result
}

/** 所有「接口设置里用到」的中继都同步一次（同一台只同步一次） */
export const syncAllRelays = async (): Promise<SyncResult[]> => {
  const store = useChatStore.getState()
  if (!store.ready) {
    return []
  }
  const { relays } = useRelayServers()
  const results: SyncResult[] = []
  for (const server of relays) {
    try {
      results.push(await syncWithRelay(server.id))
    } catch (error) {
      logError('sync', '中继同步失败', error, { serverId: server.id })
    }
  }
  return results
}

/** 启动检查：配置了中继时，看服务端有没有比本地更新的变更 */
export const hasRemoteChanges = async (server: RelayServer): Promise<boolean> => {
  try {
    const remote = await fetchChanges(server)
    return remote.changes.some((change) => change.updatedAt > 0)
  } catch {
    return false
  }
}

/** 小工具：从 store 里拿当前配置的所有中继（供同步与设置页共用） */
import { useRelay } from './relay.js'
const useRelayServers = () => ({ relays: useRelay.getState().servers })
