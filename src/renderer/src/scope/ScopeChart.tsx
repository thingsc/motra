// 虚拟示波器主图:单坐标系 SVG,多通道叠加渲染。
// 每通道独立的 yScale:  y_px = centerY - (bias + v / yRange) * (innerH / 5)
//   - bias 是 div 偏移(相对屏幕中线),0=中线,+2.5=顶,-2.5=底
//   - 改 bias 整体上下平移波形,和 yRange(V/div)解耦 — 改 V/div 不会让零线漂
//   - bias 增 → 零线和波形一起上移;bias 减 → 一起下移
// 共享 xScale:          x_px = padding.left + (i / (n-1)) * innerW
// 30fps rAF ticker 节流,避免每帧重渲。

import { useEffect, useRef, useState } from 'react'
import { useScopeStore, autoColor, type ChannelCfg } from './scopeStore'

const GRID_COLOR = 'var(--scope-grid)'
const AXIS_COLOR = 'var(--scope-axis)'
const SUBPLOT_BG = 'var(--scope-bg)'

export function ScopeChart(): JSX.Element {
  const channels = useScopeStore((s) => s.channels)
  const buffers = useScopeStore((s) => s.buffers)
  const filled = useScopeStore((s) => s.filled)
  const n = useScopeStore((s) => s.n)
  const ts = useScopeStore((s) => s.ts)
  const spanUnit = useScopeStore((s) => s.spanUnit)
  const paused = useScopeStore((s) => s.paused)

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 480 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({
        w: Math.max(320, Math.floor(width)),
        h: Math.max(200, Math.floor(height))
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 30fps rAF ticker:用 setState 触发重绘,避免 applyFrame 风暴
  const [, setTick] = useState(0)
  useEffect(() => {
    let raf = 0
    let acc = 0
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = now - last
      last = now
      acc += dt
      // ~33ms 一帧
      if (acc >= 33) {
        acc = 0
        setTick((t) => (t + 1) % 1_000_000)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const padding = { top: 12, right: 16, bottom: 24, left: 80 }
  const innerW = Math.max(1, size.w - padding.left - padding.right)
  const innerH = Math.max(1, size.h - padding.top - padding.bottom)
  const centerY = padding.top + innerH / 2
  const spanT = n * ts

  // bias 是工程值偏移,默认 0 表示零线在图表中心,无需首次自动设置
  // (无 buf 的通道自动被 enabledRows filter 排除,不需要单独处理)

  const enabledRows = channels
    .map((c, i) => ({ ch: c, idx: i, buf: buffers[i] }))
    .filter((r) => r.ch.enabled && r.buf)

  const xScale = (i: number): number =>
    padding.left + (i / Math.max(1, n - 1)) * innerW

  const yScale = (ch: ChannelCfg) => (v: number): number =>
    centerY - (ch.bias + v / ch.yRange) * (innerH / 5)

  const hLines = [0, 0.2, 0.4, 0.6, 0.8, 1].map(
    (t) => padding.top + t * innerH
  )
  const vLines = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map(
    (t) => padding.left + t * innerW
  )

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-hidden bg-bg-base"
    >
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        style={{ display: 'block' }}
      >
        {/* 背景 */}
        <rect
          x={padding.left}
          y={padding.top}
          width={innerW}
          height={innerH}
          fill={SUBPLOT_BG}
          stroke={GRID_COLOR}
          strokeWidth={1}
        />

        {/* 横向网格(中线与其他一致) */}
        {hLines.map((y, i) => (
          <line
            key={`h${i}`}
            x1={padding.left}
            x2={padding.left + innerW}
            y1={y}
            y2={y}
            stroke={GRID_COLOR}
            strokeWidth={0.4}
            strokeDasharray={i === 2 ? undefined : '2 3'}
          />
        ))}
        {/* 纵向网格 */}
        {vLines.map((x, i) => (
          <line
            key={`v${i}`}
            x1={x}
            x2={x}
            y1={padding.top}
            y2={padding.top + innerH}
            stroke={GRID_COLOR}
            strokeWidth={0.4}
            strokeDasharray="2 3"
          />
        ))}

        {/* 各通道曲线 + 零线 */}
        {enabledRows.map(({ ch, idx, buf }) => {
          const yScaleFn = yScale(ch)
          const start = n - Math.max(1, filled)
          let d = ''
          let started = false
          for (let i = start; i < n; i++) {
            const x = xScale(i)
            const y = yScaleFn(buf![i])
            d += `${started ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `
            started = true
          }
          const color = ch.colorOverride ?? autoColor(idx)
          return (
            <g key={idx}>
              {filled > 1 && (
                <path d={d} stroke={color} strokeWidth={1.25} fill="none" />
              )}
              {/* 零点标记:加粗虚线 + 通道名标签(scope 画面外侧) */}
              <ZeroMarker
                zeroY={centerY - ch.bias * (innerH / 5)}
                xLeft={padding.left}
                xMax={padding.left + innerW}
                yMin={padding.top}
                yMax={padding.top + innerH}
                color={color}
                label={`CH${idx + 1}`}
              />
            </g>
          )
        })}

        {/* Y 轴极简 label(取第一个 enabled 通道的 yRange,半屏 = 2.5 div) */}
        {enabledRows[0] && (
          <>
            <text
              x={padding.left - 6}
              y={padding.top + 4}
              textAnchor="end"
              fontSize={9}
              fill={AXIS_COLOR}
            >
              {`+${(2.5 * enabledRows[0].ch.yRange).toFixed(1)}${
                enabledRows[0].ch.unit ? ' ' + enabledRows[0].ch.unit : ''
              }`}
            </text>
            <text
              x={padding.left - 6}
              y={padding.top + innerH - 2}
              textAnchor="end"
              fontSize={9}
              fill={AXIS_COLOR}
            >
              {`−${(2.5 * enabledRows[0].ch.yRange).toFixed(1)}${
                enabledRows[0].ch.unit ? ' ' + enabledRows[0].ch.unit : ''
              }`}
            </text>
          </>
        )}

        {/* 时间轴 label */}
        <text
          x={padding.left + innerW / 2}
          y={padding.top + innerH + 18}
          textAnchor="middle"
          fontSize={10}
          fill={AXIS_COLOR}
        >
          {`time (${spanUnit}) · span = ${spanT.toExponential(2)} s`}
        </text>

        {/* 暂停指示 */}
        {paused && (
          <text
            x={padding.left + innerW - 4}
            y={padding.top + 14}
            textAnchor="end"
            fontSize={11}
            fill="rgb(248, 81, 73)"
          >
            ⏸ PAUSED
          </text>
        )}

        {/* 右上角图例 */}
        <LegendOverlay
          channels={channels}
          buffers={buffers}
          filled={filled}
          n={n}
          x={padding.left + innerW - 8}
          y={padding.top + 6}
        />
      </svg>
    </div>
  )
}

interface LegendProps {
  channels: ChannelCfg[]
  buffers: Float32Array[]
  filled: number
  n: number
  x: number
  y: number
}

function LegendOverlay(p: LegendProps): JSX.Element {
  const { channels, buffers, filled, n, x, y } = p
  const enabled = channels
    .map((c, i) => ({ c, i, buf: buffers[i] }))
    .filter((r) => r.c.enabled && r.buf)
  if (enabled.length === 0) return <g />
  const lineH = 14
  const width = 150
  const total = enabled.length * lineH + 10
  const xLeft = x - width

  return (
    <g>
      <rect
        x={xLeft}
        y={y - 6}
        width={width}
        height={total}
        fill="rgba(13,17,23,0.85)"
        stroke={GRID_COLOR}
        rx={4}
      />
      {enabled.map(({ c, i, buf }, k) => {
        const lastIdx = n - 1
        const v = filled > 0 ? buf![lastIdx] : Number.NaN
        const color = c.colorOverride ?? autoColor(i)
        const label = c.label || c.name
        return (
          <g
            key={i}
            transform={`translate(${xLeft + 6}, ${y + lineH * k + 4})`}
          >
            <rect width={8} height={2} y={5} fill={color} />
            <text x={14} y={9} fontSize={10} fill="#e6edf3">
              {label.length > 14 ? label.slice(0, 13) + '…' : label}
            </text>
            <text
              x={width - 6}
              y={9}
              fontSize={10}
              textAnchor="end"
              fill="#7d8590"
              fontFamily="ui-monospace,monospace"
            >
              {Number.isFinite(v) ? fmtNum(v) : '—'}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1000) return v.toExponential(1)
  if (abs >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

interface ZeroMarkerProps {
  zeroY: number
  xLeft: number
  xMax: number
  yMin: number
  yMax: number
  color: string
  label: string
}

/** 零点标记:
 *  - 加粗虚线横跨 innerW,代表该通道的 bias 当前位置
 *  - 通道名标签画在 scope 画面外侧(padding.left 区域),与零线同 Y
 */
function ZeroMarker(p: ZeroMarkerProps): JSX.Element | null {
  const { zeroY, xLeft, xMax, yMin, yMax, color, label } = p
  if (zeroY < yMin || zeroY > yMax) return null
  return (
    <g pointerEvents="none">
      <line
        x1={xLeft}
        x2={xMax}
        y1={zeroY}
        y2={zeroY}
        stroke={color}
        strokeOpacity={0.7}
        strokeDasharray="4 3"
        strokeWidth={1.5}
      />
      <text
        x={xLeft - 8}
        y={zeroY + 3.5}
        fontSize={11}
        fill={color}
        textAnchor="end"
        fontWeight={600}
        fontFamily="ui-monospace,monospace"
      >
        {label}
      </text>
    </g>
  )
}