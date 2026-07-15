import { useScopeStore } from './scopeStore'

/**
 * 状态栏 — 仿 mcb_host/gui.py:HostWindow.status
 *   port@baud | frames=N bytes=N dropped=N | N pts span=... unit
 */
export function StatusBar(): JSX.Element {
  const status = useScopeStore((s) => s.status)
  const n = useScopeStore((s) => s.n)
  const ts = useScopeStore((s) => s.ts)
  const span = useScopeStore((s) => s.span)
  const spanUnit = useScopeStore((s) => s.spanUnit)
  const connected = useScopeStore((s) => s.connected)

  return (
    <footer className="px-3 py-1.5 border-t border-line bg-bg-panel text-xs text-fg-muted font-mono flex flex-wrap items-center gap-3">
      <span>
        {status.port || '—'} @ {status.baud || '—'}
      </span>
      <span className="text-fg-subtle">|</span>
      <span>frames={status.framesIn}</span>
      <span>bytes={status.bytesIn}</span>
      <span>dropped={status.dropped}</span>
      <span className="text-fg-subtle">|</span>
      <span>
        N={n} pts span={span.toPrecision(4)} {spanUnit}
      </span>
      {status.error && (
        <>
          <span className="text-fg-subtle">|</span>
          <span className="text-danger">ERR: {status.error}</span>
        </>
      )}
      <span className="ml-auto">
        {connected ? (
          <span className="text-accent">● connected</span>
        ) : (
          <span className="text-fg-subtle">● disconnected</span>
        )}
      </span>
    </footer>
  )
}