// 跨进程共享类型:main / preload / renderer 共用。

import type { RxChannel, TxField } from './scope'

export type SessionStatus = 'idle' | 'running' | 'exited' | 'error'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  /** 流式期间标记,前端用来给一条消息追加内容 */
  streaming?: boolean
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  status: SessionStatus
  /** 启动该 session 用的 CLI 命令与参数,后续重启用于恢复 */
  cmd: string
  args: string[]
  cwd?: string
  messages: Message[]
  /** claude CLI 在 stream-json init event 里返回的 session-id,
   *  用来在 Restart 时通过 --resume 续接上下文。无值表示从未成功 init 过。 */
  claudeSessionId?: string
}

// 主进程→渲染进程的事件载荷
export type CliEvent =
  | { sessionId: string; type: 'started'; pid: number }
  | { sessionId: string; type: 'stdout'; chunk: string }
  | { sessionId: string; type: 'stderr'; chunk: string }
  /** stream-json 协议下一轮回复结束(result event),用来关闭 streaming 标记 + 清 inflight */
  | { sessionId: string; type: 'turn-end' }
  /** claude CLI init event 拿到 session-id,用来后续 --resume 接续上下文 */
  | { sessionId: string; type: 'session-init'; claudeSessionId: string }
  | {
      sessionId: string
      type: 'exit'
      code: number | null
      signal: NodeJS.Signals | null
    }
  | { sessionId: string; type: 'error'; message: string }
  /** 主进程落地了一条消息(user / system),通知前端 store 同步 */
  | { sessionId: string; type: 'message'; message: Message }

export interface StartCliOpts {
  cmd: string
  args?: string[]
  cwd?: string
  sessionId?: string
  /** 会话标题(可选,不传则自动生成) */
  title?: string
  /** claude 端的 session-id,提供则自动加 --resume 续接上下文 */
  resumeSessionId?: string
}

// preload api 形状,renderer 通过 window.api 拿到
export interface MotraApi {
  startCli: (opts: StartCliOpts) => Promise<Session>
  sendInput: (sessionId: string, text: string) => Promise<void>
  killCli: (sessionId: string) => Promise<void>
  listSessions: () => Promise<Session[]>
  deleteSession: (sessionId: string) => Promise<void>
  onCliEvent: (cb: (e: CliEvent) => void) => () => void
  /** scope 窗口相关(主窗口只有 openScope 一个入口,其余仅 scope 窗口内部使用) */
  openScope: () => Promise<void>
  serialList: () => Promise<SerialPortInfo[]>
  serialOpen: (cfg: SerialCfgWire) => Promise<void>
  serialClose: () => Promise<void>
  serialSend: (values: number[]) => Promise<void>
  serialGetCfg: () => Promise<{ channels: RxChannel[]; txFields: TxField[] }>
  onSerialEvent: (cb: (e: SerialEvent) => void) => () => void
  /** 拿到当前 SPA 的 host 路径信息,主要用于调试 */
  versions: {
    node: string
    electron: string
    chrome: string
  }
}

/* ========================================================================== *
 * 虚拟示波器(scope)扩展 — 与 cli:* 并行的第二条实时流
 *
 * 注:SerialCfg / FrameCfg / RxChannel / TxField 等具体定义在 ./scope.ts
 * 这里只放 preload 用的"事件载荷 / API 形状"以避免 types.ts 被 scope.ts 反向依赖
 * (renderer / main / preload 三端共用)。
 * ========================================================================== */

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

/**
 * 主进程 → scope 窗口的事件载荷。
 * 注意:frame 用 plain object 描述结构,实际数据通过 sharedArrayBuffer 风格的
 * transferable 或按帧传 number[](本 sub-step 走 number[] 简化路径)。
 */
export type SerialEvent =
  | { type: 'frame'; payload: number[]; nPairs: number; nChannels: number }
  | { type: 'bytes'; payload: number[] }
  | { type: 'cfg'; channels: RxChannel[]; txFields: TxField[] }
  | { type: 'status'; status: SerialStatus }

/** scope 窗口需要的 SerialCfg 形状(从 shared/scope 借,但避免深度耦合) */
export interface SerialCfgWire {
  port: string
  baud: number
  bytesize: 8
  parity: 'N' | 'E' | 'O'
  stopbits: 1 | 2
  timeout: number
}

/** scope 窗口需要的 TxField 形状 */
export interface TxFieldWire {
  name: string
  fmt: '<H' | '<h'
}
