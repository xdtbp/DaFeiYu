import type { Recording } from './recorder.js'

/**
 * 原生录音通道：安卓壳用 AudioRecord 采 16kHz 单声道 PCM，停止时生成 WAV，
 * 前端用 /local/voice.wav 取回。相比 WebView 的 getUserMedia，
 * 不受 WebRTC 采集限制，权限也可控，因此优先使用。
 */

type NativeVoiceBridge = {
  hasPermission?: () => boolean
  requestPermission?: () => void
  start?: () => string
  stop?: () => string
  cancel?: () => void
}

const bridge = () => (window as unknown as { AndroidVoice?: NativeVoiceBridge }).AndroidVoice

/** 是否具备原生录音能力 */
export const hasNativeVoice = () => typeof bridge()?.start === 'function'

type StartResult = { ok?: boolean; reason?: string }
type StopResult = { ok?: boolean; reason?: string; url?: string }

/** 把原生错误码映射成 DOMException，复用现有的提示文案 */
const toError = (reason: string | undefined) => {
  switch (reason) {
    case 'permission':
      try {
        bridge()?.requestPermission?.()
      } catch {
        /* 忽略 */
      }
      return new DOMException('microphone permission required', 'NotAllowedError')
    case 'no_device':
      return new DOMException('no audio input device', 'NotFoundError')
    case 'busy':
      return new DOMException('recorder busy', 'NotReadableError')
    default:
      return new DOMException('recorder failed', 'NotReadableError')
  }
}

/** 用原生录音器录制；返回与网页录音一致的接口 */
export const startNativeRecording = async (onLimit: () => void): Promise<Recording> => {
  const native = bridge()
  if (!native?.start) {
    throw new DOMException('native recorder missing', 'NotSupportedError')
  }
  let started: StartResult = {}
  try {
    started = JSON.parse(native.start() || '{}') as StartResult
  } catch {
    started = {}
  }
  if (!started.ok) {
    throw toError(started.reason)
  }
  ;(window as unknown as { __dsVoiceLimit?: () => void }).__dsVoiceLimit = onLimit
  return {
    stop: async () => {
      let result: StopResult = {}
      try {
        result = JSON.parse(native.stop?.() || '{}') as StopResult
      } catch {
        result = {}
      }
      if (!result.ok || !result.url) {
        return null
      }
      const response = await fetch(result.url, { cache: 'no-store' })
      if (!response.ok) {
        return null
      }
      return response.blob()
    },
    cancel: () => {
      try {
        native.cancel?.()
      } catch {
        /* 忽略 */
      }
    },
    // 原生录音不提供频谱节点
    analyser: null,
  }
}

/** 原生侧是否已授予录音权限 */
export const nativeVoicePermission = () => {
  try {
    return bridge()?.hasPermission?.() === true
  } catch {
    return false
  }
}
