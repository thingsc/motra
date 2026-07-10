import { useRef, useState, type KeyboardEvent } from 'react'

interface Props {
  disabled: boolean
  placeholder?: string
  onSubmit: (text: string) => void | Promise<void>
  onStop?: () => void
  running: boolean
}

export function Composer({
  disabled,
  placeholder,
  onSubmit,
  onStop,
  running
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const submit = (): void => {
    const t = text.trim()
    if (!t) return
    setText('')
    if (taRef.current) taRef.current.style.height = 'auto'
    void onSubmit(t)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Ctrl+Enter 提交(支持 IME:不阻止 Enter,只在 Ctrl/Cmd+Enter 时拦截)
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-line p-3 bg-bg-panel">
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
          placeholder={
            placeholder ?? '输入消息 ··· Ctrl+Enter 发送(留空会跳过)'
          }
          rows={2}
          className="flex-1 resize-none bg-bg-base border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-60"
          style={{ minHeight: 56, maxHeight: 240 }}
        />
        <div className="flex flex-col gap-2">
          {running ? (
            <button onClick={onStop} className="btn-ghost border border-danger text-danger">
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={disabled || !text.trim()}
              className="btn-primary disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 text-[11px] text-fg-subtle">
        Ctrl/Cmd + Enter 提交 · 输入文本会作为 stdin 喂给当前 session 的 CLI 子进程
      </div>
    </div>
  )
}
