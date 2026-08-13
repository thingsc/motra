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
  /** 该会话使用的模型,例如 'deepseek-chat' / 'deepseek-reasoner' / 'claude-sonnet-4-5' */
  model: string
  /** 后端标识,目前固定 'sdk'。未来如果加回 CLI 模式可扩展 */
  backend: 'sdk'
  /** messages 数组保持不变,由主进程维护,用于多轮上下文续接 */
  messages: Message[]
  /** 每任务独立绑定的本地工作区；为空时仍可普通聊天 */
  workspacePath?: string
  /** 创建任务时冻结的 system prompt */
  systemPrompt?: string
  /** 兼容字段:v1 sessions.json 里可能有这些,新 session 不再写 */
  cmd?: string
  args?: string[]
  cwd?: string
  claudeSessionId?: string
}

/** 持久化文件 schema 版本号。v1 = CLI 子进程模式;v2 = SDK 直连 provider */
export const SESSIONS_FILE_VERSION = 3 as const

export type AppLanguage = 'zh-CN' | 'en'

/** renderer 端可见的 settings 形状。apiKey 字段已脱敏(只表示"是否已配置") */
export interface ProviderSettingsView {
  providerApiKey: string
  providerBaseURL: string
  providerModel: string
  providerModels: string[]
  providerMaxTokens: number
  providerSystem: string
}

export interface AppPreferences {
  language: AppLanguage
  recentWorkspaces: string[]
}

export type ProviderSettingsPatch = Partial<ProviderSettingsView>
export type AppPreferencesPatch = Partial<AppPreferences>

export interface GitWorkspaceStatus {
  isRepository: boolean
  branch: string | null
  dirty: boolean
  error?: string
}

export interface TaskContextPatch {
  model?: string
  workspacePath?: string | null
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
  /** 模型名(必填)。例如 'deepseek-chat' / 'claude-sonnet-4-5' */
  model: string
  /** 会话 id(可选,不传则自动生成) */
  sessionId?: string
  /** 会话标题(可选,不传则自动生成) */
  title?: string
  /** system prompt(可选) */
  system?: string
  workspacePath?: string
}

// preload api 形状,renderer 通过 window.api 拿到
export interface MotraApi {
  startCli: (opts: StartCliOpts) => Promise<Session>
  sendInput: (sessionId: string, text: string) => Promise<void>
  killCli: (sessionId: string) => Promise<void>
  listSessions: () => Promise<Session[]>
  deleteSession: (sessionId: string) => Promise<void>
  renameTask: (sessionId: string, title: string) => Promise<Session>
  updateTaskContext: (sessionId: string, patch: TaskContextPatch) => Promise<Session>
  onCliEvent: (cb: (e: CliEvent) => void) => () => void
  /** 读 provider 配置(apiKey 字段只返回是否已配置,不回明文) */
  getSettings: () => Promise<ProviderSettingsView>
  /** 写 provider 配置。写完自动重建 backend */
  setSettings: (patch: ProviderSettingsPatch) => Promise<ProviderSettingsView>
  getPreferences: () => Promise<AppPreferences>
  setPreferences: (patch: AppPreferencesPatch) => Promise<AppPreferences>
  selectWorkspace: () => Promise<string | null>
  getGitStatus: (workspacePath: string) => Promise<GitWorkspaceStatus>
  /** scope 窗口相关(主窗口只有 openScope 一个入口,其余仅 scope 窗口内部使用) */
  openScope: () => Promise<void>
  getScopeStatus: () => Promise<SerialStatus>
  onScopeStatus: (cb: (status: SerialStatus) => void) => () => void
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
