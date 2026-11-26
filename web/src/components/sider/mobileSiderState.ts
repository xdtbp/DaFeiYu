import { create } from 'zustand'

/** 抽屉宽度，与 `.mobile` 侧边栏宽度保持一致 */
export const SIDER_WIDTH = 300

/** 松手判定阈值：拉出超过 25% 即展开，否则回弹收起 */
export const SETTLE_RATIO = 0.25

type MobileSiderState = {
  open: boolean
  /** 跟手拖动中的位移（px，0 为完全收起）；null 表示没有在拖动 */
  drag: number | null
  /** 手指是否正在拖动：只有这时才关掉过渡，回弹与开合要走动画 */
  dragging: boolean
  /** 正在播收起动画：这段时间主界面仍需保留 transform */
  closing: boolean
}

/**
 * 移动端侧边栏抽屉：顶栏菜单打开，点遮罩 / 切换会话 / 右滑跟手开合。
 *
 * 拖动过程中**不写 React 状态**：每帧只改 `--sider-offset` 这个 CSS 变量，
 * 主界面和抽屉都用它算 transform。否则一次拖动会重渲染整个聊天列表，
 * 上下文一长就卡成幻灯片。
 */
export const useMobileSider = create<MobileSiderState>(() => ({
  open: false,
  drag: null,
  dragging: false,
  closing: false,
}))

/** 收起动画时长，与 CSS transition 保持一致 */
const CLOSE_MS = 260

/** 拖动过程中缓存的最新位移，松手时按它判断开合 */
let liveOffset = 0

const writeOffset = (value: number) => {
  liveOffset = value
  document.documentElement.style.setProperty('--sider-offset', `${value}px`)
}

const setDraggingAttr = (dragging: boolean) => {
  const root = document.documentElement
  if (dragging) {
    root.setAttribute('data-sider-dragging', '')
  } else {
    root.removeAttribute('data-sider-dragging')
  }
}

export const currentSiderOffset = () => liveOffset

export const openMobileSider = () => {
  useMobileSider.setState({ open: true, drag: null, dragging: false, closing: false })
  setDraggingAttr(false)
  writeOffset(SIDER_WIDTH)
}

/** 收起抽屉：去掉拖动标记后把位移归零，交给 CSS 过渡播动画 */
export const closeMobileSider = () => {
  const { open, drag, dragging } = useMobileSider.getState()
  if (!open && drag === null && !dragging) {
    return
  }
  useMobileSider.setState({ open: false, drag: null, dragging: false, closing: true })
  setDraggingAttr(false)
  writeOffset(0)
  // 动画结束后撤掉 transform，避免长期挂着一个合成层（会让文字发虚）
  window.setTimeout(() => {
    if (!useMobileSider.getState().open) {
      useMobileSider.setState({ closing: false })
    }
  }, CLOSE_MS)
}

/** 手指开始横向拖动：只切一次状态，避免每帧渲染 */
export const beginSiderDrag = () => {
  useMobileSider.setState({ dragging: true, closing: false })
  setDraggingAttr(true)
}

/** 拖动中：直接写 CSS 变量，不触发 React 渲染 */
export const applySiderDrag = (value: number) => {
  writeOffset(Math.min(SIDER_WIDTH, Math.max(0, value)))
}

/** 拖动结束：恢复过渡，按阈值收口 */
export const endSiderDrag = (nextOpen: boolean) => {
  setDraggingAttr(false)
  useMobileSider.setState({ drag: null, dragging: false })
  if (nextOpen) {
    openMobileSider()
  } else {
    closeMobileSider()
  }
}

/**
 * 抽屉已拉出的宽度（0 ~ 300）。主界面与侧边栏都用同一个 CSS 变量，
 * 位移永远一致，不会出现一快一慢或中间露白。
 */
export const siderOffset = (open: boolean, drag: number | null): number => {
  if (drag !== null) {
    return Math.min(SIDER_WIDTH, Math.max(0, drag))
  }
  return open ? SIDER_WIDTH : 0
}
