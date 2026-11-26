import { useState } from 'react'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconEditOutline16,
} from '../base/icons.js'
import { setApiKey, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { useApiKeyForm } from './useApiKeyForm.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** API Key 的编辑状态：输入框与「确定」按钮共用 */
export const useApiKeyEditor = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const [editing, setEditing] = useState(false)
  const form = useApiKeyForm(() => setEditing(false))
  return { apiKey, editing, setEditing, form, showInput: !apiKey || editing }
}

type ApiKeyEditor = ReturnType<typeof useApiKeyEditor>

/** API Key：保存后只显示掩码，点编辑按钮才能重新输入 */
export const ApiKeyField = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const { apiKey, editing, setEditing, form, showInput } = editor

  // 已经保存过 Key 时，X 删除的是已保存的 Key；没保存过就只清空输入
  const clear = () => {
    form.setValue('')
    if (apiKey) {
      setApiKey('')
      setEditing(false)
      showToast({ key: 'apiKeyRemoved' })
    }
  }

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('apiKeyStart')}</div>
        {apiKey && !editing ? (
          <div className={styles.apiKeySaved}>
            <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
            <IconButton
              tone="primary"
              icon={<IconEditOutline16 />}
              tooltip={t('apiKeyEdit')}
              onClick={() => setEditing(true)}
            />
          </div>
        ) : (
          <div className={styles.apiKeyRow}>
            <div className={styles.apiKeyInput}>
              <input
                type="password"
                placeholder={t('apiKeyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                // 移动端打开设置时不弹键盘，点编辑后才聚焦
                autoFocus={!isMobile || editing}
                value={form.value}
                onChange={(event) => form.setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    void form.submit()
                  }
                }}
                onBlur={() => {
                  // 修改时没输入就离开，回到已保存的状态
                  if (apiKey && !form.value.trim()) {
                    setEditing(false)
                  }
                }}
              />
              {apiKey || form.value ? (
                <button
                  type="button"
                  className={styles.apiKeyClear}
                  aria-label={t('apiKeyClear')}
                  title={t('apiKeyClear')}
                  // 保持输入框焦点
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clear}
                >
                  <IconCloseOutline16 />
                </button>
              ) : null}
            </div>
            {/* 与输入框同一行：没输入时不占位，输入后出现 */}
            {form.value.trim() ? (
              <button
                type="button"
                className={styles.apiKeySubmit}
                disabled={form.verifying}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void form.submit()}
              >
                <IconCheckOutline16 />
                <span>{form.verifying ? t('apiKeyVerifying') : t('confirm')}</span>
              </button>
            ) : null}
          </div>
        )}
        {showInput && form.error ? <div className={styles.error}>{form.error}</div> : null}
      </div>
    </div>
  )
}
