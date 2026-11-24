import { create } from 'zustand'

/**
 * 侧边栏会话列表的「主动跳转」控制。
 *
 * 抽屉只做位移、从不卸载，滚动位置由浏览器自己记着，所以这里不保存任何位置，
 * 只处理两件需要主动滚动的事：新建对话回到顶部、点搜索结果定位到该会话。
 */

/** 列表每次渲染的条数（滚到底部附近继续追加） */
export const SIDER_PAGE_SIZE = 40

type SiderListControl = {
  /** 请求把某个会话滚到视野中间；seq 变化即视为一次新请求 */
  reveal: { id: string; seq: number } | null
}

export const useSiderListControl = create<SiderListControl>(() => ({ reveal: null }))

export const revealSiderSession = (sessionId: string) =>
  useSiderListControl.setState((state) => ({
    reveal: { id: sessionId, seq: (state.reveal?.seq ?? 0) + 1 },
  }))

export const clearSiderReveal = () => useSiderListControl.setState({ reveal: null })

/** 当前挂载的列表节点（同一时间只有一个侧边栏在渲染） */
let listElement: HTMLDivElement | null = null

export const registerSiderList = (element: HTMLDivElement | null) => {
  listElement = element
}

/** 新建对话：列表回到顶部，新会话就在眼前 */
export const scrollSiderToTop = () => {
  if (listElement) {
    listElement.scrollTop = 0
  }
}
