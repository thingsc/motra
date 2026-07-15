import { useScopeStore } from './scopeStore'

/**
 * 端口/波特率/Connect/Disconnect 控件
 */
export function ScopeControls(): JSX.Element {
  const cfg = useScopeStore((s) => s.cfg)
  const ports = useScopeStore((s) => s.ports)
  const connected = useScopeStore((s) => s.connected)
  const errorMessage = useScopeStore((s) => s.errorMessage)
  const setCfg = useScopeStore((s) => s.setCfg)
  const setErrorMessage = useScopeStore((s) => s.setErrorMessage)

  const handleConnect = async (): Promise<void> => {
    setErrorMessage(null)
    try {
      await window.api.serialOpen(cfg)
    } catch (err) {
      setErrorMessage(String((err as Error)?.message ?? err))
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    await window.api.serialClose()
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-fg-muted">Port</label>
      <select
        className="input-base min-w-[10rem]"
        value={cfg.port}
        onChange={(e) => setCfg({ port: e.target.value })}
        disabled={connected}
      >
        {ports.length === 0 && <option value="">(未发现串口)</option>}
        {ports.map((p) => (
          <option key={p.path} value={p.path}>
            {p.path}
            {p.friendlyName ? ` — ${p.friendlyName}` : ''}
          </option>
        ))}
      </select>

      <label className="text-xs text-fg-muted">Baud</label>
      <input
        type="number"
        className="input-base w-32"
        value={cfg.baud}
        onChange={(e) => setCfg({ baud: Number(e.target.value) || 0 })}
        disabled={connected}
      />

      {!connected ? (
        <button
          onClick={handleConnect}
          className="btn-primary"
          disabled={!cfg.port}
        >
          Connect
        </button>
      ) : (
        <button onClick={handleDisconnect} className="btn-ghost">
          Disconnect
        </button>
      )}

      {errorMessage && (
        <span className="text-xs text-danger" title={errorMessage}>
          ERR
        </span>
      )}
    </div>
  )
}