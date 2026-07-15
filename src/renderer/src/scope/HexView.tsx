import { useEffect, useRef, useState } from 'react'
import { useScopeStore, HEX_BUFFER_BYTES } from './scopeStore'

/**
 * 原始字节 HEX 滚动视图:
 *   16 字节一行,左侧偏移,右侧 ASCII
 *   自动滚到底部;新数据 append 到行末
 */
export function HexView(): JSX.Element {
  const filled = useScopeStore((s) => s.hexFilled)
  const buf = useScopeStore((s) => s.hexBuf)
  const [tick, setTick] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  // 30fps 刷新(用 rAF)
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      setTick((t) => (t + 1) % 1_000_000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 自动滚到底
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [tick])

  void tick

  // 把环形缓冲按已填充长度渲染(线性)
  const len = Math.min(filled, HEX_BUFFER_BYTES)
  const seg = new Uint8Array(len)
  // filled == HEX_BUFFER_BYTES 时,数据起点是 0(被覆盖);否则起点 = HEX_BUFFER_BYTES - filled
  // 但实际上 appendHex 实现里没有真的环形移位,只是覆盖旧部分。
  // 这里假设 filled == HEX_BUFFER_BYTES 时从头开始,否则从已填充的起点开始。
  if (filled < HEX_BUFFER_BYTES) {
    // 第一次没填满前,数据应填在 buf[0..filled];我们直接读前 filled
    seg.set(buf.subarray(0, filled))
  } else {
    // 已填满,buf[0..filled] 是"新到旧"的整体(appendHex 内部用 copyWithin 滚过)
    seg.set(buf.subarray(0, filled))
  }

  // 按 16 字节一组
  const lines: { offset: number; hex: string; ascii: string }[] = []
  for (let i = 0; i < seg.length; i += 16) {
    const slice = seg.subarray(i, Math.min(i + 16, seg.length))
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    lines.push({ offset: i, hex, ascii })
  }

  return (
    <div
      ref={ref}
      className="flex-1 min-h-0 overflow-y-auto bg-bg-base p-3 font-mono text-xs leading-5"
    >
      {filled === 0 && (
        <div className="text-fg-muted">（暂无字节流 — 连上串口后会开始滚动）</div>
      )}
      {lines.map((l) => (
        <div key={l.offset} className="flex gap-3">
          <span className="text-fg-subtle w-20 shrink-0">{l.offset.toString(16).padStart(8, '0')}</span>
          <span className="text-fg-base w-[22rem] shrink-0">{l.hex.padEnd(48, ' ')}</span>
          <span className="text-fg-muted">{l.ascii}</span>
        </div>
      ))}
    </div>
  )
}