import { useSessionStore } from '../store/sessionStore'

interface Props {
  busy: boolean
  onNewSession: () => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
}

export function Sidebar({ busy, onNewSession, onDelete }: Props): JSX.Element {
  const order = useSessionStore((s) => s.order)
  const sessions = useSessionStore((s) => s.sessions)
  const currentId = useSessionStore((s) => s.currentId)
  const select = useSessionStore((s) => s.select)

  return (
    <aside className="flex flex-col bg-bg-panel border-r border-line w-64 shrink-0">
      <div className="p-3 border-b border-line">
        <button
          onClick={onNewSession}
          disabled={busy}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <span className="text-lg leading-none">+</span>
          <span>New Session</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {order.length === 0 && (
          <div className="px-3 py-6 text-center text-fg-muted text-sm">
            还没有会话 — 试试点 New Session
          </div>
        )}
        {order.map((id) => {
          const s = sessions[id]
          if (!s) return null
          const last = s.messages[s.messages.length - 1]
          const preview = last?.content?.replace(/\s+/g, ' ').slice(0, 60) || '(无消息)'
          const isActive = id === currentId
          return (
            <button
              key={id}
              onClick={() => select(id)}
              className={`group block w-full text-left px-3 py-2 mx-1 my-0.5 rounded-md border ${
                isActive
                  ? 'bg-bg-hover border-line text-fg-base'
                  : 'border-transparent text-fg-base hover:bg-bg-hover'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium truncate text-sm">{s.title || 'Untitled'}</div>
                <StatusBadge status={s.status} />
              </div>
              <div className="mt-1 text-xs text-fg-muted truncate">{preview}</div>
              <div className="mt-1 text-xs text-fg-subtle flex items-center justify-between">
                <span>{new Date(s.updatedAt).toLocaleString('zh-CN')}</span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onDelete(id)
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-danger"
                >
                  删除
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="p-3 border-t border-line text-xs text-fg-subtle">
        electron {window.api?.versions.electron ?? '?'} · node {window.api?.versions.node ?? '?'}
      </div>
    </aside>
  )
}

function StatusBadge({ status }: { status: 'idle' | 'running' | 'exited' | 'error' }): JSX.Element {
  const dot =
    status === 'running'
      ? 'bg-accent animate-pulse'
      : status === 'error'
      ? 'bg-danger'
      : 'bg-fg-subtle'
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${dot}`}
      title={status}
      aria-label={status}
    />
  )
}
