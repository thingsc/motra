import { useEffect, useRef } from 'react'
import { useSessionStore } from '../store/sessionStore'
import type { Message } from '../../../shared/types'

export function ChatPane(): JSX.Element {
  const currentId = useSessionStore((s) => s.currentId)
  const session = useSessionStore((s) =>
    s.currentId ? s.sessions[s.currentId] : undefined
  )
  const inflight = useSessionStore((s) => s.inflight)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 流式追加 / 新消息 / inflight 出现/消失 都要滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [session?.messages.length, currentId, inflight])

  // 当前 session 是否在等回复(用于显示"思考中"指示)
  const isInflight = currentId ? inflight.has(currentId) : false
  // 只有"发了 user 但还没收到第一条 assistant text"时才显示完整 thinking
  // —— 一旦 assistant message 出现,就把指示交给 message 自己的 streaming 圆点
  const lastMsg = session?.messages[session.messages.length - 1]
  const showThinking = isInflight && (!lastMsg || lastMsg.role === 'user')

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-muted">
        点左侧 New Session 开一个会话
      </div>
    )
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-bg-base">
      <div className="px-4 py-2 border-b border-line text-sm text-fg-muted flex items-center justify-between">
        <div>
          <span className="text-fg-base font-medium">{session.title}</span>
          <span className="ml-3">
            {session.cmd} {(session.args ?? []).join(' ')}
          </span>
        </div>
        <div className="text-xs text-fg-subtle">id: {session.id.slice(0, 8)}</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {session.messages.length === 0 && (
          <div className="text-center text-fg-muted mt-12 text-sm">
            还没有消息。 在下方输入框发条消息试试,例如 "hello, who are you?"
          </div>
        )}
        {session.messages.map((m: Message) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
        {showThinking && <ThinkingIndicator />}
      </div>
    </section>
  )
}

function MessageBubble({ msg }: { msg: Message }): JSX.Element {
  if (msg.role === 'system') {
    return (
      <div className="text-center text-xs text-fg-subtle italic">
        {msg.content}
      </div>
    )
  }
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-accent text-white'
            : 'bg-bg-panel border border-line text-fg-base'
        }`}
      >
        <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">
          {isUser ? 'You' : 'Assistant'}
          {msg.streaming && (
            <span className="ml-2 inline-block w-1.5 h-1.5 align-middle bg-accent rounded-full animate-pulse" />
          )}
        </div>
        {msg.content}
      </div>
    </div>
  )
}

// inflight 期间、还没收到第一条 assistant text 之前显示的"思考中"提示。
// 收到第一条 text_delta 后,ChatPane 会自动切走指示器,改由 assistant bubble 自己的 streaming 圆点接管。
function ThinkingIndicator(): JSX.Element {
  return (
    <div className="flex justify-start" data-testid="thinking-indicator">
      <div className="bg-bg-panel border border-line rounded-lg px-3 py-2 text-sm text-fg-muted flex items-center gap-2">
        <span className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-fg-muted animate-bounce" />
        </span>
        <span className="italic">思考中…</span>
      </div>
    </div>
  )
}
