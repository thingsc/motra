/**
 * Motra · 协议层 · 虚拟示波器
 *
 * TypeScript 移植自 `ref/mcb_host/protocol.py` + `ref/mcb_host/config.py`。
 * 与 mcb_host 字节级兼容,使得:
 *   - mcb_host/tools/mock_target.py 输出的帧能被本模块 FrameAssembler.feed 正确解码
 *   - 本模块 encodeCommand 输出的命令帧能被 mcb_host/serial_link.py 正确发送
 *
 * 设计原则:
 *   - 纯函数 + 一个状态机类;无 I/O,无副作用,易单测
 *   - 不依赖 Node / Electron,可被 main / renderer / verify 脚本三端共用
 *   - 数据布局尽量用 TypedArray,避免 GC 压力(30 fps × 600 samples × 多通道)
 */

/* ========================================================================== *
 * 类型
 * ========================================================================== */

export interface SerialCfg {
  /** 端口路径(Win: COM3 / macOS: /dev/tty.usbserial-* / Linux: /dev/ttyUSB0) */
  port: string
  /** 波特率;非标准速率如 5625000 也支持,driver 接受即可 */
  baud: number
  /** 数据位,固定 8 */
  bytesize: 8
  /** 校验位 */
  parity: 'N' | 'E' | 'O'
  /** 停止位 */
  stopbits: 1 | 2
  /** 单次读超时(秒) */
  timeout: number
}

export interface RxChannel {
  /** 通道名(显示用) */
  name: string
  /** 是否按 int16 重解释(raw 默认 uint16) */
  signed: boolean
  /** 工程值 = raw * scale + offset */
  scale: number
  offset: number
  /** 显示单位 */
  unit: string
}

export interface TxField {
  /** 字段名(显示用) */
  name: string
  /** struct 风格的类型描述:<'<' little-endian, 'h' int16 / 'H' uint16 */
  fmt: '<H' | '<h'
}

export interface FrameCfg {
  /** 帧起始标记(2 字节,palindromic 所以 endianness 无关) */
  start: Uint8Array
  /** 帧结束标记(2 字节) */
  end: Uint8Array
  /** 一帧内的"采样对"标称数量(对 = n_channels 个 uint16) */
  nominalPairs: number
  /** 允许的偏差(±) */
  pairTolerance: number
  /** 解码器缓冲上限(字节) */
  maxBuffer: number
}

/* ========================================================================== *
 * 默认常量 — 与 mcb_host/config.py 一一对应
 * ========================================================================== */

export const DEFAULT_FRAME: FrameCfg = {
  start: new Uint8Array([0x53, 0x53]), // 'SS'
  end: new Uint8Array([0x45, 0x45]), // 'EE'
  nominalPairs: 600,
  pairTolerance: 4,
  maxBuffer: 1 << 20
}

export const DEFAULT_RX_CHANNELS: RxChannel[] = [
  { name: 'Ia (ADC counts)', signed: false, scale: 1, offset: 0, unit: 'counts' },
  { name: 'Speed (RPM)', signed: true, scale: 1, offset: 0, unit: 'rpm' }
]

export const DEFAULT_TX_FIELDS: TxField[] = [
  { name: 'speed_rpm', fmt: '<H' },
  { name: 'motor_on', fmt: '<H' }
]

export const DEFAULT_SERIAL: SerialCfg = {
  port: '',
  baud: 1_500_000,
  bytesize: 8,
  parity: 'N',
  stopbits: 1,
  timeout: 0.05
}

/* ========================================================================== *
 * TX: encodeCommand
 * 对应 mcb_host/protocol.py:encode_command
 * ========================================================================== */

const FMT_BYTES: Record<string, number> = {
  '<H': 2,
  '<h': 2,
  '<I': 4,
  '<i': 4,
  '<B': 1,
  '<b': 1
}

/**
 * 把命令值打包为 outgoing 字节流。
 * 复刻 mcb_host 的 single → int16 → uint16(SI) 链路:
 *   1. 取整(rounded)
 *   2. 与字段宽度掩码(mask = 2^(8*size) - 1)按位与,实现 wrap-on-overflow
 *   3. 按 fmt little-endian pack
 */
export function encodeCommand(values: number[], fields: TxField[]): Uint8Array {
  if (values.length !== fields.length) {
    throw new Error(`encodeCommand: 期望 ${fields.length} 个值,得到 ${values.length}`)
  }
  const total = fields.reduce((n, f) => n + FMT_BYTES[f.fmt], 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0
  for (let i = 0; i < values.length; i++) {
    const f = fields[i]
    const size = FMT_BYTES[f.fmt]
    const mask = (1 << (8 * size)) - 1
    const word = Math.round(values[i]) & mask
    // fmt 形如 '<' + (h|H|i|I|b|B),后缀决定大小 + 有无符号
    const sig = f.fmt[2]
    const big = sig === 'H' || sig === 'I' // 大写无符号
    if (size === 2) {
      if (big) view.setUint16(offset, word, true)
      else view.setInt16(offset, word, true)
    } else if (size === 4) {
      if (big) view.setUint32(offset, word, true)
      else view.setInt32(offset, word, true)
    } else if (size === 1) {
      if (big) view.setUint8(offset, word)
      else view.setInt8(offset, word)
    } else {
      throw new Error(`unsupported fmt size: ${f.fmt}`)
    }
    offset += size
  }
  return out
}

/* ========================================================================== *
 * RX: decodePayload
 * 对应 mcb_host/protocol.py:decode_payload
 * ========================================================================== */

/**
 * 把一帧 payload 解码为 (n_pairs, n_channels) 的 Float64Array。
 *   payload 长度必须是 2 * n_channels 的整数倍
 */
export function decodePayload(payload: Uint8Array, channels: RxChannel[]): Float64Array {
  const nch = channels.length
  const stride = 2 * nch
  if (payload.length % stride !== 0) {
    throw new Error(
      `decodePayload: payload 长度 ${payload.length} 不是 ${stride}(=2*${nch}) 的整数倍`
    )
  }
  const pairs = payload.length / stride
  const out = new Float64Array(pairs * nch)
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  for (let p = 0; p < pairs; p++) {
    for (let c = 0; c < nch; c++) {
      const off = (p * nch + c) * 2
      const raw = view.getUint16(off, true)
      const ch = channels[c]
      const asSigned = ch.signed ? raw > 0x7fff ? raw - 0x10000 : raw : raw
      out[p * nch + c] = asSigned * ch.scale + ch.offset
    }
  }
  return out
}

/* ========================================================================== *
 * FrameAssembler — 字节流 → 帧的状态机
 * 对应 mcb_host/protocol.py:FrameAssembler
 * ========================================================================== */

export class FrameAssembler {
  readonly channels: RxChannel[]
  readonly frame: FrameCfg
  private _buf: number[] = []
  /** 被丢弃的非法帧累计数(诊断用) */
  dropped = 0

  constructor(channels: RxChannel[], frame: FrameCfg) {
    this.channels = channels
    this.frame = frame
  }

  /** 把字节追加到缓冲,返回这次新增的完整帧 */
  feed(chunk: Uint8Array): Float64Array[] {
    const frames: Float64Array[] = []
    if (chunk.length > 0) {
      for (let i = 0; i < chunk.length; i++) this._buf.push(chunk[i])
    }

    const start = this.frame.start
    const end = this.frame.end
    const stride = 2 * this.channels.length

    while (true) {
      // 找下一个 start marker
      const s = indexOfPattern(this._buf, start)
      if (s < 0) {
        // 没找到 start:仅保留可能的 start marker 末尾 tail
        if (this._buf.length > start.length) {
          this._buf.splice(0, this._buf.length - start.length)
        }
        break
      }

      // 把 start 之前的字节全丢
      if (s > 0) this._buf.splice(0, s)

      // 在 start 之后找 end
      const e = indexOfPattern(this._buf, end, start.length)
      if (e < 0) break // 帧不完整,等下一批字节

      const payload = new Uint8Array(this._buf.slice(start.length, e))
      if (this.payloadOk(payload, stride)) {
        frames.push(decodePayload(payload, this.channels))
        this._buf.splice(0, e + end.length) // 消费含 end
      } else {
        // 非法帧(比如数据字恰好等于 marker 字节):跳过这个 start,resync
        this.dropped++
        this._buf.splice(0, start.length)
      }

      // 缓冲爆:保留尾部,丢前面
      if (this._buf.length > this.frame.maxBuffer) {
        const keep = 2 * this.frame.nominalPairs * this.channels.length
        this._buf.splice(0, this._buf.length - Math.max(keep, 0))
      }
    }
    return frames
  }

  private payloadOk(payload: Uint8Array, stride: number): boolean {
    if (payload.length === 0 || payload.length % stride !== 0) return false
    const pairs = payload.length / stride
    const f = this.frame
    return Math.abs(pairs - f.nominalPairs) <= f.pairTolerance
  }

  /** 当前缓冲长度(诊断用) */
  get pendingBytes(): number {
    return this._buf.length
  }

  /** 清空内部缓冲 */
  reset(): void {
    this._buf = []
  }
}

/* ========================================================================== *
 * buildFrame — 测试 / mock 用的 frame 构造器
 * 对应 mcb_host/protocol.py:build_frame
 * ========================================================================== */

/**
 * 把 (n_pairs, n_channels) uint16 数组组装为完整帧。
 * samples 的内存布局必须是行优先、每个元素按 uint16 解释。
 */
export function buildFrame(samples: Uint16Array, frame: FrameCfg): Uint8Array {
  const body = new Uint8Array(samples.byteLength)
  new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength).forEach((b, i) => {
    body[i] = b
  })
  const out = new Uint8Array(frame.start.length + body.length + frame.end.length)
  out.set(frame.start, 0)
  out.set(body, frame.start.length)
  out.set(frame.end, frame.start.length + body.length)
  return out
}

/* ========================================================================== *
 * 工具:在一段字节里找一段字节(朴素 KMP,够小够快)
 * ========================================================================== */

function indexOfPattern(buf: number[], pat: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= buf.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) {
      if (buf[i + j] !== pat[j]) continue outer
    }
    return i
  }
  return -1
}