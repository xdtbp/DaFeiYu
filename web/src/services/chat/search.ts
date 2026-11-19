import { getReplyText } from './reply.js'
import { loadSession, loadSessionSummaries } from './db.js'

/** 一条搜索命中：标题、用户消息或 AI 回答 */
export type SearchMatch = {
  sessionId: string
  sessionTitle: string
  updatedAt: number
  kind: 'title' | 'user' | 'assistant'
  /** 命中处的上下文片段 */
  snippet: string
}

/** 截取命中词前后一小段上下文，压缩空白 */
const makeSnippet = (text: string, index: number, length: number): string => {
  const start = Math.max(0, index - 18)
  const end = Math.min(text.length, index + length + 40)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

/**
 * 搜索历史：遍历所有会话，匹配标题与消息正文（用户原文 / AI 回答文本），
 * 结果按会话更新时间倒序。不做分词，纯大小写不敏感的子串匹配。
 */
export const searchHistory = async (
  query: string,
  signal?: AbortSignal
): Promise<SearchMatch[]> => {
  const keyword = query.trim().toLowerCase()
  if (!keyword) {
    return []
  }

  const summaries = await loadSessionSummaries()
  const matches: SearchMatch[] = []

  for (const summary of summaries) {
    if (signal?.aborted) {
      break
    }
    if (summary.title.toLowerCase().includes(keyword)) {
      matches.push({
        sessionId: summary.id,
        sessionTitle: summary.title,
        updatedAt: summary.updatedAt,
        kind: 'title',
        snippet: summary.title,
      })
    }

    const session = await loadSession(summary.id)
    if (!session) {
      continue
    }
    for (const message of session.messages) {
      if (signal?.aborted) {
        break
      }
      const text = message.role === 'user' ? message.content : getReplyText(message)
      const index = text.toLowerCase().indexOf(keyword)
      if (index >= 0) {
        matches.push({
          sessionId: summary.id,
          sessionTitle: summary.title,
          updatedAt: summary.updatedAt,
          kind: message.role,
          snippet: makeSnippet(text, index, keyword.length),
        })
      }
    }
  }

  return matches.sort((a, b) => b.updatedAt - a.updatedAt)
}
