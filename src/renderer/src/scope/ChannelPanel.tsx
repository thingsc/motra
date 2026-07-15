import { useMemo, useState, useEffect, useRef } from 'react'
import {
  useScopeStore,
  PANEL_CHANNEL_SLOTS,
  DEFAULT_Y_RANGE,
  BIAS_DIV_DEFAULT_MIN,
  BIAS_DIV_DEFAULT_MAX,
  BIAS_DIV_STEP,
  VDIV_DEFAULT_MIN,
  VDIV_DEFAULT_MAX,
  getEffectiveBiasRange,
  getEffectiveVdivRange,
  autoColor
} from './scopeStore'
import type { ChannelCfg } from './scopeStore'
import { computeStats } from './stats'

/**
 * 右侧通道配置面板。
 * - 8 个常驻槽位(全部可点 — 是否渲染波形取决于是否有 buf,与"可点"无关)
 * - 每行: enable + label(name 可改名) + 颜色覆盖 + bias + V/div + min/max/avg
 * - 顶部 "Reset colors" 把所有 colorOverride 清空
 * - label 单击进入行内编辑,Enter/blur 提交,Esc 取消
 * - bias 是 div 偏移(相对屏幕中线),和 yRange 解耦
 * - bias / V/div slider 范围可调:每行 [min][max] 输入,↺ 重置到默认
 */
export function ChannelPanel(): JSX.Element {
  const channels = useScopeStore((s) => s.channels)
  const buffers = useScopeStore((s) => s.buffers)
  const filled = useScopeStore((s) => s.filled)
  const n = useScopeStore((s) => s.n)
  const setChannelEnabled = useScopeStore((s) => s.setChannelEnabled)
  const setChannelBias = useScopeStore((s) => s.setChannelBias)
  const setChannelYRange = useScopeStore((s) => s.setChannelYRange)
  const setChannelColor = useScopeStore((s) => s.setChannelColor)
  const setChannelLabel = useScopeStore((s) => s.setChannelLabel)
  const setChannelRange = useScopeStore((s) => s.setChannelRange)
  const resetChannelColors = useScopeStore((s) => s.resetChannelColors)

  return (
    <aside
      className="w-[280px] shrink-0 border-l border-line bg-bg-panel flex flex-col overflow-y-auto"
      data-testid="channel-panel"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg-panel px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          Channels
        </span>
        <button
          type="button"
          onClick={resetChannelColors}
          className="btn-ghost px-2 py-0.5 text-xs"
          title="Restore auto colors (CH1..CH8 palette)"
        >
          Reset colors
        </button>
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: PANEL_CHANNEL_SLOTS }, (_, i) => {
          const ch = channels[i] ?? emptyChannelRow(i)
          return (
            <ChannelRow
              key={i}
              idx={i}
              ch={ch}
              buf={buffers[i]}
              filled={filled}
              n={n}
              onToggle={(v) => setChannelEnabled(i, v)}
              onBias={(v) => setChannelBias(i, v)}
              onYRange={(v) => setChannelYRange(i, v)}
              onColor={(c) => setChannelColor(i, c)}
              onLabel={(s) => setChannelLabel(i, s)}
              onRange={(kind, range) => setChannelRange(i, kind, range)}
            />
          )
        })}
      </div>
    </aside>
  )
}

function emptyChannelRow(i: number): ChannelCfg {
  return {
    name: `CH${i + 1}`,
    signed: false,
    scale: 1,
    offset: 0,
    unit: '',
    enabled: false,
    bias: 0,
    yRange: DEFAULT_Y_RANGE,
    colorOverride: null,
    label: '',
    range: {}
  }
}

interface RowProps {
  idx: number
  ch: ChannelCfg
  buf: Float32Array | undefined
  filled: number
  n: number
  onToggle: (v: boolean) => void
  onBias: (v: number) => void
  onYRange: (v: number) => void
  onColor: (c: string | null) => void
  onLabel: (label: string) => void
  /** 设置该通道某项 slider 的范围;null = 重置为默认 */
  onRange: (
    kind: 'bias' | 'vdiv',
    range: { min: number; max: number } | null
  ) => void
}

function ChannelRow(p: RowProps): JSX.Element {
  const {
    idx,
    ch,
    buf,
    filled,
    n,
    onToggle,
    onBias,
    onYRange,
    onColor,
    onLabel,
    onRange
  } = p
  const color = ch.colorOverride ?? autoColor(idx)
  const stats = useMemo(
    () => (buf ? computeStats(buf, n, filled) : null),
    [buf, n, filled]
  )
  // bias/yRange/颜色 控件仅在通道被勾选后可调(无 buf 仍可调,只是没波形)
  const enabled = ch.enabled
  const yRange = Number.isFinite(ch.yRange) && ch.yRange > 0 ? ch.yRange : DEFAULT_Y_RANGE
  // bias/V/div 范围可 per-channel 自定义
  const biasR = getEffectiveBiasRange(ch)
  const vdivR = getEffectiveVdivRange(ch)
  const biasClamped = clampBias(ch.bias, biasR.max)
  // V/div slider 用对数轴
  const vdivLogMin = Math.log10(vdivR.min)
  const vdivLogMax = Math.log10(vdivR.max)
  const vdivLogVal = Math.log10(Math.max(vdivR.min, Math.min(vdivR.max, yRange)))
  const biasRangeCustom = ch.range.bias !== undefined
  const vdivRangeCustom = ch.range.vdiv !== undefined

  return (
    <div className="px-3 py-2">
      {/* row 1: checkbox + 名称(可改名) + 颜色 */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={ch.enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-4 w-4 cursor-pointer"
          style={{ accentColor: color }}
          title="Enable channel"
        />
        <LabelEditor ch={ch} onCommit={onLabel} />
        <input
          type="color"
          value={color}
          onChange={(e) => onColor(e.target.value)}
          className="h-5 w-5 cursor-pointer rounded border border-line bg-transparent"
          title="Click to override color (Reset colors restores auto)"
        />
      </div>

      {/* row 2: Bias — [label] [min+slider+max] [↺]
         * row 2.5:           [占位] [实时值居中]      [占位]  ← 实时值在 slider 列正中间下方 */}
      <div className="mt-1.5 flex items-center gap-1 text-xs text-fg-muted">
        <span className="w-10 shrink-0">Bias</span>
        <div className="flex flex-1 items-center gap-1 min-w-0">
          <LimitInput
            value={biasR.min}
            onCommit={(v) => onRange('bias', { min: v, max: biasR.max })}
            step={BIAS_DIV_STEP}
            disabled={!enabled}
            width="w-14"
          />
          <input
            type="range"
            min={biasR.min}
            max={biasR.max}
            step={BIAS_DIV_STEP}
            value={biasClamped}
            disabled={!enabled}
            onChange={(e) => onBias(Number(e.target.value))}
            className="flex-1 min-w-0 disabled:cursor-not-allowed"
            style={{ accentColor: color }}
            title={`零线 div 偏移(范围 ${biasR.min}~${biasR.max});正=零线上移。`}
          />
          <LimitInput
            value={biasR.max}
            onCommit={(v) => onRange('bias', { min: biasR.min, max: v })}
            step={BIAS_DIV_STEP}
            disabled={!enabled}
            width="w-14"
          />
        </div>
        <div className="w-4 shrink-0 flex justify-end">
          {biasRangeCustom && (
            <button
              type="button"
              onClick={() => onRange('bias', null)}
              className="rounded px-1 text-fg-muted hover:bg-bg-hover hover:text-fg-base"
              title={`重置 Bias 范围到默认 (${BIAS_DIV_DEFAULT_MIN} ~ ${BIAS_DIV_DEFAULT_MAX})`}
            >
              ↺
            </button>
          )}
        </div>
      </div>
      {/* row 2.5: bias 实时值(可编辑)+ 单位,居中到 slider 列下方 */}
      <ValueRow
        value={biasClamped}
        step={BIAS_DIV_STEP}
        min={biasR.min}
        max={biasR.max}
        disabled={!enabled}
        unit="div"
        onCommit={onBias}
        decimals={2}
        width="w-16"
      />

      {/* row 3: V/div — [label] [min+slider+max] [↺] */}
      <div className="mt-2 flex items-center gap-1 text-xs text-fg-muted">
        <span className="w-10 shrink-0">V/div</span>
        <div className="flex flex-1 items-center gap-1 min-w-0">
          <LimitInput
            value={vdivR.min}
            onCommit={(v) => onRange('vdiv', { min: v, max: vdivR.max })}
            step="any"
            disabled={!enabled}
            width="w-16"
          />
          <input
            type="range"
            min={vdivLogMin}
            max={vdivLogMax}
            step={0.05}
            value={vdivLogVal}
            disabled={!enabled}
            onChange={(e) => onYRange(Math.pow(10, Number(e.target.value)))}
            className="flex-1 min-w-0 disabled:cursor-not-allowed"
            title={`Per-div engineering units (5 divs full screen = ${(5 * yRange).toExponential(2)}) = ${yRange.toExponential(2)}`}
          />
          <LimitInput
            value={vdivR.max}
            onCommit={(v) => onRange('vdiv', { min: vdivR.min, max: v })}
            step="any"
            disabled={!enabled}
            width="w-16"
          />
        </div>
        <div className="w-4 shrink-0 flex justify-end">
          {vdivRangeCustom && (
            <button
              type="button"
              onClick={() => onRange('vdiv', null)}
              className="rounded px-1 text-fg-muted hover:bg-bg-hover hover:text-fg-base"
              title={`重置 V/div 范围到默认 (${VDIV_DEFAULT_MIN} ~ ${VDIV_DEFAULT_MAX})`}
            >
              ↺
            </button>
          )}
        </div>
      </div>
      {/* row 3.5: V/div 实时值(可编辑)+ 单位,居中到 slider 列下方 */}
      <ValueRow
        value={yRange}
        step="any"
        min={vdivR.min}
        max={vdivR.max}
        disabled={!enabled}
        unit={ch.unit || 'V'}
        onCommit={onYRange}
        decimals={3}
        width="w-20"
      />

      {/* row 4: min / max / avg */}
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-fg-subtle">
        <span>
          min{' '}
          <span className="text-fg-base">
            {stats ? fmtNum(stats.min) : '—'}
          </span>
        </span>
        <span>
          max{' '}
          <span className="text-fg-base">
            {stats ? fmtNum(stats.max) : '—'}
          </span>
        </span>
        <span>
          avg{' '}
          <span className="text-fg-base">
            {stats ? fmtNum(stats.avg) : '—'}
          </span>
        </span>
      </div>
    </div>
  )
}

/** 行内 label 编辑:静态态显示文本,点击进入 input,Enter/blur 提交,Esc 取消。 */
function LabelEditor(props: { ch: ChannelCfg; onCommit: (label: string) => void }): JSX.Element {
  const { ch, onCommit } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const display = ch.label || ch.name

  const enterEdit = (): void => {
    setDraft(ch.label || ch.name)
    setEditing(true)
  }
  const cancel = (): void => {
    setEditing(false)
    setDraft('')
  }
  const commit = (): void => {
    const trimmed = draft.trim()
    // 等于 name 视作"清空 label,回退到 name"
    onCommit(trimmed === ch.name ? '' : trimmed)
    setEditing(false)
    setDraft('')
  }

  if (!editing) {
    return (
      <span
        className="flex-1 cursor-text truncate text-sm font-medium hover:bg-bg-hover rounded px-1 -mx-1"
        title={
          ch.unit
            ? `${display} (${ch.unit}) — click to rename`
            : `${display} — click to rename`
        }
        onClick={enterEdit}
        data-testid={`label-${ch.name}`}
      >
        {display}
        {ch.unit && (
          <span className="ml-1 text-xs text-fg-subtle">[{ch.unit}]</span>
        )}
      </span>
    )
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      className="input-base flex-1 text-sm"
      maxLength={32}
    />
  )
}

function clampBias(bias: number, max: number): number {
  if (!Number.isFinite(bias)) return 0
  // 对称截断到 ±max
  return Math.max(-max, Math.min(max, bias))
}

interface LimitInputProps {
  /** 当前生效的值(slider 的 min 或 max) */
  value: number
  /** 提交新值(只在 blur/Enter 触发) */
  onCommit: (v: number) => void
  /** 步长,"any" 表示任意 */
  step?: number | 'any'
  disabled?: boolean
  /** Tailwind 宽度 class,例如 'w-12' / 'w-14' */
  width: string
}

/** slider 侧边的 limit 数字框:
 *  - 显示当前 min/max 值
 *  - 用户在 blur/Enter 时校验(有限数)才提交
 *  - 用 local draft 防止输入 "-" / "." 等半成品时 store 抖动 */
function LimitInput(p: LimitInputProps): JSX.Element {
  const { value, onCommit, step = 'any', disabled, width } = p
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const v = Number(draft)
    if (!Number.isFinite(v) || v === value) {
      setDraft(String(value))
      return
    }
    onCommit(v)
  }

  return (
    <input
      type="number"
      step={step}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(String(value))
        }
      }}
      className={`input-base ${width} shrink-0 text-right font-mono disabled:cursor-not-allowed`}
    />
  )
}

interface ValueRowProps {
  /** 实时值(从 store 拿,会随 slider 拖动实时变) */
  value: number
  min: number
  max: number
  step?: number | 'any'
  disabled?: boolean
  /** 显示单位(div / V / RPM / counts …) */
  unit: string
  /** 提交新值 */
  onCommit: (v: number) => void
  /** 小数位数(bias 用 2,V/div 用 3) */
  decimals: number
  /** input 宽度(Tailwind class,如 'w-12' / 'w-16') */
  width: string
}

/** slider 下方的实时值行:
 *  - number input 显示当前值,拖 slider 时实时同步
 *  - 用户编辑时(在范围内)提交 onCommit;超界/非法回滚
 *  - 右侧单位用小字
 *  - 居中到 slider 列下方(行结构 [label 占位 w-10][居中 flex-1][↺ 占位 w-5]) */
function ValueRow(p: ValueRowProps): JSX.Element {
  const { value, min, max, step = 'any', disabled, unit, onCommit, decimals, width } = p
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft !== null ? draft : value.toFixed(decimals)

  const commit = (): void => {
    const raw = draft
    setDraft(null)
    const v = Number(raw ?? display)
    if (!Number.isFinite(v)) return
    const clipped = Math.max(min, Math.min(max, v))
    if (clipped !== value) onCommit(clipped)
  }

  return (
    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-fg-subtle">
      <span className="w-10 shrink-0" />
      <div className="flex flex-1 items-center justify-center gap-1 min-w-0">
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={display}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(null)
            }
          }}
          className={`input-base ${width} text-right font-mono disabled:cursor-not-allowed`}
        />
        <span className="shrink-0 font-mono">{unit}</span>
      </div>
      <span className="w-4 shrink-0" />
    </div>
  )
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1000) return v.toExponential(1)
  if (abs >= 10) return v.toFixed(1)
  return v.toFixed(2)
}