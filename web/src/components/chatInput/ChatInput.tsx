import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconGlobeLanguageOutline14,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import {
  IconCameraOutline20,
  IconCheckOutline20,
  IconCloseOutline20,
  IconFileOutline20,
  IconGalleryOutline20,
  IconPlusOutline20,
} from '../base/icons-extra.js'
import { ImageEditor } from './ImageEditor.js'
import { pushBackHandler } from '../../services/backStack.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
  type DraftAttachment,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [editingFile, setEditingFile] = useState<File | null>(null)
  /** 正在被替换的草稿附件（从预览里点「编辑」时记下 id） */
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null)
  /** 缩略图大图预览 */
  const [previewItem, setPreviewItem] = useState<DraftAttachment | null>(null)

  // 返回键：先关闭附件预览，再关闭「+」面板
  useEffect(() => {
    if (!previewItem) {
      return
    }
    return pushBackHandler(() => setPreviewItem(null))
  }, [previewItem])

  useEffect(() => {
    if (!showPanel) {
      return
    }
    return pushBackHandler(() => setShowPanel(false))
  }, [showPanel])
  const [recentPhotos, setRecentPhotos] = useState<Array<{ id: string; thumb: string }>>([])

  type NativeBridge = {
    getRecentPhotos?: (limit: number) => string
    getPhotoData?: (id: string) => string
  }

  // 打开面板时向原生读取相册最近照片
  useEffect(() => {
    if (!showPanel) {
      return
    }
    const bridge = (window as unknown as { AndroidMedia?: NativeBridge }).AndroidMedia
    if (!bridge?.getRecentPhotos) {
      setRecentPhotos([])
      return
    }
    try {
      const list = JSON.parse(bridge.getRecentPhotos(12) || '[]')
      setRecentPhotos(Array.isArray(list) ? list : [])
    } catch {
      setRecentPhotos([])
    }
  }, [showPanel])

  /** 最近照片在草稿里的文件名固定为 photo_<id>.jpg，用来判断是否已选中 */
  const photoName = (id: string) => `photo_${id}.jpg`

  /** 取相册原图并转成 File */
  const readRecentPhoto = (id: string): File | null => {
    const bridge = (window as unknown as { AndroidMedia?: NativeBridge }).AndroidMedia
    const dataUri = bridge?.getPhotoData?.(id) ?? ''
    if (!dataUri) {
      return null
    }
    const comma = dataUri.indexOf(',')
    const mime = /data:([^;]+)/.exec(dataUri.slice(0, comma))?.[1] ?? 'image/jpeg'
    const binary = atob(dataUri.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new File([bytes], photoName(id), { type: mime })
  }

  /**
   * 快捷相册支持多选：点一下即加入草稿并开始上传，再点一下取消并移除。
   * 选中态直接由草稿附件推导，删除缩略图后这里也会同步取消。
   */
  const toggleRecentPhoto = (id: string) => {
    if (useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const current = getDraft(sessionId).attachments
    const picked = current.find((item) => item.file.name === photoName(id))
    if (picked) {
      removeDraftAttachment(sessionId, picked.id)
      return
    }
    const file = readRecentPhoto(id)
    if (!file) {
      // 相册里存在已被删除的残留条目，缩略图还在但原图读不到
      showToast({ key: 'photoReadFailed' })
      return
    }
    const error = addDraftFiles(sessionId, [file], useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }

  const addFiles = (files: File[]) => {
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    // 单张图片先进入圈画标注，标注完成后再作为附件上传。
    // 部分系统相册返回的 File 没有 MIME，退回到扩展名判断。
    const isImage = (file: File) =>
      file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name)
    const imageFile = files.find(isImage)
    if (imageFile && files.length === 1) {
      setEditingFile(imageFile)
      return
    }
    addFiles(files)
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <DraftAttachments
        items={attachments}
        onRetry={retryFile}
        onRemove={removeFile}
        onPreview={setPreviewItem}
      />
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
          placeholder={t('chatInputPlaceholderChat')}
          rows={2}
          enterKeyHint="enter"
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Tooltip content={t('deactivatedThinkTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, thinking && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinking}
              onClick={() => setThinking(!thinking)}
            >
              <IconThinkOutline14 />
              <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
        </div>
        <div className={styles.right}>
          <VoiceButton
            status={voice.status}
            disabled={!voice.available}
            seconds={voice.seconds}
            onStart={() => {
              if (!useChatStore.getState().importingHistory && ensureApiKey()) {
                void voice.start()
              }
            }}
            onFinish={() => {
              void voice.finish()
            }}
            onCancel={() => {
              voice.cancel()
              showToast({ key: 'voiceCancelled' })
            }}
          />
          <IconButton
            size="m"
            tone="primary"
            icon={<IconPlusOutline20 />}
            tooltip={t('uploadFile')}
            disabled={importingHistory}
            onClick={() => setShowPanel((value) => !value)}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            hidden
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            multiple
            hidden
            accept="image/*"
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
      </div>
      {showPanel ? (
        <div className={styles.attachPanel}>
          {recentPhotos.length > 0 ? (
            <div className={styles.recentRow}>
              {recentPhotos.map((photo) => {
                const selected = attachments.some((item) => item.file.name === photoName(photo.id))
                return (
                  <button
                    key={photo.id}
                    type="button"
                    aria-pressed={selected}
                    className={clsx(styles.recentItem, selected && styles.recentItemSelected)}
                    onClick={() => toggleRecentPhoto(photo.id)}
                  >
                    <img src={photo.thumb} alt="" />
                    <span className={styles.recentCheck} aria-hidden>
                      <IconCheckOutline20 />
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
          <div className={styles.attachRow}>
            <button
              type="button"
              className={styles.attachAction}
              onClick={() => {
                setShowPanel(false)
                cameraInputRef.current?.click()
              }}
            >
              <span className={styles.attachIcon}>
                <IconCameraOutline20 />
              </span>
              <span className={styles.attachLabel}>{t('attachCamera')}</span>
            </button>
            <button
              type="button"
              className={styles.attachAction}
              onClick={() => {
                setShowPanel(false)
                galleryInputRef.current?.click()
              }}
            >
              <span className={styles.attachIcon}>
                <IconGalleryOutline20 />
              </span>
              <span className={styles.attachLabel}>{t('attachGallery')}</span>
            </button>
            <button
              type="button"
              className={styles.attachAction}
              onClick={() => {
                setShowPanel(false)
                fileInputRef.current?.click()
              }}
            >
              <span className={styles.attachIcon}>
                <IconFileOutline20 />
              </span>
              <span className={styles.attachLabel}>{t('attachFile')}</span>
            </button>
          </div>
        </div>
      ) : null}
      {previewItem?.previewUrl
        ? createPortal(
            <div
              className={styles.previewMask}
              role="dialog"
              aria-modal="true"
              data-ds-no-swipe=""
              onClick={() => setPreviewItem(null)}
            >
              <img
                className={styles.previewImg}
                src={previewItem.previewUrl}
                alt={previewItem.file.name}
                data-ds-no-swipe=""
                onClick={(event) => event.stopPropagation()}
              />
              <button
                type="button"
                className={styles.previewClose}
                aria-label={t('cancel')}
                onClick={() => setPreviewItem(null)}
              >
                <IconCloseOutline20 />
              </button>
              <button
                type="button"
                className={styles.previewEdit}
                onClick={(event) => {
                  event.stopPropagation()
                  setEditingAttachmentId(previewItem.id)
                  setEditingFile(previewItem.file)
                  setPreviewItem(null)
                }}
              >
                {t('editImage')}
              </button>
            </div>,
            document.body
          )
        : null}
      {editingFile ? (
        <ImageEditor
          file={editingFile}
          onCancel={() => {
            setEditingFile(null)
            setEditingAttachmentId(null)
          }}
          onDone={(edited) => {
            const replaceId = editingAttachmentId
            setEditingFile(null)
            setEditingAttachmentId(null)
            // 从预览进入编辑：用新图替换原附件，而不是再追加一张
            if (replaceId) {
              removeDraftAttachment(sessionId, replaceId)
            }
            addFiles([edited])
          }}
        />
      ) : null}
      {dragging ? <DragMask /> : null}
    </div>
  )
}
