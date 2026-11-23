import { create } from 'zustand'

/** 抽屉宽度，与 `.mobile` 侧边栏宽度保持一致 */
export const SIDER_WIDTH = 300

/** 松手判定阈值：拉出超过 40% 即展开，否则回弹收起 */
export const SETTLE_RATIO = 0.4

/** 收起动画时长，与 CSS 的 transition 保持一致 */
const CLOSE_MS = 240

type MobileSiderState = {
  open: boolean
  /** 跟手拖动中的位移（px，0 为完全收起）；null 表示没有在拖动 */
  drag: number | null
  /** 手指是否正在拖动：只有这时才关掉过渡，回弹与开合要走动画 */
  dragging: boolean
}

/** 移动端侧边栏抽屉：顶栏菜单打开，点遮罩 / 切换会话 / 右滑跟手开合 */
export const useMobileSider = create<MobileSiderState>(() => ({ open: false, drag: null, dragging: false }))

export const openMobileSider = () =>
  useMobileSider.setState({ open: true, drag: null, dragging: false })

/**
 * 收起抽屉：保留当前位移，下一帧归零，动画结束后卸载。
 * 已经收起时直接忽略，避免挂载时误播一次动画。
 */
export const closeMobileSider = () => {
  const { open, drag } = useMobileSider.getState()
  if (!open && drag === null) {
    return
  }
  const from = drag ?? SIDER_WIDTH
  useMobileSider.setState({ open: false, drag: from, dragging: false })
  requestAnimationFrame(() => {
    useMobileSider.setState({ drag: 0 })
    setTimeout(() => {
      if (!useMobileSider.getState().open) {
        useMobileSider.setState({ drag: null })
      }
    }, CLOSE_MS)
  })
}

/** 拖动过程中实时更新位移，用于侧边栏与主界面同步跟手 */
export const setSiderDrag = (drag: number | null) =>
  useMobileSider.setState({ drag, dragging: drag !== null })

/** 拖动结束：按 50% 阈值决定展开或收起 */
export const settleSider = (nextOpen: boolean) => {
  if (nextOpen) {
    openMobileSider()
    return
  }
  closeMobileSider()
}

/**
 * 抽屉已拉出的宽度（0 ~ 300）。主界面与侧边栏都用它算 transform，
 * 两者位移永远一致，不会出现一快一慢或中间露白。
 *
 * 拖动中一律以 drag 为准：展开状态下往回拖也要跟手（只看 open 会让位移卡在 300）。
 */
export const siderOffset = (open: boolean, drag: number | null): number => {
  if (drag !== null) {
    return Math.min(SIDER_WIDTH, Math.max(0, drag))
  }
  return open ? SIDER_WIDTH : 0
}
