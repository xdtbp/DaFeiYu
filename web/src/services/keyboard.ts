type NativeAppBridge = {
  setKeyboardResize?: (enabled: boolean) => void
}

const bridge = (): NativeAppBridge | undefined =>
  (window as unknown as { AndroidApp?: NativeAppBridge }).AndroidApp

/**
 * 切换输入法对窗口的影响。侧边栏搜索聚焦时设为 false（键盘覆盖、不挤压窗口），
 * 失焦或抽屉关闭时恢复 true。网页版没有对应能力，静默忽略。
 */
export const setKeyboardResize = (enabled: boolean) => {
  try {
    bridge()?.setKeyboardResize?.(enabled)
  } catch {
    // 桥接异常不影响正常输入
  }
}
