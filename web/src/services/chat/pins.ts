import { create } from 'zustand'

const STORAGE_KEY = 'chat-demo:pinned-sessions'

const readPinned = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
  } catch {
    return []
  }
}

const writePinned = (ids: string[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // 存储不可用（隐私模式等）时只在内存里生效
  }
}

type PinsState = {
  /** 置顶的会话 id，越靠前越新置顶 */
  pinned: string[]
}

export const usePinnedSessions = create<PinsState>(() => ({ pinned: readPinned() }))

export const isPinned = (sessionId: string) =>
  usePinnedSessions.getState().pinned.includes(sessionId)

/** 置顶：新置顶的排到最前面；已在列表里的不重复添加 */
export const pinSessions = (ids: string[]) => {
  if (ids.length === 0) {
    return
  }
  const current = usePinnedSessions.getState().pinned
  const next = [...ids.filter((id) => !current.includes(id)), ...current]
  usePinnedSessions.setState({ pinned: next })
  writePinned(next)
}

export const unpinSessions = (ids: string[]) => {
  if (ids.length === 0) {
    return
  }
  const drop = new Set(ids)
  const next = usePinnedSessions.getState().pinned.filter((id) => !drop.has(id))
  usePinnedSessions.setState({ pinned: next })
  writePinned(next)
}

export const togglePinned = (sessionId: string) => {
  if (isPinned(sessionId)) {
    unpinSessions([sessionId])
  } else {
    pinSessions([sessionId])
  }
}
