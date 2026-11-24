import type { MessageUsage } from '../api/types.js'
import type { ChatModelId } from '../settings.js'

/**
 * 每百万 token 的人民币价格（元），按官方价格表区分高峰 / 空闲时段。
 * 输入分「缓存命中」与「缓存未命中」，输出单独计价。
 */
type Price = { cachedHit: number; cachedMiss: number; output: number }

const PRICE: Record<ChatModelId, { peak: Price; offPeak: Price }> = {
  'deepseek-flash': {
    peak: { cachedHit: 0.04, cachedMiss: 2, output: 8 },
    offPeak: { cachedHit: 0.02, cachedMiss: 1, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { cachedHit: 0.3, cachedMiss: 9, output: 27 },
    offPeak: { cachedHit: 0.15, cachedMiss: 4.5, output: 13.5 },
  },
}

/**
 * 是否处于高峰时段。按官方价格页口径（北京时间）：
 * 周一至周五的 09:00–12:00、14:00–18:00 为高峰，其余时段（含周末）为空闲。
 *
 * 官方口径还排除了中国法定节假日，这里按工作日近似；节假日当天会按高峰计价，
 * 影响仅为金额估算的一倍偏差，实际扣费以平台账单为准。
 */
export const isPeakTime = (at: number | Date = Date.now()): boolean => {
  const date = at instanceof Date ? at : new Date(at)
  const beijing = new Date(date.getTime() + 8 * 3600_000)
  const weekday = beijing.getUTCDay()
  if (weekday === 0 || weekday === 6) {
    return false
  }
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/** 本次回复的总输入 token（未命中 + 创建缓存 + 命中缓存） */
export const totalInputTokens = (usage: MessageUsage): number =>
  usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens

/**
 * 按 token 用量与请求时间估算花费（人民币元）。
 * 未知模型按 Flash 计；at 缺失时按当前时间判断高峰 / 空闲。
 */
export const estimateCost = (
  usage: MessageUsage,
  model: string | null | undefined,
  at: number | Date = Date.now()
): number => {
  const key: ChatModelId = model === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash'
  const price = isPeakTime(at) ? PRICE[key].peak : PRICE[key].offPeak
  // 新写入缓存的输入按未命中价计，读缓存按命中价计
  const missInput = usage.input_tokens + usage.cache_creation_input_tokens
  const hitInput = usage.cache_read_input_tokens
  return (
    (missInput * price.cachedMiss +
      hitInput * price.cachedHit +
      usage.output_tokens * price.output) /
    1_000_000
  )
}
