import { useState } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { SettingsPopover } from './SettingsPopover'

interface Props {
  onRestart: () => void | Promise<void>
  busy: boolean
}

export function Topbar({ onRestart, busy }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const currentId = useSessionStore((s) => s.currentId)
  const status = useSessionStore((s) =>
    s.currentId ? s.sessions[s.currentId]?.status : undefined
  )

  return (
    <header className="h-12 border-b border-line bg-bg-panel flex items-center px-4 gap-4 shrink-0">
      <div className="font-semibold flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-accent" />
        Motra
        <span className="ml-2 text-xs text-fg-muted font-normal">step 1 · CLI pass-through</span>
      </div>

      <div className="flex-1" />

      <div className="text-xs text-fg-muted">
        {currentId ? (
          <>
            status: <span className="text-fg-base">{status ?? 'idle'}</span>
          </>
        ) : (
          'no active session'
        )}
      </div>

      <button
        onClick={() => void onRestart()}
        disabled={!currentId || busy}
        className="btn-ghost disabled:opacity-40"
        title="重启当前 session 的 CLI 子进程"
      >
        Restart
      </button>

      <div className="relative">
        <button onClick={() => setOpen((v) => !v)} className="btn-ghost">
          Settings
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-72 bg-bg-raised border border-line rounded-md shadow-xl p-3 z-10">
            <SettingsPopover onClose={() => setOpen(false)} />
          </div>
        )}
      </div>
    </header>
  )
}
