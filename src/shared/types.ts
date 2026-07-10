// 跨进程共享类型:main / preload / renderer 共用。

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
  /** 拿到当前 SPA 的 host 路径信息,主要用于调试 */
  versions: {
    node: string
    electron: string
    chrome: string
  }
}
