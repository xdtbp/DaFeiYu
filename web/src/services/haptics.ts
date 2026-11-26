/**
 * 轻触觉反馈：优先走原生（WebView 里 navigator.vibrate 经常不生效），
 * 网页环境下退回振动 API。
 */
type HapticBridge = { haptic?: () => boolean }

export const haptic = (ms = 12) => {
  try {
    const bridge = (window as unknown as { AndroidApp?: HapticBridge }).AndroidApp
    if (typeof bridge?.haptic === 'function') {
      bridge.haptic()
      return
    }
  } catch {
    // 桥接异常时继续尝试网页方案
  }
  try {
    navigator.vibrate?.(ms)
  } catch {
    // 没有振动能力就静默
  }
}
