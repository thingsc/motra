import { useSessionStore } from '../store/sessionStore'
import { useViewStore } from '../views/useViewStore'
import { SidebarSection } from './SidebarSection'
import { SidebarItem } from './SidebarItem'

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
  const activeTool = useViewStore((s) => s.activeTool)
  const setActiveTool = useViewStore((s) => s.setActiveTool)

  const openScope = (): void => {
    setActiveTool('scope')
    void window.api.openScope()
  }

  return (
    <aside className="flex flex-col bg-bg-panel border-r border-line w-64 shrink-0">
      {/* ── Vibe Suite ── 占位,本期不放入口 */}
      <SidebarSection title="Vibe Suite">
        <div className="px-3 py-1.5 text-xs text-fg-subtle">（即将推出）</div>
      </SidebarSection>

      {/* ── AI 工具箱 ── 首批只放虚拟示波器 */}
      <SidebarSection title="AI 工具箱">
        <SidebarItem
          label="虚拟示波器"
          onClick={openScope}
          active={activeTool === 'scope'}
          title="打开虚拟示波器（独立窗口，串口收发 + 多通道波形）"
        />
      </SidebarSection>

      {/* ── 对话 ── 现有 session 列表(语义不变) */}
      <SidebarSection title="对话">
        <div className="px-2 pb-1">
          <button
            onClick={onNewSession}
            disabled={busy}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span className="text-lg leading-none">+</span>
            <span>New Session</span>
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto">
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
      </SidebarSection>

      {/* spacer 把版本号推到底 */}
      <div className="flex-1" />

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