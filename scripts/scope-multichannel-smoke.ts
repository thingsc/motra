/**
 * 多通道 scope smoke harness:
 * 1. 打开 /tmp/scope-smoke-ptyB(由 socat 创建,与 mock_target 串接)
 * 2. 收 bytes → FrameAssembler.feed → decodePayload(工程值)
 * 3. 模拟 scopeStore.applyFrame 写入 2 通道 buffer
 * 4. 每 N 帧打印每通道 min/max/avg/last + 当前 bias/yRange 假设下的"y_pixel"
 * 5. 验证 2 通道数据流入正确(对应 Ia/Ib sin 曲线)
 *
 * 跑法:node --experimental-strip-types scripts/scope-multichannel-smoke.ts [duration_s]
 */
import { openSync, readSync } from 'node:fs'
import {
  FrameAssembler,
  DEFAULT_FRAME,
  DEFAULT_RX_CHANNELS,
  decodePayload
} from '../src/shared/scope.ts'

const PTY_PATH = '/tmp/scope-smoke-ptyB'
const DURATION_S = Number(process.argv[2] ?? 4)
const N = 6000
const PRINT_EVERY_FRAMES = 30

// 模拟 scopeStore
type Buf = Float32Array
const channels = [
  { name: 'Ia (ADC counts)', enabled: true, bias: 200, yRange: 100 },
  { name: 'Speed (RPM)', enabled: true, bias: 200, yRange: 100 }
] as const
const buffers: Buf[] = [new Float32Array(N), new Float32Array(N)]
let filled = 0
let totalFrames = 0

function applyFrame(payload: Float64Array, nChannels: number): void {
  const pairs = Math.floor(payload.length / nChannels)
  if (pairs === 0) return
  for (let c = 0; c < nChannels; c++) {
    const buf = buffers[c]
    if (pairs >= N) {
      for (let i = 0; i < N; i++) buf[i] = payload[(pairs - N + i) * nChannels + c]
    } else {
      buf.copyWithin(0, pairs)
      for (let i = 0; i < pairs; i++) buf[N - pairs + i] = payload[i * nChannels + c]
    }
  }
  filled = Math.min(N, filled + pairs)
}

function stats(buf: Float32Array): { min: number; max: number; avg: number; last: number } {
  const start = N - Math.max(1, filled)
  let mn = Infinity, mx = -Infinity, sum = 0
  for (let i = start; i < N; i++) {
    const v = buf[i]
    if (v < mn) mn = v
    if (v > mx) mx = v
    sum += v
  }
  return { min: mn, max: mx, avg: sum / Math.max(1, filled), last: buf[N - 1] }
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return v.toExponential(2)
  if (a >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

const fd = openSync(PTY_PATH, 'r')
const fa = new FrameAssembler(DEFAULT_RX_CHANNELS, DEFAULT_FRAME)
const t0 = Date.now()
let chunks = 0
let lastPrint = 0

console.log(`# scope-multichannel-smoke`)
console.log(`pty:        ${PTY_PATH}`)
console.log(`channels:   ${DEFAULT_RX_CHANNELS.length} (${DEFAULT_RX_CHANNELS.map((c) => c.name).join(', ')})`)
console.log(`duration:   ${DURATION_S}s`)
console.log(`---`)

// 打印原始 payload 第一帧的 raw uint16,验证 mock 端是否正确发出 Ia/Ib sin 数据
const dumpFirstFrame = (frame: Float64Array, nChannels: number): void => {
  const pairs = Math.floor(frame.length / nChannels)
  console.log(`# first decoded frame (${pairs} pairs × ${nChannels} ch, raw uint16-ish):`)
  for (let p = 0; p < Math.min(6, pairs); p++) {
    const parts: string[] = []
    for (let c = 0; c < nChannels; c++) parts.push(frame[p * nChannels + c].toFixed(0))
    console.log(`  pair[${p}]  ch0=${parts[0].padStart(6)}  ch1=${parts[1].padStart(6)}`)
  }
}

while ((Date.now() - t0) / 1000 < DURATION_S) {
  const chunk = Buffer.alloc(256)
  let n = 0
  try {
    n = readSync(fd, chunk, 0, chunk.length, null)
  } catch {
    break
  }
  if (n <= 0) continue
  chunks++
  const frames = fa.feed(new Uint8Array(chunk.buffer, chunk.byteOffset, n))
  for (const f of frames) {
    totalFrames++
    applyFrame(f, DEFAULT_RX_CHANNELS.length)
    if (totalFrames === 1) dumpFirstFrame(f, DEFAULT_RX_CHANNELS.length)
    if (totalFrames - lastPrint >= PRINT_EVERY_FRAMES) {
      lastPrint = totalFrames
      const rows = channels.map((ch, i) => {
        const s = stats(buffers[i])
        const yPx = ch.bias - (s.last / ch.yRange) * 400 // innerH = 400 占位
        return `  ${ch.name.padEnd(18)} min=${fmt(s.min).padStart(8)} max=${fmt(s.max).padStart(8)} avg=${fmt(s.avg).padStart(8)} last=${fmt(s.last).padStart(8)} → y_px≈${yPx.toFixed(1)}`
      })
      console.log(`[t=${((Date.now() - t0) / 1000).toFixed(1)}s frames=${totalFrames} filled=${filled}]`)
      console.log(rows.join('\n'))
    }
  }
}

console.log(`---`)
console.log(`# done: ${totalFrames} frames decoded, ${chunks} read iterations, filled=${filled}/${N}`)

// 退出前断言:两条通道都有合理波形
let ok = true
for (let i = 0; i < channels.length; i++) {
  const s = stats(buffers[i])
  const spread = s.max - s.min
  const mean = s.avg
  // Ia/Ib 在 2048±1500 范围,应能见到 ≥2000 的 spread
  const name = DEFAULT_RX_CHANNELS[i].name
  if (spread < 1000) {
    console.error(`FAIL: ${name} spread ${spread.toFixed(1)} < 1000 (no real waveform)`)
    ok = false
  }
  if (Math.abs(mean - 2048) > 200) {
    console.error(`WARN: ${name} mean ${mean.toFixed(1)} 偏离 2048 ±200 (mock 用 base=2048)`)
  } else {
    console.log(`OK:   ${name} spread=${spread.toFixed(1)} mean≈2048 ✓`)
  }
}

if (!ok) process.exit(1)