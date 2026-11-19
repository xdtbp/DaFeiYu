/**
 * 录音并编码为 ASR 接受的 WAV（单声道、16-bit PCM、16kHz）。
 *
 * 优先用 16kHz 的 AudioContext 让浏览器重采样；个别机型不支持指定采样率时，
 * 退回默认采样率，停止时再用线性插值重采样到 16kHz。
 */
export const SAMPLE_RATE = 16000
/** ASR 单次时长上限 120 秒 */
export const MAX_SECONDS = 120

const BUFFER_SIZE = 4096

export type Recording = {
  /** 停止录音并返回 WAV；没有采到声音时返回 null */
  stop: () => Promise<Blob | null>
  /** 放弃录音，释放麦克风 */
  cancel: () => void
  /** 频谱分析节点；原生录音没有频谱，为 null */
  analyser: AnalyserNode | null
}

/** 打开麦克风：先按降噪/单声道约束申请，失败再退回最宽松的 audio:true */
const openMicrophone = async (): Promise<MediaStream> => {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
  } catch (error) {
    // OverconstrainedError / NotReadableError 常见于部分机型不支持这些约束
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw error
    }
    return navigator.mediaDevices.getUserMedia({ audio: true })
  }
}

/** 开始录音；到达时长上限时调用 onLimit，由调用方决定何时 stop */
export const startRecording = async (onLimit: () => void): Promise<Recording> => {
  const stream = await openMicrophone()
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let analyser: AnalyserNode | undefined
  let released = false

  const release = () => {
    if (released) {
      return
    }
    released = true
    if (processor) {
      processor.onaudioprocess = null
    }
    // 初始化可能只完成了一部分；单个节点断开失败也不能阻止麦克风释放。
    for (const node of [processor, analyser, source]) {
      try {
        node?.disconnect()
      } catch {
        // 继续释放其余资源。
      }
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    void context?.close().catch(() => {})
  }

  try {
    // 指定 16kHz 失败时退回默认采样率，编码阶段再重采样
    try {
      context = new AudioContext({ sampleRate: SAMPLE_RATE })
    } catch {
      context = new AudioContext()
    }
    const rate = context.sampleRate
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
    // 频谱分析用：串在录音链路中间（原样透传），WebKit 不会处理未连到输出的分析节点
    analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.2
    const chunks: Float32Array[] = []
    let length = 0
    let limited = false
    processor.onaudioprocess = (event) => {
      if (limited) {
        return
      }
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      length += BUFFER_SIZE
      if (length >= MAX_SECONDS * rate) {
        limited = true
        onLimit()
      }
    }
    source.connect(analyser)
    analyser.connect(processor)
    // ScriptProcessorNode 只有连到输出才会持续回调；输出缓冲保持静音
    processor.connect(context.destination)
    // 在 await getUserMedia 之后创建，iOS 上可能处于 suspended
    if (context.state === 'suspended') {
      void context.resume().catch(() => {})
    }

    return {
      stop: async () => {
        release()
        if (length === 0) {
          return null
        }
        const samples = mergeChunks(chunks, length)
        return encodeWav(rate === SAMPLE_RATE ? samples : resample(samples, rate, SAMPLE_RATE))
      },
      cancel: release,
      analyser,
    }
  } catch (error) {
    release()
    throw error
  }
}

/** 把分块 PCM 拼成一整段 */
const mergeChunks = (chunks: Float32Array[], length: number) => {
  const out = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** 线性插值重采样（仅在不支持 16kHz AudioContext 时使用） */
const resample = (input: Float32Array, from: number, to: number) => {
  if (from === to) {
    return input
  }
  const ratio = from / to
  const length = Math.floor(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const fraction = position - index
    const next = index + 1 < input.length ? input[index + 1] : input[index]
    out[i] = input[index] * (1 - fraction) + next * fraction
  }
  return out
}

const encodeWav = (samples: Float32Array) => {
  const limited = samples.subarray(0, Math.min(samples.length, MAX_SECONDS * SAMPLE_RATE))
  const count = limited.length
  const buffer = new ArrayBuffer(44 + count * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + count * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, count * 2, true)
  let offset = 44
  for (let i = 0; i < count; i++) {
    const sample = Math.max(-1, Math.min(1, limited[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
