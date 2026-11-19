/**
 * 返回栈：浮层（图片预览、圈画编辑器、附件面板等）挂载时压入一个关闭动作，
 * 原生返回键 / 侧滑返回时按后进先出逐层关闭，全部关闭后才退出应用。
 *
 * 与弹窗状态分开管理的好处是：新增浮层只需 push 一次，不用改 App 的返回分支。
 */

type BackHandler = () => void

const stack: { id: symbol; run: BackHandler }[] = []

/** 压入一个返回处理，返回注销函数（在 effect 清理里调用） */
export const pushBackHandler = (run: BackHandler) => {
  const entry = { id: Symbol('back'), run }
  stack.push(entry)
  return () => {
    const index = stack.findIndex((item) => item.id === entry.id)
    if (index >= 0) {
      stack.splice(index, 1)
    }
  }
}

/** 执行栈顶的返回处理；没有任何浮层时返回 false，交给原生退出 */
export const runBackHandler = (): boolean => {
  const top = stack.at(-1)
  if (!top) {
    return false
  }
  try {
    top.run()
  } finally {
    // 关闭动作可能触发卸载并自行注销；这里兜底移除，避免重复消费
    const index = stack.findIndex((item) => item.id === top.id)
    if (index >= 0) {
      stack.splice(index, 1)
    }
  }
  return true
}
