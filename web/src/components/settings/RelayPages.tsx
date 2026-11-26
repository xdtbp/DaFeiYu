import { useEffect, useRef, useState } from 'react'
import { createId } from '../../utils/id.js'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  findServer,
  normalizeUrl,
  testRelay,
  useRelay,
  type ApiKind,
  type RelayServer,
  type RouteChoice,
} from '../../services/relay.js'
import { Select } from '../base/Select.js'
import { useAccount } from '../../services/account.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

/**
 * 设置里的二级页面：从右侧滑入，退出时向左滑出（closing）。
 * 背景和设置弹窗用同一层（bg-layer-2），深浅色都不会割裂；
 * 不新开弹层，所以不会叠第二层模糊。
 */
export const SubPage = ({
  title,
  onBack,
  action,
  closing = false,
  zIndex,
  children,
}: {
  title: string
  onBack: () => void
  action?: React.ReactNode
  closing?: boolean
  zIndex?: number
  children: React.ReactNode
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.subPage, closing && styles.subPageClosing)} style={{ zIndex }}>
      <div className={styles.subPageHead}>
        <button
          type="button"
          className={styles.subPageBack}
          onClick={onBack}
          aria-label={t('relayBack')}
        >
          <span className={styles.subPageBackIcon} aria-hidden>
            ‹
          </span>
          <span>{t('relayBack')}</span>
        </button>
        <div className={styles.subPageTitle}>{title}</div>
        <div className={styles.subPageAction}>{action}</div>
      </div>
      <div className={styles.subPageBody}>{children}</div>
    </div>
  )
}

/** 问号 + 气泡：和花费估算那种提示一致，点一下出现，再点或点别处消失 */
const Hint = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  return (
    <span ref={wrapRef} className={styles.hintWrap}>
      <button
        type="button"
        className={styles.hintButton}
        aria-label={text}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open ? (
        <span role="tooltip" className={styles.hintBubble}>
          {text}
        </span>
      ) : null}
    </span>
  )
}

/** 中继服务器列表：整行可点进入编辑，右侧删除需二次确认 */
export const RelayListPage = ({
  onBack,
  onEdit,
  closing,
  zIndex,
}: {
  onBack: () => void
  onEdit: (id: string | null) => void
  closing?: boolean
  zIndex?: number
}) => {
  const t = useTranslate()
  const servers = useRelay((state) => state.servers)
  const removeServer = useRelay((state) => state.removeServer)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  return (
    <SubPage
      title={t('relaySectionTitle')}
      onBack={onBack}
      closing={closing}
      zIndex={zIndex}
      action={
        <button
          type="button"
          className={styles.subPageAdd}
          onClick={() => onEdit(null)}
          aria-label={t('relayAddTitle')}
        >
          +
        </button>
      }
    >
      {servers.length === 0 ? (
        <div className={styles.subPageEmpty}>{t('relayEmpty')}</div>
      ) : (
        <div className={styles.subPageList}>
          {servers.map((server) => (
            <div
              key={server.id}
              className={styles.relayItem}
              role="button"
              tabIndex={0}
              onClick={() => onEdit(server.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onEdit(server.id)
                }
              }}
            >
              <div className={styles.relayItemMain}>
                <div className={styles.relayItemName}>{server.name || server.url}</div>
                <div
                  className={clsx(styles.description, server.lastStatus === 'error' && styles.error)}
                >
                  {server.lastStatus === 'ok'
                    ? t('relayStatusOk')
                    : server.lastStatus === 'error'
                      ? server.lastError || t('relayStatusError')
                      : server.url}
                </div>
              </div>
              {confirmId === server.id ? (
                <div
                  className={styles.relayItemActions}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className={styles.relayDanger}
                    onClick={() => {
                      removeServer(server.id)
                      setConfirmId(null)
                      showToast({ key: 'relayDeleted' })
                    }}
                  >
                    {t('relayConfirmDelete')}
                  </button>
                  <button
                    type="button"
                    className={styles.relayGhost}
                    onClick={() => setConfirmId(null)}
                  >
                    {t('cancel')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.relayDanger}
                  onClick={(event) => {
                    event.stopPropagation()
                    setConfirmId(server.id)
                  }}
                >
                  {t('relayDelete')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SubPage>
  )
}

/** 新增 / 编辑中继：地址、账号、密码，保存前先测一次连接 */
export const RelayEditPage = ({
  relayId,
  onBack,
  closing,
  zIndex,
}: {
  relayId: string | null
  onBack: () => void
  closing?: boolean
  zIndex?: number
}) => {
  const t = useTranslate()
  const saveServer = useRelay((state) => state.saveServer)
  const server = relayId ? findServer(relayId) : null
  const [name, setName] = useState(server?.name ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [username, setUsername] = useState(server?.username ?? '')
  const [password, setPassword] = useState(server?.password ?? '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  // 新增时先固定一个 id：保存与测试要写回同一条记录
  const idRef = useRef(server?.id ?? createId())

  const draft = (): RelayServer => ({
    id: idRef.current,
    name: name.trim() || normalizeUrl(url).replace(/^https?:\/\//, ''),
    url: normalizeUrl(url),
    username: username.trim(),
    password,
    token: server?.token ?? '',
    tokenExpiresAt: server?.tokenExpiresAt ?? 0,
    userName: server?.userName ?? '',
    lastStatus: 'unknown',
    lastError: '',
    lastCheckedAt: 0,
  })

  const onTest = async () => {
    const target = draft()
    if (!target.url || !target.username || !target.password) {
      setStatus(t('relayFillAll'))
      return
    }
    setBusy(true)
    saveServer(target)
    const result = await testRelay(target)
    setBusy(false)
    setStatus(result.message)
  }

  const onSave = async () => {
    const target = draft()
    if (!target.url || !target.username || !target.password) {
      setStatus(t('relayFillAll'))
      return
    }
    setBusy(true)
    saveServer(target)
    const result = await testRelay(target)
    setBusy(false)
    if (result.ok) {
      showToast({ key: 'relaySaved' })
      onBack()
    } else {
      setStatus(result.message)
    }
  }

  return (
    <SubPage
      title={server ? t('relayEditTitle') : t('relayAddTitle')}
      onBack={onBack}
      closing={closing}
      zIndex={zIndex}
      action={
        <button type="button" className={styles.subPagePrimary} disabled={busy} onClick={onSave}>
          {t('relaySave')}
        </button>
      }
    >
      <div className={styles.relayForm}>
        <label className={styles.relayField}>
          <span>{t('relayName')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('relayNamePlaceholder')}
          />
        </label>
        <label className={styles.relayField}>
          <span>{t('relayUrl')}</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://relay.example.com:8443"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className={styles.relayField}>
          <span>{t('relayUsername')}</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className={styles.relayField}>
          <span>{t('relayPassword')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <div className={styles.relayFormActions}>
          <button type="button" className={styles.relayGhost} disabled={busy} onClick={onTest}>
            {busy ? t('relayTesting') : t('relayTest')}
          </button>
        </div>
        {status ? <div className={styles.description}>{status}</div> : null}
        <div className={styles.description}>{t('relayPasswordHint')}</div>
      </div>
    </SubPage>
  )
}

const KIND_LABEL = {
  search: 'relayKindSearch',
  parse: 'relayKindParse',
  speech: 'relayKindSpeech',
} as const

const KIND_HINT = {
  search: 'relayKindSearchHint',
  parse: 'relayKindParseHint',
  speech: 'relayKindSpeechHint',
} as const

/** 接口设置：四类接口各自选「账户 / API / 某台中继」 */
export const RoutesPage = ({
  onBack,
  closing,
  zIndex,
}: {
  onBack: () => void
  closing?: boolean
  zIndex?: number
}) => {
  const t = useTranslate()
  const routes = useRelay((state) => state.routes)
  const servers = useRelay((state) => state.servers)
  const setRoute = useRelay((state) => state.setRoute)
  const signedIn = useAccount((state) => state.status === 'signed-in')
  const apiKey = useSettings((state) => state.apiKey)
  // 只列出当前真的能用的出口：没登录就没有「账户」，没 Key 就没有「API」
  const available = [
    ...(signedIn ? [{ value: 'account', label: t('relayTargetAccount') }] : []),
    ...(apiKey ? [{ value: 'apikey', label: t('relayTargetApikey') }] : []),
    ...servers.map((server) => ({ value: `relay:${server.id}`, label: server.name || server.url })),
  ]

  const valueOf = (choice: RouteChoice) =>
    choice.target === 'relay' ? `relay:${choice.relayId}` : choice.target

  const onChange = (kind: ApiKind, value: string) => {
    if (value.startsWith('relay:')) {
      setRoute(kind, { target: 'relay', relayId: value.slice(6) })
    } else {
      setRoute(kind, { target: value as 'account' | 'apikey', relayId: null })
    }
  }

  // 当前选择不可用（例如删掉了 API Key）就落到第一个可用项
  const fallback = (kind: ApiKind) => {
    const current = valueOf(routes[kind])
    if (available.some((option) => option.value === current)) {
      return
    }
    setRoute(kind, { target: available[0]?.value === 'account' ? 'account' : 'apikey', relayId: null })
  }
  useEffect(() => {
    for (const kind of Object.keys(KIND_LABEL) as Exclude<ApiKind, 'chat'>[]) {
      fallback(kind)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available.length])

  return (
    <SubPage title={t('relayRoutesTitle')} onBack={onBack} closing={closing} zIndex={zIndex}>
      <div className={styles.subPageList}>
        {(Object.keys(KIND_LABEL) as Exclude<ApiKind, 'chat'>[]).map((kind) => (
          <div key={kind} className={styles.relayRouteRow}>
            <div className={styles.relayRouteText}>
              <div className={styles.label}>
                {t(KIND_LABEL[kind])}
                {KIND_HINT[kind] ? <Hint text={t(KIND_HINT[kind])} /> : null}
              </div>
            </div>
            <Select
              ariaLabel={t(KIND_LABEL[kind])}
              value={valueOf(routes[kind])}
              options={available}
              onChange={(value) => onChange(kind, value)}
            />
          </div>
        ))}
      </div>
      {available.length === 0 ? (
        <div className={styles.subPageEmpty}>{t('relayRoutesEmpty')}</div>
      ) : null}
    </SubPage>
  )
}

/** 用户信息：侧边栏头像昵称取账号还是某台中继 */
export const IdentityPage = ({
  onBack,
  closing,
  zIndex,
}: {
  onBack: () => void
  closing?: boolean
  zIndex?: number
}) => {
  const t = useTranslate()
  const servers = useRelay((state) => state.servers)
  const identitySource = useRelay((state) => state.identitySource)
  const identityRelayId = useRelay((state) => state.identityRelayId)
  const setIdentity = useRelay((state) => state.setIdentity)

  return (
    <SubPage title={t('relayIdentityTitle')} onBack={onBack} closing={closing} zIndex={zIndex}>
      <div className={styles.subPageList}>
        <button
          type="button"
          className={clsx(styles.relayChoice, identitySource === 'account' && styles.relayChoiceOn)}
          onClick={() => setIdentity('account', null)}
        >
          {t('relayTargetAccount')}
        </button>
        {servers.map((server) => (
          <button
            key={server.id}
            type="button"
            className={clsx(
              styles.relayChoice,
              identitySource === 'relay' && identityRelayId === server.id && styles.relayChoiceOn
            )}
            onClick={() => setIdentity('relay', server.id)}
          >
            {server.name || server.url}
            {server.userName ? <span className={styles.description}>{server.userName}</span> : null}
          </button>
        ))}
      </div>
    </SubPage>
  )
}
