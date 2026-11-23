/** 引导页可逐项申请的运行时权限 */
export type AppPermission = 'mic' | 'camera' | 'media'

type NativeAppBridge = {
  requestPermission?: (name: string) => void
  permissionState?: (name: string) => string
}

const bridge = (): NativeAppBridge | undefined =>
  (window as unknown as { AndroidApp?: NativeAppBridge }).AndroidApp

/** 是否已获得某项权限；非原生环境视为无需申请 */
export const appPermissionGranted = (name: AppPermission): boolean => {
  const native = bridge()
  if (!native?.permissionState) {
    return true
  }
  try {
    return native.permissionState(name) === 'granted'
  } catch {
    return false
  }
}

/** 申请单项权限，等待原生回调结果 */
export const requestAppPermission = (name: AppPermission): Promise<boolean> =>
  new Promise((resolve) => {
    const native = bridge()
    if (!native?.requestPermission) {
      resolve(true)
      return
    }
    const holder = window as unknown as {
      __dsPermission?: (target: string, granted: boolean) => void
    }
    // 用户把系统弹窗挂起时别一直等
    const timer = setTimeout(() => {
      holder.__dsPermission = undefined
      resolve(appPermissionGranted(name))
    }, 60_000)
    holder.__dsPermission = (target, granted) => {
      if (target !== name) {
        return
      }
      clearTimeout(timer)
      holder.__dsPermission = undefined
      resolve(granted)
    }
    native.requestPermission(name)
  })
