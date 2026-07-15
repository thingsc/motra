import { useScopeStore, N_SAMPLES_MIN, N_SAMPLES_MAX } from './scopeStore'

/**
 * Ts / N / Span 三联联动控件
 * 仿 mcb_host/gui.py:_on_ts_edited / _on_n_edited / _on_span_edited
 */
export function SamplingControls(): JSX.Element {
  const ts = useScopeStore((s) => s.ts)
  const n = useScopeStore((s) => s.n)
  const span = useScopeStore((s) => s.span)
  const spanUnit = useScopeStore((s) => s.spanUnit)
  const setTs = useScopeStore((s) => s.setTs)
  const setN = useScopeStore((s) => s.setN)
  const setSpan = useScopeStore((s) => s.setSpan)

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-fg-muted">Ts (s)</label>
      <input
        type="text"
        inputMode="decimal"
        className="input-base w-24"
        value={ts}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v > 0) setTs(v)
        }}
        title="Sample period in seconds (e.g. 5e-5)"
      />

      <label className="text-xs text-fg-muted">Pts</label>
      <input
        type="number"
        min={N_SAMPLES_MIN}
        max={N_SAMPLES_MAX}
        className="input-base w-24"
        value={n}
        onChange={(e) => setN(Number(e.target.value) || N_SAMPLES_MIN)}
      />

      <label className="text-xs text-fg-muted">Span</label>
      <input
        type="number"
        min={0}
        step="any"
        className="input-base w-24"
        value={span.toPrecision(6)}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v > 0) setSpan(v, spanUnit)
        }}
      />
      <select
        className="input-base w-16"
        value={spanUnit}
        onChange={(e) => {
          const newUnit = e.target.value as 'µs' | 'ms' | 's'
          // 切单位时把当前 span 当作新单位的值传过去
          setSpan(span, newUnit)
        }}
      >
        <option value="µs">µs</option>
        <option value="ms">ms</option>
        <option value="s">s</option>
      </select>
    </div>
  )
}