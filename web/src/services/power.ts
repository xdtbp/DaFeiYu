/**
 * 生成期间的唤醒锁：安卓壳在回答流式输出时持有 PARTIAL_WAKE_LOCK，
 * 退到后台也不会因为 CPU 休眠把连接掐断。
 */

type PowerBridge = { begin?: () => void; end?: () => void }

const bridge = () => (window as unknown as { AndroidPower?: PowerBridge }).AndroidPower

export const beginStreamKeepAlive = () => {
  try {
    bridge()?.begin?.()
  } catch {
    /* 浏览器里没有原生桥，忽略 */
  }
}

export const endStreamKeepAlive = () => {
  try {
    bridge()?.end?.()
  } catch {
    /* 同上 */
  }
}
