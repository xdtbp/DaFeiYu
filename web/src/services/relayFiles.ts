import { normalizeUrl, relayFetch, relayFor, useRelay } from './relay.js'
import { log } from './log.js'

/**
 * 中继文件归档（v2.2 的 `files` 能力）。
 *
 * 附件原件本来只存在本机 IndexedDB，换设备 / 清缓存后历史图片就没了。
 * 这里在上传成功后顺手把原件存一份到中继，之后任何设备都能凭票据取回。
 * 全部失败降级：拿不到就继续用本地副本，不影响发送。
 */

/** 归档用哪台中继：跟着对话走，其次解析接口，最后退回配置的第一台 */
const fileRelay = () =>
  relayFor('chat') ?? relayFor('parse') ?? useRelay.getState().servers[0] ?? null

/** 把原件存到中继，返回服务端文件 id；不可用或失败返回 null */
export const archiveOriginal = async (blob: Blob, name: string): Promise<string | null> => {
  const relay = fileRelay()
  if (!relay) {
    return null
  }
  try {
    const response = await relayFetch(relay, '/api/v1/files/originals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(name),
        'x-file-mime': blob.type || 'application/octet-stream',
      },
      body: blob,
    })
    if (!response.ok) {
      log.warn('relay', '归档原件失败', { status: response.status, name })
      return null
    }
    const data = (await response.json()) as { file?: { id?: string } }
    return data.file?.id ?? null
  } catch (error) {
    log.warn('relay', '归档原件异常', { name, error: String(error) })
    return null
  }
}

/**
 * 用归档 id 换一个短期票据地址。
 * 票据默认 30 分钟，失效后重新签一次即可，别缓存太久。
 */
export const resolveStorageUrl = async (
  storageId: string,
  type: 'inline' | 'download' = 'inline'
): Promise<string | null> => {
  const relay = fileRelay()
  if (!relay || !storageId) {
    return null
  }
  try {
    const response = await relayFetch(
      relay,
      `/api/v1/files/originals/${encodeURIComponent(storageId)}/url?type=${type}`
    )
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as { url?: string }
    return data.url ? `${normalizeUrl(relay.url)}${data.url}` : null
  } catch {
    return null
  }
}
