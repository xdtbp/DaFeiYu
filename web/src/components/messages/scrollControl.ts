/**
 * 消息列表的跳转控制入口。MessageList 挂载时注册实现，卸载时清空。
 * 顶栏（MobileHeader）与消息列表是兄弟节点，用模块级单例传递，
 * 避免为此把滚动状态提升到会话页。
 */
let jumpToMessageImpl: ((messageId: string) => void) | null = null

export const registerJumpToMessage = (impl: ((messageId: string) => void) | null) => {
  jumpToMessageImpl = impl
}

/** 平滑滚到指定消息并居中；列表未挂载时什么也不做 */
export const scrollToMessage = (messageId: string) => {
  jumpToMessageImpl?.(messageId)
}
