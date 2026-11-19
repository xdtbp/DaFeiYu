import { useAccount } from '../account.js'
import { useSettings } from '../settings.js'

/**
 * 官方接口的鉴权头。
 *
 * 两条通道都可用：
 * - API Key：`x-api-key`（Anthropic 兼容）/ `Authorization: Bearer`（OpenAI 兼容与工具接口）
 * - Harness 账号：`x-dsh-auth-token`，令牌由原生侧在登录后保存
 *
 * 实测账号令牌可直接用于 /anthropic/v1/messages、/chat/completions、/v1/tools/asr，
 * 因此登录账号即可对话，无需填写 API Key。
 */

/** 当前是否走账号通道，并且确实拿到了令牌 */
export const usingAccountAuth = (): boolean =>
  useSettings.getState().authRoute === 'account' && useAccount.getState().token !== ''

/** Anthropic 兼容接口（messages / files）的鉴权头 */
export const messageAuthHeaders = (apiKey: string, beta: boolean): Record<string, string> => {
  const headers: Record<string, string> = {}
  if (usingAccountAuth()) {
    headers['x-dsh-auth-token'] = useAccount.getState().token
  } else {
    headers['x-api-key'] = apiKey
  }
  if (beta) {
    headers['anthropic-beta'] = 'files-api-2025-04-14'
  }
  return headers
}

/** OpenAI 兼容与工具接口（asr / tts / balance）的鉴权头 */
export const bearerAuthHeaders = (apiKey: string): Record<string, string> =>
  usingAccountAuth()
    ? { 'x-dsh-auth-token': useAccount.getState().token }
    : { Authorization: `Bearer ${apiKey}` }
