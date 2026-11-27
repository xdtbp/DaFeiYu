import * as db from '../db.js'
import { BackupError, fail } from './errors.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath, sessionFilesDir } from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
  type ArchiveEntry,
} from './zipReader.js'

/** 单张图片上限：超过就跳过，避免一次导入把存储配额用尽（会话正文不受影响） */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await (await readEntry(entry)).text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

export type ImportStats = { imported: number; skipped: number }

/**
 * 检查 ZIP 格式、首个 manifest 条目及格式版本。
 * 校验失败时保留正在生成的回答和现有暂存数据。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path !== MANIFEST_PATH) {
        fail('backupUnrecognized')
      }
      checkManifest(await readJson(entry))
      return
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  fail('backupUnrecognized')
}

/**
 * 流式导入：manifest → user（不导入）→ 全部会话 JSON → index → 全部图片。
 *
 * 官方 App 的导出格式会随版本演进出现新的字段取值，单个会话/图片不兼容时
 * 只跳过该条目并继续导入其余内容——绝不因为一条记录让整包历史丢掉。
 */
export const importArchive = async (
  file: File,
  onProgress?: (fraction: number, detail: string) => void
): Promise<ImportStats> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  const imported = new Set<string>()
  const images = new Map<string, string>()
  /** 已保存的原件：文件 ID → MIME。同一图片出现在多个会话目录时只保存一次。 */
  const stored = new Map<string, string>()
  let manifest = false
  let index: SessionIndexEntry[] | undefined
  let currentSessionId: string | undefined
  let skipped = 0
  let total = 0
  let processed = 0
  let lastReport = 0
  const report = () => {
    processed += 1
    const now = Date.now()
    if (!onProgress || (now - lastReport < 120 && processed !== total)) {
      return
    }
    lastReport = now
    onProgress(processed / Math.max(1, total), `${processed} / ${Math.max(total, processed)}`)
  }

  const saveImage = async (entry: ArchiveEntry, id: string) => {
    if (stored.has(id)) {
      await skipEntry(entry)
      return
    }
    if (entry.size > MAX_IMAGE_BYTES) {
      await skipEntry(entry)
      skipped += 1
      return
    }
    const data = await readEntry(entry)
    const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    try {
      await db.saveStagingFiles([{ id, blob: new Blob([data], { type }) }])
      stored.set(id, type)
    } catch {
      // 存储配额不足时放弃这张图片，会话正文仍然保留
      skipped += 1
    }
  }

  try {
    for await (const entry of readArchive(file, (count) => {
      total = count
    })) {
      const { path } = entry
      const sessionId = parseSessionPath(path)
      if (!manifest) {
        if (path !== MANIFEST_PATH) {
          fail('backupUnrecognized')
        }
        checkManifest(await readJson(entry))
        manifest = true
      } else if (path === USER_PATH && !index && imported.size === 0) {
        // 账号信息（已脱敏）不导入；文件可能缺失。
        await skipEntry(entry)
      } else if (sessionId !== null && !index) {
        try {
          const local = toLocalSession(readSessionFile(await readJson(entry)))
          if (local.session.id !== sessionId || imported.has(sessionId)) {
            throw new BackupError('backupIncomplete')
          }
          imported.add(sessionId)
          currentSessionId = sessionId
          for (const [imagePath, id] of local.images) {
            images.set(imagePath, id)
          }
          await db.addStagingSession(local.session)
        } catch {
          // 该会话字段不兼容（新版导出新增取值、异常状态等）：跳过它，继续导入后面的会话
          skipped += 1
          currentSessionId = sessionId
        }
      } else if (path === INDEX_PATH && !index) {
        try {
          index = readSessionIndex(await readJson(entry))
        } catch {
          index = []
        }
      } else if (
        index
          ? imported.has(/^chat_sessions\/([^/]+)_files\//.exec(path)?.[1] ?? '')
          : currentSessionId !== undefined && path.startsWith(sessionFilesDir(currentSessionId))
      ) {
        // 没有被引用的条目不保存，引用了但缺失的图片只展示文件名。
        const id = images.get(path)
        await (id === undefined ? skipEntry(entry) : saveImage(entry, id))
      } else {
        // 未知条目：跳过而不是让整包失败
        await skipEntry(entry)
        skipped += 1
      }
      report()
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!manifest) {
    fail('backupUnrecognized')
  }
  if (imported.size === 0) {
    fail('backupIncomplete')
  }
  await db.updateStagingFileTypes(stored)
  return { imported: imported.size, skipped }
}
