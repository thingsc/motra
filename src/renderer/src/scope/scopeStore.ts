/**
 * Scope 窗口的状态管理(Zustand)
 *
 * 设计要点:
 *   - 每通道一个 Float32Array(N) 循环缓冲;N 默认 6000,可改
 *   - 收到 frame 时左移 + 追加;如果 frame 比 buffer 还大,只保留最后 N
 *   - 暂停时不更新画面,但仍消费事件(防止 IPC 队列爆)
 *   - HEX 视图用 Uint8Array(4096) 循环缓冲
 */

import { create } from 'zustand'
import type { RxChannel } from '@shared/scope'
import type { SerialCfgWire, SerialPortInfo, SerialStatus } from '@shared/types'

export const SAMPLE_TIME_S = 5e-5 // 与 mcb_host/config.py 一致
export const DISPLAY_SAMPLES = 6000
export const N_SAMPLES_MIN = 2
export const N_SAMPLES_MAX = 1_000_000
export const HEX_BUFFER_BYTES = 4096

/** 通道面板槽位数(常驻 UI 槽位,与物理通道数解耦) */
export const PANEL_CHANNEL_SLOTS = 8

/** 默认 Y 量程(屏幕高度对应的工程值跨度)。
 *  默认 4000 适配 12-bit ADC 原始 counts(0-4096);用户可逐通道调节。 */
export const DEFAULT_Y_RANGE = 4000

/** Bias 默认范围(div 偏移,相对屏幕中线)。
 *  bias = 0 → 零线在屏幕中线;±2.5 → 顶/底(满屏 5 div,半屏 = 2.5 div)。
 *  bias 单位是 "div",和 yRange(V/div)解耦 — 改 yRange 不会让零线漂。
 *  y_px = centerY - (bias + v / yRange) * (innerH / 5)
 *  per-channel 可覆盖(见 ChannelCfg.range.bias)。 */
export const BIAS_DIV_DEFAULT_MIN = -2.5
export const BIAS_DIV_DEFAULT_MAX = 2.5
export const BIAS_DIV_STEP = 0.01

/** V/div 默认范围(工程值 per div)。
 *  当前 slider 用对数轴:log10(min)..log10(max),step 0.05。
 *  per-channel 可覆盖(见 ChannelCfg.range.vdiv)。 */
export const VDIV_DEFAULT_MIN = 1e-3
export const VDIV_DEFAULT_MAX = 1e4

/** 单通道的 slider 范围覆盖;字段 undefined = 用默认。
 *  注意:范围存的是"用户感知"单位(div / 工程值),不是 slider index。 */
export interface ChannelRange {
  bias?: { min: number; max: number }
  vdiv?: { min: number; max: number }
}

/** localStorage 持久化 key */
const LS_CHANNELS_KEY = 'motra.scope.channels'
/** 持久化 schema 版本号;bias 语义从工程值改为 div 偏移时升 1,加 range 字段时升 2。 */
const LS_SCHEMA_VERSION = 3
const LS_SCHEMA_KEY = 'motra.scope.schemaVersion'

interface PersistedChannelView {
  enabled?: boolean
  bias?: number
  yRange?: number
  colorOverride?: string | null
  label?: string
  range?: ChannelRange
}

/** 自动调色板 — 与 tailwind.config.js / index.css 的 --scope-ch* 对齐 */
export const AUTO_PALETTE: readonly string[] = [
  '#58a6ff', // ch1 blue
  '#f0883e', // ch2 orange
  '#a371f7', // ch3 purple
  '#3fb950', // ch4 green
  '#f778ba', // ch5 pink
  '#ffd33d', // ch6 yellow
  '#76e3ea', // ch7 cyan
  '#e85a72', // ch8 red
] as const

export function autoColor(idx: number): string {
  return AUTO_PALETTE[idx % AUTO_PALETTE.length]
}

/** 一个通道 = 物理 Rx 字段 + 视图层用户态(可独立改动) */
export interface ChannelCfg {
  // 物理(由 main 镜像过来,只读)
  name: string
  signed: boolean
  scale: number
  offset: number
  unit: string

  // 视图(用户可调)
  /** 是否纳入当前画面渲染 */
  enabled: boolean
  /** 零线相对屏幕中线的偏移(div);0=中线,+2.5=顶,-2.5=底。
   *  和 yRange 解耦 — bias 改了波形就动多少 div,跟改 V/div 不会让零线漂。
   *  px = centerY - (bias + v / yRange) * (innerH / 5) */
  bias: number
  /** 单个 div 的工程值;屏幕总幅值 = 5 * yRange。 */
  yRange: number
  /** null = 用 auto 颜色(由 index 决定);非 null = 用户自定义 hex */
  colorOverride: string | null
  /** 用户自定义显示名;空字符串 = 回退到 name */
  label: string
  /** per-channel slider 范围覆盖;空字段 = 用默认(BIAS_DIV_DEFAULT_*, VDIV_DEFAULT_*)。
   *  bias 范围单位是 div,vdiv 范围单位是工程值(per div)。 */
  range: ChannelRange
}

export type SpanUnit = 'µs' | 'ms' | 's'

export interface ScopeState {
  // 串口连接
  ports: SerialPortInfo[]
  cfg: SerialCfgWire
  channels: ChannelCfg[]
  connected: boolean

  // 视图
  paused: boolean
  showHex: boolean

  // 采样配置(Ts / N / Span 联动)
  ts: number // sample period (s)
  n: number // points per screen
  span: number // span (in spanUnit)
  spanUnit: SpanUnit

  // 数据缓冲(每通道 Float32Array)
  buffers: Float32Array[]
  // 已填充的样本数(0..N)
  filled: number

  // 状态(来自 main process)
  status: SerialStatus
  errorMessage: string | null

  // HEX 循环缓冲
  hexBuf: Uint8Array
  hexFilled: number

  // TX
  txSpeedRpm: number
  txMotorOn: boolean

  // actions
  setPorts: (ports: SerialPortInfo[]) => void
  setCfg: (patch: Partial<SerialCfgWire>) => void
  setConnected: (b: boolean) => void
  setPaused: (b: boolean) => void
  setShowHex: (b: boolean) => void
  setTs: (ts: number) => void
  setN: (n: number) => void
  setSpan: (span: number, unit: SpanUnit) => void
  applyFrame: (payload: number[], nChannels: number) => void
  appendHex: (chunk: Uint8Array) => void
  setStatus: (status: SerialStatus) => void
  setErrorMessage: (msg: string | null) => void
  setTx: (speedRpm: number, motorOn: boolean) => void
  /** 从 main 同步物理通道配置(保留 view 字段) */
  syncChannelsFromMain: (physical: RxChannel[]) => void
  setChannelEnabled: (idx: number, enabled: boolean) => void
  setChannelBias: (idx: number, bias: number) => void
  setChannelYRange: (idx: number, yRange: number) => void
  setChannelColor: (idx: number, color: string | null) => void
  setChannelLabel: (idx: number, label: string) => void
  /** 设置单通道 slider 范围;null = 重置为默认。 */
  setChannelRange: (
    idx: number,
    kind: 'bias' | 'vdiv',
    range: { min: number; max: number } | null
  ) => void
  resetChannelColors: () => void
  resetBuffers: () => void
  /** 从 localStorage 恢复 view 字段(enabled/bias/yRange/colorOverride/label) */
  hydrateFromStorage: () => void
  /** 把当前 view 字段写入 localStorage */
  persistToStorage: () => void
}

function emptyBuffers(n: number, channels: number): Float32Array[] {
  return Array.from({ length: channels }, () => new Float32Array(n))
}

/** 取单通道生效的 bias 范围(div);未自定义 = 默认。 */
export function getEffectiveBiasRange(ch: ChannelCfg): { min: number; max: number } {
  return ch.range.bias ?? { min: BIAS_DIV_DEFAULT_MIN, max: BIAS_DIV_DEFAULT_MAX }
}

/** 取单通道生效的 V/div 范围(工程值 per div);未自定义 = 默认。 */
export function getEffectiveVdivRange(ch: ChannelCfg): { min: number; max: number } {
  return ch.range.vdiv ?? { min: VDIV_DEFAULT_MIN, max: VDIV_DEFAULT_MAX }
}

export const useScopeStore = create<ScopeState>((set, get) => ({
  ports: [],
  cfg: {
    port: '',
    baud: 1_500_000,
    bytesize: 8,
    parity: 'N',
    stopbits: 1,
    timeout: 0.05
  },
  channels: Array.from({ length: PANEL_CHANNEL_SLOTS }, (_, i) => ({
    name: i === 0 ? 'Ia (ADC counts)' : i === 1 ? 'Speed (RPM)' : `CH${i + 1}`,
    signed: false,
    scale: 1,
    offset: 0,
    unit: '',
    enabled: i < 2,
    bias: 0,
    yRange: DEFAULT_Y_RANGE,
    colorOverride: null,
    label: '',
    range: {}
  })),
  connected: false,
  paused: false,
  showHex: false,
  ts: SAMPLE_TIME_S,
  n: DISPLAY_SAMPLES,
  span: 0,
  spanUnit: 'ms',
  buffers: emptyBuffers(DISPLAY_SAMPLES, PANEL_CHANNEL_SLOTS),
  filled: 0,
  status: {
    isOpen: false,
    port: '',
    baud: 0,
    bytesIn: 0,
    framesIn: 0,
    dropped: 0,
    error: null
  },
  errorMessage: null,
  hexBuf: new Uint8Array(HEX_BUFFER_BYTES),
  hexFilled: 0,
  txSpeedRpm: 0,
  txMotorOn: false,

  setPorts: (ports) => {
    set({ ports })
    // 自动选第一个端口
    const cur = get().cfg
    if (!cur.port && ports.length > 0) {
      set({ cfg: { ...cur, port: ports[0].path } })
    }
  },
  setCfg: (patch) => set({ cfg: { ...get().cfg, ...patch } }),
  setConnected: (b) => set({ connected: b }),
  setPaused: (b) => set({ paused: b }),
  setShowHex: (b) => set({ showHex: b }),

  setTs: (ts) => {
    if (ts <= 0) return
    const n = get().n
    const t = n * ts
    const { label, factor } = pickSpanUnit(t)
    set({ ts, span: t * factor, spanUnit: label })
  },

  setN: (n) => {
    const clipped = Math.max(N_SAMPLES_MIN, Math.min(N_SAMPLES_MAX, Math.round(n)))
    const ts = get().ts
    const t = clipped * ts
    const { label, factor } = pickSpanUnit(t)
    set({
      n: clipped,
      buffers: emptyBuffers(clipped, get().channels.length),
      filled: 0,
      span: t * factor,
      spanUnit: label
    })
  },

  setSpan: (span, unit) => {
    const factor = unit === 'µs' ? 1e6 : unit === 'ms' ? 1e3 : 1
    const t = span / factor
    if (t <= 0) return
    const ts = get().ts
    const n = Math.max(
      N_SAMPLES_MIN,
      Math.min(N_SAMPLES_MAX, Math.round(t / ts))
    )
    const actualT = n * ts
    const { label, factor: f2 } = pickSpanUnit(actualT)
    set({
      n,
      buffers: emptyBuffers(n, get().channels.length),
      filled: 0,
      span: actualT * f2,
      spanUnit: label
    })
  },

  applyFrame: (payload, nChannels) => {
    if (get().paused) return // 暂停时不更新 buffer
    const n = get().n
    const pairs = Math.floor(payload.length / nChannels)
    if (pairs === 0) return
    const buffers = get().buffers
    // 如果缓冲长度与 channel 数不匹配,重建
    if (buffers.length !== nChannels) {
      set({ buffers: emptyBuffers(n, nChannels) })
      return
    }
    for (let c = 0; c < nChannels; c++) {
      const buf = buffers[c]
      if (pairs >= n) {
        // 新数据比 buffer 还长:只保留最后 n 个
        for (let i = 0; i < n; i++) {
          buf[i] = payload[(pairs - n + i) * nChannels + c]
        }
      } else {
        // 左移 + 追加
        buf.copyWithin(0, pairs)
        for (let i = 0; i < pairs; i++) {
          buf[n - pairs + i] = payload[i * nChannels + c]
        }
      }
    }
    set({ filled: Math.min(n, get().filled + pairs) })
  },

  appendHex: (chunk) => {
    const buf = get().hexBuf
    const filled = get().hexFilled
    if (chunk.length >= buf.length) {
      // chunk 比缓冲长:只保留 chunk 末尾 buf.length 个字节
      buf.set(chunk.subarray(chunk.length - buf.length), 0)
      set({ hexFilled: buf.length })
    } else if (filled + chunk.length <= buf.length) {
      buf.set(chunk, filled)
      set({ hexFilled: filled + chunk.length })
    } else {
      // 环绕:左移 + 追加
      const overflow = filled + chunk.length - buf.length
      buf.copyWithin(0, overflow)
      buf.set(chunk, buf.length - chunk.length)
      set({ hexFilled: buf.length })
    }
  },

  setStatus: (status) => set({ status }),
  setErrorMessage: (msg) => set({ errorMessage: msg }),
  setTx: (speedRpm, motorOn) => set({ txSpeedRpm: speedRpm, txMotorOn: motorOn }),

  syncChannelsFromMain: (physical) => {
    if (physical.length > PANEL_CHANNEL_SLOTS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[scope] 物理通道数 ${physical.length} 超过面板槽位数 ${PANEL_CHANNEL_SLOTS},已截断`
      )
    }
    const truncated = physical.slice(0, PANEL_CHANNEL_SLOTS)
    const old = get().channels
    const nextLen = Math.max(PANEL_CHANNEL_SLOTS, truncated.length)
    const next: ChannelCfg[] = Array.from({ length: nextLen }, (_, i) => {
      const phys = truncated[i]
      const oldRow = old[i]
      if (phys && oldRow) {
        // 物理字段来自 main;视图字段保留
        return {
          ...oldRow,
          name: phys.name,
          signed: phys.signed,
          scale: phys.scale,
          offset: phys.offset,
          unit: phys.unit
        }
      }
      if (phys) {
        // 新通道,默认 view
        return {
          name: phys.name,
          signed: phys.signed,
          scale: phys.scale,
          offset: phys.offset,
          unit: phys.unit,
          enabled: i < 2,
          bias: 0,
          yRange: DEFAULT_Y_RANGE,
          colorOverride: null,
          label: '',
          range: {}
        }
      }
      // 没有物理通道的 slot:保留旧 view,disabled
      return (
        oldRow ?? {
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
      )
    })
    const n = get().n
    set({ channels: next, buffers: emptyBuffers(n, nextLen), filled: 0 })
  },

  setChannelEnabled: (idx, enabled) => {
    const chs = get().channels.slice()
    if (!chs[idx]) return
    chs[idx] = { ...chs[idx], enabled }
    set({ channels: chs })
    schedulePersist(get)
  },

  setChannelBias: (idx, bias) => {
    if (!Number.isFinite(bias)) return
    const chs = get().channels.slice()
    if (!chs[idx]) return
    const r = getEffectiveBiasRange(chs[idx])
    const clipped = Math.max(r.min, Math.min(r.max, bias))
    chs[idx] = { ...chs[idx], bias: clipped }
    set({ channels: chs })
    schedulePersist(get)
  },

  setChannelYRange: (idx, yRange) => {
    if (!Number.isFinite(yRange) || yRange <= 0) return
    const chs = get().channels.slice()
    if (!chs[idx]) return
    const r = getEffectiveVdivRange(chs[idx])
    const clipped = Math.max(r.min, Math.min(r.max, yRange))
    chs[idx] = { ...chs[idx], yRange: clipped }
    set({ channels: chs })
    schedulePersist(get)
  },

  setChannelRange: (idx, kind, range) => {
    const chs = get().channels.slice()
    if (!chs[idx]) return
    let nextRange: { min: number; max: number } | undefined
    if (range !== null) {
      if (
        !Number.isFinite(range.min) ||
        !Number.isFinite(range.max) ||
        range.min >= range.max
      ) {
        return // 非法范围(min >= max 或非有限数)拒绝
      }
      nextRange = { min: range.min, max: range.max }
    }
    const newChannelRange: ChannelRange = { ...chs[idx].range }
    if (kind === 'bias') {
      if (nextRange) newChannelRange.bias = nextRange
      else delete newChannelRange.bias
    } else {
      if (nextRange) newChannelRange.vdiv = nextRange
      else delete newChannelRange.vdiv
    }
    // 改范围后,当前值要按新范围 clamp
    const ch: ChannelCfg = { ...chs[idx], range: newChannelRange }
    const biasR = getEffectiveBiasRange(ch)
    if (ch.bias < biasR.min) ch.bias = biasR.min
    else if (ch.bias > biasR.max) ch.bias = biasR.max
    const vdivR = getEffectiveVdivRange(ch)
    if (ch.yRange < vdivR.min) ch.yRange = vdivR.min
    else if (ch.yRange > vdivR.max) ch.yRange = vdivR.max
    chs[idx] = ch
    set({ channels: chs })
    schedulePersist(get)
  },

  setChannelColor: (idx, color) => {
    const chs = get().channels.slice()
    if (!chs[idx]) return
    chs[idx] = { ...chs[idx], colorOverride: color }
    set({ channels: chs })
    schedulePersist(get)
  },

  setChannelLabel: (idx, label) => {
    const chs = get().channels.slice()
    if (!chs[idx]) return
    chs[idx] = { ...chs[idx], label }
    set({ channels: chs })
    schedulePersist(get)
  },

  resetChannelColors: () => {
    const chs = get().channels.map((c) => ({ ...c, colorOverride: null }))
    set({ channels: chs })
    schedulePersist(get)
  },

  resetBuffers: () => {
    const n = get().n
    const c = get().channels.length
    set({ buffers: emptyBuffers(n, c), filled: 0, hexFilled: 0 })
  },

  hydrateFromStorage: () => {
    // schema 不匹配 → 旧值作废,清掉 channels 让默认值生效
    let storedVersion: number | null = null
    try {
      const v = localStorage.getItem(LS_SCHEMA_KEY)
      storedVersion = v === null ? null : Number(v)
    } catch {
      return // localStorage 不可用(隐私模式 / 异常)
    }
    if (storedVersion !== LS_SCHEMA_VERSION) {
      try {
        localStorage.removeItem(LS_CHANNELS_KEY)
      } catch {
        // 忽略
      }
      return
    }
    let raw: string | null = null
    try {
      raw = localStorage.getItem(LS_CHANNELS_KEY)
    } catch {
      return
    }
    if (!raw) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (!Array.isArray(parsed)) return
    const chs = get().channels.slice()
    for (let i = 0; i < chs.length && i < parsed.length; i++) {
      const p = parsed[i] as PersistedChannelView
      if (!p || typeof p !== 'object') continue
      // 解析 range 字段(逐个 kind 校验,非法丢弃)
      const range: ChannelRange = {}
      if (p.range && typeof p.range === 'object') {
        const b = p.range.bias
        if (
          b &&
          Number.isFinite(b.min) &&
          Number.isFinite(b.max) &&
          b.min < b.max
        ) {
          range.bias = { min: b.min, max: b.max }
        }
        const v = p.range.vdiv
        if (
          v &&
          Number.isFinite(v.min) &&
          Number.isFinite(v.max) &&
          v.min > 0 &&
          v.min < v.max
        ) {
          range.vdiv = { min: v.min, max: v.max }
        }
      }
      chs[i] = {
        ...chs[i],
        enabled: typeof p.enabled === 'boolean' ? p.enabled : chs[i].enabled,
        bias: Number.isFinite(p.bias) ? (p.bias as number) : chs[i].bias,
        yRange:
          Number.isFinite(p.yRange) && (p.yRange as number) > 0
            ? (p.yRange as number)
            : chs[i].yRange,
        colorOverride:
          typeof p.colorOverride === 'string' || p.colorOverride === null
            ? (p.colorOverride as string | null)
            : chs[i].colorOverride,
        label: typeof p.label === 'string' ? p.label : chs[i].label,
        range
      }
      // 按生效范围 clamp 恢复的值
      const biasR = getEffectiveBiasRange(chs[i])
      if (chs[i].bias < biasR.min) chs[i].bias = biasR.min
      else if (chs[i].bias > biasR.max) chs[i].bias = biasR.max
      const vdivR = getEffectiveVdivRange(chs[i])
      if (chs[i].yRange < vdivR.min) chs[i].yRange = vdivR.min
      else if (chs[i].yRange > vdivR.max) chs[i].yRange = vdivR.max
    }
    set({ channels: chs })
  },

  persistToStorage: () => {
    const data: PersistedChannelView[] = get().channels.map((c) => ({
      enabled: c.enabled,
      bias: c.bias,
      yRange: c.yRange,
      colorOverride: c.colorOverride,
      label: c.label,
      // 只持久化非默认的 range 覆盖,减小存储
      range:
        c.range.bias || c.range.vdiv
          ? {
              ...(c.range.bias ? { bias: c.range.bias } : {}),
              ...(c.range.vdiv ? { vdiv: c.range.vdiv } : {})
            }
          : undefined
    }))
    try {
      localStorage.setItem(LS_CHANNELS_KEY, JSON.stringify(data))
      localStorage.setItem(LS_SCHEMA_KEY, String(LS_SCHEMA_VERSION))
    } catch {
      // 忽略写入失败(quota / 隐私模式)
    }
  }
}))

/** 防抖:把多次 setter 调用合并为一次 localStorage 写入 */
let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(get: () => ScopeState): void {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    get().persistToStorage()
  }, 150)
}

function pickSpanUnit(t_s: number): { label: SpanUnit; factor: number } {
  if (t_s < 1e-3) return { label: 'µs', factor: 1e6 }
  if (t_s < 1.0) return { label: 'ms', factor: 1e3 }
  return { label: 's', factor: 1.0 }
}

/** 初始化 span = N * Ts */
export function initSpanFromState(): { span: number; unit: SpanUnit } {
  const s = useScopeStore.getState()
  const t = s.n * s.ts
  const { label, factor } = pickSpanUnit(t)
  return { span: t * factor, unit: label }
}