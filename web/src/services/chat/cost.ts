import type { MessageUsage } from '../api/types.js'
import type { ChatModelId } from '../settings.js'

/**
 * 每百万 token 的人民币价格。
 * 输入分「未命中缓存（全价）」与「命中缓存（折扣价）」，输出按输出价计算。
 * 价格可能随官方调整，这里用于本地估算展示。
 */
const PRICE_PER_MILLION: Record<
  ChatModelId,
  { input: number; cachedInput: number; output: number }
> = {
  'deepseek-flash': { input: 2, cachedInput: 0.5, output: 8 },
  'deepseek-v4-pro': { input: 4, cachedInput: 1, output: 16 },
}

/** 本次回复的总输入 token（未命中 + 创建缓存 + 命中缓存） */
export const totalInputTokens = (usage: MessageUsage): number =>
  usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens

/** 按 token 用量估算本次请求花费（人民币元）；未知模型按 Flash 计 */
export const estimateCost = (usage: MessageUsage, model: string | null | undefined): number => {
  const key: ChatModelId = model === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash'
  const price = PRICE_PER_MILLION[key]
  const missInput = usage.input_tokens + usage.cache_creation_input_tokens
  const hitInput = usage.cache_read_input_tokens
  return (
    (missInput * price.input + hitInput * price.cachedInput + usage.output_tokens * price.output) /
    1_000_000
  )
}
