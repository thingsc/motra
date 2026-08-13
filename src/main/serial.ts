// 主进程串口管理。
// 仿 ref/mcb_host/serial_link.py 的 SerialLink:用 Node serialport 在主进程跑,
// 内部串行循环里 ser.read() → FrameAssembler.feed() → emit('frame', decoded) 。
// 原始字节同时 emit('bytes') 给 scope 窗口的 HEX 视图用。

import { EventEmitter } from 'node:events'
import { SerialPort } from 'serialport'
import {
  DEFAULT_FRAME,
  DEFAULT_RX_CHANNELS,
  DEFAULT_TX_FIELDS,
  FrameAssembler,
  encodeCommand,
  type FrameCfg,
  type RxChannel,
  type SerialCfg,
  type TxField
} from '../shared/scope'

export interface SerialPortInfo {
  path: string
  friendlyName?: string
}

export interface SerialStatus {
  isOpen: boolean
  port: string
  baud: number
  bytesIn: number
  framesIn: number
  dropped: number
  error: string | null
}

export interface SerialManagerEvents {
  frame: [Float64Array] // 解码后的工程值数组(行优先 n_pairs × n_channels)
  bytes: [Uint8Array] // 原始字节流(HEX 视图用)
  status: [SerialStatus]
}

/**
 * 全局单例:scope 窗口只有一个串口连接,无需多实例。
 * 内部用 EventEmitter 把 decoded frame / raw bytes / status 事件推给 scope 窗口。
 */
export class SerialManager extends EventEmitter<SerialManagerEvents> {
  private port: SerialPort | null = null
  private assembler: FrameAssembler | null = null
  private channels: RxChannel[] = DEFAULT_RX_CHANNELS
  private txFields: TxField[] = DEFAULT_TX_FIELDS
  private frameCfg: FrameCfg = DEFAULT_FRAME

  bytesIn = 0
  framesIn = 0

  /** 列出系统串口(macOS / Linux: /dev/tty.* / Windows: COM*) */
  static async listPorts(): Promise<SerialPortInfo[]> {
    const infos = await SerialPort.list()
    const out = infos.map((p) => ({
      path: p.path,
      friendlyName: p.friendlyName ?? undefined
    }))
    // Smoke helper: 当 /tmp/scope-smoke-ptyB 存在时,追加到列表首位
    // (serialport.list() 不识别 PTY symlink,smoke 链路必须手动可见)
    try {
      const fs = require('fs') as typeof import('fs')
      if (fs.existsSync('/tmp/scope-smoke-ptyB')) {
        out.unshift({ path: '/tmp/scope-smoke-ptyB', friendlyName: '🧪 smoke loopback (mock_target)' })
      }
    } catch {}
    return out
  }

  /**
   * 打开串口。
   * cfg 必填;channels / txFields / frameCfg 可选,默认用 mcb_host 默认值。
   * 同一个实例重复 open 会先 close 再 open。
   */
  async open(
    cfg: SerialCfg,
    opts?: { channels?: RxChannel[]; txFields?: TxField[]; frameCfg?: FrameCfg }
  ): Promise<void> {
    if (this.port) this.close()

    this.channels = opts?.channels ?? DEFAULT_RX_CHANNELS
    this.txFields = opts?.txFields ?? DEFAULT_TX_FIELDS
    this.frameCfg = opts?.frameCfg ?? DEFAULT_FRAME
    this.assembler = new FrameAssembler(this.channels, this.frameCfg)
    this.bytesIn = 0
    this.framesIn = 0

    this.port = new SerialPort({
      path: cfg.port,
      baudRate: cfg.baud,
      dataBits: cfg.bytesize,
      parity: cfg.parity,
      stopBits: cfg.stopbits,
      autoOpen: false
    })

    return new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        this.port?.off('error', onErr)
        this.emitStatus()
        // Smoke trace: open 成功时记录到文件
        if (process.env.MOTRA_SCOPE_DEMO === '1') {
          try {
            require('fs').appendFileSync('/tmp/scope-trace.log',
              `[${new Date().toISOString()}] open OK port=${cfg.port} baud=${cfg.baud}\n`)
          } catch {}
        }
        resolve()
      }
      const onErr = (err: Error): void => {
        this.port?.off('open', onOpen)
        if (process.env.MOTRA_SCOPE_DEMO === '1') {
          try {
            require('fs').appendFileSync('/tmp/scope-trace.log',
              `[${new Date().toISOString()}] open FAIL port=${cfg.port} err=${err.message}\n`)
          } catch {}
        }
        reject(err)
      }
      this.port!.once('open', onOpen)
      this.port!.once('error', onErr)
      this.port!.open()
    })
  }

  close(): void {
    if (this.port) {
      try {
        this.port.close()
      } catch {
        // 关闭失败时静默 — 通常是因为已经处于 closed 状态
      }
      this.port = null
    }
    this.assembler = null
    this.emitStatus()
  }

  get isOpen(): boolean {
    return !!this.port?.isOpen
  }

  /** 发送命令帧(直接 write bytes,不回读) */
  sendCommand(values: number[]): Uint8Array {
    const payload = encodeCommand(values, this.txFields)
    if (this.port?.isOpen) {
      this.port.write(payload)
    }
    return payload
  }

  /** 暴露给 IPC 用的 status 快照 */
  getStatus(port = this.port?.path ?? '', baud = this.port?.baudRate ?? 0): SerialStatus {
    return {
      isOpen: this.isOpen,
      port,
      baud,
      bytesIn: this.bytesIn,
      framesIn: this.framesIn,
      dropped: this.assembler?.dropped ?? 0,
      error: null
    }
  }

  /** 当前串口配置(channels / txFields),renderer 启动时拉一次、serial:open 完成后 push 一次 */
  getCfg(): { channels: RxChannel[]; txFields: TxField[] } {
    return { channels: this.channels, txFields: this.txFields }
  }

  /**
   * 主动 attach 数据监听。
   * 必须在 open() 之后由 ipc 层调用一次,否则 SerialPort 的 'data' 没人订阅。
   * 用 on('data') 而不是 readable stream,因为 serialport 是 EventEmitter。
   */
  attachDataListener(): void {
    if (!this.port) return
    this.port.on('data', (chunk: Buffer) => {
      const u8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      this.bytesIn += u8.length
      this.emit('bytes', u8)

      if (!this.assembler) return
      const frames = this.assembler.feed(u8)
      for (const f of frames) {
        this.framesIn++
        this.emit('frame', f)
      }
      this.emitStatus()
    })
    this.port.on('error', (err) => {
      // 不退出进程,只更新 status;渲染端可以决定如何显示
      this.emit('status', {
        ...this.getStatus(this.port?.path ?? '', this.port?.baudRate ?? 0),
        error: err.message
      })
    })
    this.port.on('close', () => this.emitStatus())
  }

  private emitStatus(): void {
    this.emit('status', {
      isOpen: this.isOpen,
      port: this.port?.path ?? '',
      baud: this.port?.baudRate ?? 0,
      bytesIn: this.bytesIn,
      framesIn: this.framesIn,
      dropped: this.assembler?.dropped ?? 0,
      error: null
    })
  }
}

/** 全局单例 */
export const serialManager = new SerialManager()
