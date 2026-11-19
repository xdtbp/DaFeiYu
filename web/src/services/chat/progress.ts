import { create } from 'zustand'

/** 导入 / 导出进度：0 表示刚开始，1 表示完成；phase 用于文案 */
export type ProgressState = {
  kind: 'import' | 'export' | 'reading' | null
  /** 0..1；kind 为 reading 时无意义 */
  value: number
  /** 可选的附加说明，例如「1234 / 2030 项」 */
  detail: string
}

export const useProgress = create<ProgressState>(() => ({
  kind: null,
  value: 0,
  detail: '',
}))

export const startProgress = (kind: 'import' | 'export' | 'reading') => {
  useProgress.setState({ kind, value: 0, detail: '' })
}

export const updateProgress = (value: number, detail = '') => {
  useProgress.setState({ value: Math.min(1, Math.max(0, value)), detail })
}

export const finishProgress = () => {
  useProgress.setState({ kind: null, value: 0, detail: '' })
}
