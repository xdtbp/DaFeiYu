const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

const toDate = (value: string | number | Date): Date | null => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDate = (
  value: string | number | Date,
  separator: '/' | '-' = '-'
): string | null => {
  const date = toDate(value)
  if (!date) {
    return null
  }
  return [pad(date.getFullYear(), 4), pad(date.getMonth() + 1), pad(date.getDate())].join(separator)
}

export const monthKey = (value: string | number | Date): string | null => {
  const date = toDate(value)
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}` : null
}

/** token 数展示：满 1000 用 k 表示，保留一位小数；不足 1000 原样显示 */
export const formatTokens = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) {
    return '0'
  }
  if (value < 1000) {
    return String(Math.round(value))
  }
  return `${(value / 1000).toFixed(1)}k`
}

/** 金额展示：人民币元，1 元以上保留两位小数，小额保留四位 */
export const formatCost = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(4)
}
