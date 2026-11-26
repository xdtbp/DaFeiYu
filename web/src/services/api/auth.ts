import { useAccount } from '../account.js'
import { useSettings } from '../settings.js'
import { ensureRelayToken, normalizeUrl, relayFor, type ApiKind } from '../relay.js'

/**
 * 官方接口的鉴权头。
 *
 * 三条通道：
 * - API Key：`x-api-key`（Anthropic 兼容）/ `Authorization: Bearer`（OpenAI 兼容与工具接口）
 * - Harness 账号：`x-dsh-auth-token`，令牌由原生侧在登录后保存
 * - 中继：`x-relay-token` 用来过中继自己的鉴权，Authorization / x-api-key 继续留给上游 Key，
 *   这样中继无论有没有配服务端 Key 都能工作。
 */

export type AuthStyle = 'anthropic' | 'bearer'

/** 当前是否走账号通道，并且确实拿到了令牌 */
export const usingAccountAuth = (): boolean =>
  useSettings.getState().authRoute === 'account' && useAccount.getState().token !== ''

const FILES_BETA = 'files-api-2025-04-14'

/**
 * 解析一次请求要用的地址与鉴权头。
 *
 * 返回值里的 base 是「拼接口路径的前缀」：直连时是空串（调用方用 API_ORIGIN），
 * 走中继时是中继的转发前缀；接口路径（/anthropic/v1/messages 等）两边完全一致。
 */
export const resolveAuth = async (
  kind: ApiKind,
  apiKey: string,
  style: AuthStyle,
  beta = false
): Promise<{ base: string | null; headers: Record<string, string> }> => {
  const relay = relayFor(kind)
  if (relay) {
    // 令牌快过期时先换一张新的，避免聊到一半 401
    const ready = await ensureRelayToken(relay)
    const headers: Record<string, string> = { 'x-relay-token': ready.token }
    if (apiKey) {
      // 中继没配服务端 Key 时，上游用的是这枚客户端 Key
      if (style === 'anthropic') {
        headers['x-api-key'] = apiKey
      } else {
        headers.authorization = `Bearer ${apiKey}`
      }
    }
    if (beta) {
      headers['anthropic-beta'] = FILES_BETA
    }
    return { base: `${normalizeUrl(ready.url)}/api/v1/proxy`, headers }
  }

  const headers: Record<string, string> = {}
  if (usingAccountAuth()) {
    headers['x-dsh-auth-token'] = useAccount.getState().token
  } else if (style === 'anthropic') {
    headers['x-api-key'] = apiKey
  } else {
    headers.authorization = `Bearer ${apiKey}`
  }
  if (beta) {
    headers['anthropic-beta'] = FILES_BETA
  }
  return { base: null, headers }
}

/** Anthropic 兼容接口（messages / files）的鉴权头（同步版，供不支持异步的调用点使用） */
export const messageAuthHeaders = (apiKey: string, beta: boolean): Record<string, string> => {
  const headers: Record<string, string> = {}
  if (usingAccountAuth()) {
    headers['x-dsh-auth-token'] = useAccount.getState().token
  } else {
    headers['x-api-key'] = apiKey
  }
  if (beta) {
    headers['anthropic-beta'] = FILES_BETA
  }
  return headers
}

/** OpenAI 兼容与工具接口（asr / tts / balance）的鉴权头（同步版） */
export const bearerAuthHeaders = (apiKey: string): Record<string, string> =>
  usingAccountAuth()
    ? { 'x-dsh-auth-token': useAccount.getState().token }
    : { Authorization: `Bearer ${apiKey}` }
