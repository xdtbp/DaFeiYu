type NativeAppBridge = {
  webviewDebugEnabled?: () => boolean
  setWebviewDebug?: (enabled: boolean) => boolean
}

const bridge = (): NativeAppBridge | undefined =>
  (window as unknown as { AndroidApp?: NativeAppBridge }).AndroidApp

/** 只有原生壳支持切换 WebView 调试（网页版没有对应能力） */
export const webviewDebugSupported = (): boolean =>
  typeof bridge()?.webviewDebugEnabled === 'function'

/** 当前开关状态；读取失败按关闭处理 */
export const webviewDebugEnabled = (): boolean => {
  try {
    return bridge()?.webviewDebugEnabled?.() === true
  } catch {
    return false
  }
}

/** 切换开关：原生写入偏好并立即生效，返回切换后的目标状态 */
export const setWebviewDebug = (enabled: boolean): boolean => {
  try {
    bridge()?.setWebviewDebug?.(enabled)
  } catch {
    /* 桥接异常时只更新界面，下次启动仍按偏好处理 */
  }
  return enabled
}
