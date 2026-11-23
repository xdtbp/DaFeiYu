import { useEffect, useRef, useState } from 'react'
import type { TranslationKey, TranslationMessage } from '../../i18n/index.js'
import {
  hasNativeArchivePicker,
  pickArchiveNative,
  registerArchiveHandlers,
} from '../../services/chat/archivePicker.js'
import { BackupError, importHistory } from '../../services/chat/backup.js'
import { finishProgress, startProgress } from '../../services/chat/progress.js'

export type ImportStatus =
  | (TranslationMessage & { error?: boolean; reason?: TranslationKey })
  | null

/**
 * 导入历史对话：原生文件选择 → 确认 → 覆盖本地数据。
 * 设置页与首次引导共用，进度通过 progress store 驱动。
 */
export const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [status, setStatus] = useState<ImportStatus>(null)
  const importing = useRef(false)

  // 原生选择器把选中的 ZIP 复制好之后会回调到这里
  useEffect(() => {
    if (!hasNativeArchivePicker()) {
      return
    }
    registerArchiveHandlers({
      onReady: (picked) => {
        setReading(false)
        setStatus(null)
        setFile(picked)
        finishProgress()
      },
      onError: () => {
        setReading(false)
        setStatus({ key: 'historyImportFailed', error: true })
        finishProgress()
      },
      onBusy: (isBusy) => {
        setReading(isBusy)
        if (isBusy) {
          startProgress('reading')
        } else {
          finishProgress()
        }
      },
    })
    return () => registerArchiveHandlers(null)
  }, [])

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const result = await importHistory(file)
      setStatus(
        result.skipped > 0
          ? {
              key: 'importPartial',
              params: { count: result.count, skipped: result.skipped },
            }
          : {
              key: result.count === 1 ? 'historyImportedOne' : 'historyImported',
              params: { count: result.count },
            }
      )
    } catch (error) {
      // BackupError 带着具体原因（版本过新/内容不完整…），直接展示给用户
      setStatus({
        key: error instanceof BackupError ? error.key : 'historyImportFailed',
        error: true,
      })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  const pick = (fallback: () => void) => {
    if (!hasNativeArchivePicker()) {
      fallback()
      return
    }
    setStatus({ key: 'importReading' })
    setReading(true)
    startProgress('reading')
    void pickArchiveNative()
  }

  return {
    file,
    busy,
    reading,
    status,
    select: setFile,
    cancel: () => setFile(null),
    confirm,
    pick,
  }
}
