import { translate, type TranslationMessage } from '../../i18n/index.js'
import { log, logError } from '../log.js'
import { relayFor } from '../relay.js'
import { resolveAuth } from './auth.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  BalanceResponse,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** Anthropic 兼容接口的路径；直连时拼在 API_ORIGIN 后面，走中继时拼在中继转发前缀后面 */
const ANTHROPIC_PATH = '/anthropic/v1'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

/** 日志里只写路径，不写可能带参数的完整地址 */
const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/** 请求头转成普通对象，交给日志按字段名脱敏（Authorization / x-api-key 会被打码） */
const headerEntries = (headers: HeadersInit | undefined): Record<string, string> => {
  try {
    return Object.fromEntries(new Headers(headers).entries())
  } catch {
    return {}
  }
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  const method = init.method ?? 'GET'
  const path = pathOf(url)
  const started = Date.now()
  log.debug('api', `→ ${method} ${path}`, { headers: headerEntries(init.headers) })
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      log.info('api', `${method} ${path} 已中止 ${Date.now() - started}ms`)
      throw error
    }
    logError('api', `✗ ${method} ${path} 请求未发出 ${Date.now() - started}ms`, error)
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  log.debug('api', `← ${response.status} ${method} ${path} ${Date.now() - started}ms`, {
    type: response.headers.get('content-type') ?? '',
    requestId: response.headers.get('x-request-id') ?? undefined,
  })
  if (!response.ok) {
    const failure = await readErrorResponse(response)
    log.error('api', `✗ ${method} ${path} 失败 ${response.status} ${Date.now() - started}ms`, {
      message: failure.message,
      kind: failure.kind,
    })
    throw failure
  }
  return response
}

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  const auth = await resolveAuth('chat', apiKey, 'bearer')
  await request(`${auth.base ?? API_ORIGIN}/models`, {
    method: 'GET',
    headers: auth.headers,
    signal,
  })
}

/** 查询账户余额：GET /user/balance */
export const getBalance = async (
  apiKey: string,
  signal?: AbortSignal
): Promise<BalanceResponse> => {
  const auth = await resolveAuth('chat', apiKey, 'bearer')
  const response = await request(`${auth.base ?? API_ORIGIN}/user/balance`, {
    method: 'GET',
    headers: auth.headers,
    signal,
  })
  return (await response.json()) as BalanceResponse
}

/**
 * 只用 API Key 查询余额。
 * 与 getBalance 不同，这里不判断「账号通道」，用于登录账号的同时展示 API Key 所属账户的余额。
 */
export const getBalanceByApiKey = async (
  apiKey: string,
  signal?: AbortSignal
): Promise<BalanceResponse> => {
  const auth = await resolveAuth('chat', apiKey, 'bearer')
  const response = await request(`${auth.base ?? API_ORIGIN}/user/balance`, {
    method: 'GET',
    headers: auth.headers,
    signal,
  })
  return (await response.json()) as BalanceResponse
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const auth = await resolveAuth('parse', apiKey, 'anthropic', true)
  const response = await request(`${auth.base ?? API_ORIGIN}${ANTHROPIC_PATH}/files`, {
    method: 'POST',
    headers: auth.headers,
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  const auth = await resolveAuth('parse', apiKey, 'anthropic', true)
  await request(`${auth.base ?? API_ORIGIN}${ANTHROPIC_PATH}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: auth.headers,
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * 请求结构摘要：排障要看的是「几轮上下文、每轮有哪些块、各多长」，
 * 而不是用户说了什么，所以正文一律只记长度。
 */
const describeMessageRequest = (body: CreateMessageRequest) => ({
  model: body.model,
  thinking: body.thinking,
  maxTokens: body.max_tokens,
  systemChars: typeof body.system === 'string' ? body.system.length : 0,
  turns: body.messages.map((message) => ({
    role: message.role,
    blocks:
      typeof message.content === 'string'
        ? [{ type: 'text', chars: message.content.length }]
        : message.content.map((block) => ({
            type: block.type,
            ...('text' in block && typeof block.text === 'string'
              ? { chars: block.text.length }
              : {}),
            ...('thinking' in block && typeof block.thinking === 'string'
              ? { chars: block.thinking.length }
              : {}),
          })),
  })),
  tools: body.tools?.map((tool) => tool.name) ?? [],
  title: body.title?.enabled === true,
})

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
/** 这些中继拒绝了续推头（CORS 未放行），本次进程内不再尝试 */
const resumeBlocked = new Set<string>()

/** 中继可续推流的状态：跨重连复用同一个对象 */
export type StreamControl = {
  /** 服务端分配的流 id；未启用或直连时为 null */
  streamId: string | null
  /** 最后收到的帧 id，重连时作为 Last-Event-ID */
  cursor: number
  /** relay_end 的内容 */
  end?: { status: 'done' | 'error'; finishReason: string | null; code: string | null }
  /** 服务端回了 relay_meta，说明它支持续推；老版本服务端为 false，不能重连 */
  supported?: boolean
}

export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  /** 传了才启用续推（配合 streamId） */
  control?: StreamControl,
  streamId?: string
): AsyncGenerator<MessageStreamEvent> {
  const started = Date.now()
  log.info('sse', '发起流式请求', describeMessageRequest(body))
  // 模型选了中继时整轮请求都走中继（联网搜索也在同一个 /messages 里）；
  // 只有直连模型时才让「网页搜索」单独分流。
  const searchable = body.tools?.some((tool) => tool.name === 'deepseek_web_search') ?? false
  const kind = relayFor('chat') ? 'chat' : searchable ? 'search' : 'chat'
  const auth = await resolveAuth(kind, apiKey, 'anthropic', hasFile(body))
  const url = `${auth.base ?? API_ORIGIN}${ANTHROPIC_PATH}/messages`
  const resumeHeaders: Record<string, string> =
    auth.base && streamId && !resumeBlocked.has(auth.base)
      ? {
          'x-relay-stream-id': streamId,
          ...(control && control.cursor > 0 ? { 'Last-Event-ID': String(control.cursor) } : {}),
        }
      : {}
  const send = (extra: Record<string, string>) =>
    request(url, {
      method: 'POST',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...extra,
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    })

  let response: Response
  const requestStartedAt = Date.now()
  try {
    response = await send(resumeHeaders)
  } catch (error) {
    // 有的部署没把 x-relay-stream-id 放进 CORS 白名单，预检会直接失败。
    // 这种情况退回普通流式请求（本进程内不再尝试续推），别让对话也跟着挂掉。
    // 只有「很快就失败」才当作预检被拒；真断网（耗时较久）不重发，避免重复请求
    if (Object.keys(resumeHeaders).length === 0 || signal.aborted || Date.now() - requestStartedAt > 800) {
      throw error
    }
    log.warn('sse', '续推头被拒绝，退回普通流式请求', { error: String(error) })
    resumeBlocked.add(auth.base ?? '')
    if (control) {
      control.supported = false
    }
    response = await send({})
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    log.error('sse', '响应不是事件流', { status: response.status, contentType })
    throw await readErrorResponse(response, 'protocol', '')
  }
  /** 每个内容块累积的增量条数，结束时一并记录，避免逐条刷屏 */
  const deltas = new Map<number, number>()
  let events = 0
  let firstEventAt = 0
  try {
    for await (const {
      event: eventName,
      data,
      lastEventId,
    } of readServerSentEvents(response.body, signal)) {
      // 中继控制帧：不进消息解析，只更新续推状态
      if (eventName === 'relay_meta') {
        if (control) {
          try {
            const meta = JSON.parse(data) as { requestId?: string }
            control.streamId = meta.requestId ?? streamId ?? control.streamId
            control.supported = true
          } catch {
            // 坏帧忽略
          }
        }
        continue
      }
      if (eventName === 'relay_end') {
        if (control) {
          try {
            control.end = JSON.parse(data) as StreamControl['end']
          } catch {
            // 坏帧忽略
          }
        }
        continue
      }
      // 带 id 的才是可回放的内容帧
      if (control && lastEventId && /^\d+$/.test(lastEventId)) {
        control.cursor = Number(lastEventId)
      }
      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        if (eventName !== 'error') {
          log.warn('sse', '无法解析的事件帧', { event: eventName, chars: data.length })
          continue
        }
      }
      if (isErrorBody(payload)) {
        log.error('sse', '流中返回错误', { message: payload.error.message, event: eventName })
        throw new ApiError('stream', payload.error.message)
      }
      if (eventName === 'error') {
        log.error('sse', '流中 error 帧', { chars: data.length })
        throw new ApiError('stream', data)
      }
      const event = readMessageEvent(payload)
      if (!event) {
        log.debug('sse', '跳过非消息事件', { event: eventName })
        continue
      }
      events += 1
      firstEventAt ||= Date.now()
      if (event.type === 'content_block_delta') {
        deltas.set(event.index, (deltas.get(event.index) ?? 0) + 1)
      } else {
        log.debug('sse', `事件 ${event.type}`, summarizeEvent(event, firstEventAt - started))
      }
      yield event
      if (event.type === 'message_stop') {
        log.info('sse', '流结束', {
          events,
          firstEventMs: firstEventAt - started,
          totalMs: Date.now() - started,
          deltas: [...deltas.entries()].map(([index, count]) => ({ index, count })),
        })
        return
      }
    }
  } catch (error) {
    logError('sse', '流式请求异常', error, { events, totalMs: Date.now() - started })
    // 流中途断网时 reader.read() 抛的是原生 TypeError，不是 ApiError。
    // 上层靠 instanceof ApiError + kind 判断是否可续推，这里必须包装，
    // 否则「断线续推」在真实断网场景下永远不会触发。
    if (error instanceof ApiError || signal.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  log.error('sse', '流在 message_stop 之前结束', { events, totalMs: Date.now() - started })
  if (control?.end?.status === 'error') {
    throw new ApiError('stream', control.end.code ?? '')
  }
  throw new ApiError('interrupted', '')
}

/** 事件摘要：只保留类型与关键计数，不含正文 */
const summarizeEvent = (event: MessageStreamEvent, firstEventMs: number): Record<string, unknown> => {
  switch (event.type) {
    case 'message_start':
      return { firstEventMs, model: event.message.model, usage: event.message.usage }
    case 'content_block_start':
      return { index: event.index, block: event.content_block.type }
    case 'message_delta':
      return { stopReason: event.delta.stop_reason, usage: event.usage }
    default:
      return { firstEventMs }
  }
}
