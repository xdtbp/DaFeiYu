import { create } from 'zustand'

/** 抽屉宽度，与 `.mobile` 侧边栏宽度保持一致 */
export const SIDER_WIDTH = 300

/** 松手判定阈值：拉出超过 25% 即展开，否则回弹收起 */
export const SETTLE_RATIO = 0.25

/** 收起动画时长，与 CSS transition 保持一致 */
const ANIM_MS = 260

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
 * 拖动过程中**不碰 React 状态、也不写 CSS 变量**：
 * 前者会重渲染整个聊天列表，后者挂在 <html> 上会让整棵树重算样式。
 * 这里只给「抽屉」和「主界面」两个元素写 inline transform，
 * 一次触摸只动两个 style 属性，合成器直接接管。
 */
export const useMobileSider = create<MobileSiderState>(() => ({
  open: false,
  drag: null,
  dragging: false,
  closing: false,
}))

let drawerEl: HTMLElement | null = null
let mainEl: HTMLElement | null = null
/** 拖动过程中缓存的最新位移，松手时按它判断开合 */
let liveOffset = 0
/** 收起动画结束后清理 inline 样式，别让主界面长期挂着合成层（会让文字发虚） */
let settleTimer: number | null = null

export const bindSiderElements = (parts: { drawer?: HTMLElement | null; main?: HTMLElement | null }) => {
  if ('drawer' in parts) {
    drawerEl = parts.drawer ?? null
  }
  if ('main' in parts) {
    mainEl = parts.main ?? null
  }
}

/** 直接写两个元素的位移；animate=false 时关掉过渡，保证跟手 */
const paint = (value: number, animate: boolean) => {
  liveOffset = value
  if (settleTimer !== null) {
    window.clearTimeout(settleTimer)
    settleTimer = null
  }
  const transition = animate ? '' : 'none'
  // 整个交互期间都提示合成器：避免动画中途才提升图层导致掉帧
  const willChange = 'transform'
  if (drawerEl) {
    drawerEl.style.transition = transition
    drawerEl.style.willChange = willChange
    drawerEl.style.transform = `translateX(${value - SIDER_WIDTH}px)`
  }
  if (mainEl) {
    mainEl.style.transition = transition
    mainEl.style.willChange = willChange
    // 主界面跟着位移；收起结束后由上面的定时器把 inline 样式摘掉
    mainEl.style.transform = `translateX(${value}px)`
  }
  // 只有「收起」需要收尾清理：留着 transform 会让主界面长期挂在合成层上、文字发虚；
  // 打开状态下 drawer 的 inline transform 就是它的最终位置，不需要清。
  if (value === 0) {
    settleTimer = window.setTimeout(() => {
      if (liveOffset !== 0) {
        return
      }
      if (drawerEl) {
        drawerEl.style.transition = ''
        drawerEl.style.willChange = ''
        drawerEl.style.transform = ''
      }
      if (mainEl) {
        mainEl.style.transition = ''
        mainEl.style.willChange = ''
        mainEl.style.transform = ''
      }
      settleTimer = null
    }, ANIM_MS)
  }
}

export const currentSiderOffset = () => liveOffset

export const openMobileSider = () => {
  useMobileSider.setState({ open: true, drag: null, dragging: false, closing: false })
  paint(SIDER_WIDTH, true)
}

/** 收起抽屉：位移归零，交给 CSS 过渡播动画 */
export const closeMobileSider = () => {
  const { open, drag, dragging } = useMobileSider.getState()
  // 已经收起且位移就是 0 才跳过；否则必须写回 0，
  // 不然「拖一半没到阈值松手」会把抽屉留在半路
  if (!open && drag === null && !dragging && liveOffset === 0) {
    return
  }
  useMobileSider.setState({ open: false, drag: null, dragging: false, closing: true })
  paint(0, true)
  window.setTimeout(() => {
    if (!useMobileSider.getState().open) {
      useMobileSider.setState({ closing: false })
    }
  }, ANIM_MS)
}

/** 手指开始横向拖动：只切一次状态，避免每帧渲染 */
export const beginSiderDrag = () => {
  useMobileSider.setState({ dragging: true, closing: false })
}

/** 拖动中：只写两个元素的 transform */
export const applySiderDrag = (value: number) => {
  paint(Math.min(SIDER_WIDTH, Math.max(0, value)), false)
}

/** 拖动结束：恢复过渡，按阈值收口 */
export const endSiderDrag = (nextOpen: boolean) => {
  useMobileSider.setState({ drag: null, dragging: false })
  if (nextOpen) {
    openMobileSider()
  } else {
    closeMobileSider()
  }
}

/**
 * 抽屉已拉出的宽度（0 ~ 300）。
 */
export const siderOffset = (open: boolean, drag: number | null): number => {
  if (drag !== null) {
    return Math.min(SIDER_WIDTH, Math.max(0, drag))
  }
  return open ? SIDER_WIDTH : 0
}
