// 主进程运行时单例与依赖装配:
//
//   - 读 userData/settings.json 拿到 API key / baseURL / model
//   - 构造 AgentBackend(目前只支持 Anthropic SDK,DeepSeek 走同一份 SDK)
//   - 构造 SessionManager 并注入 backend
//   - 提供 sessionManager 单例给 ipc.ts / windows.ts 等使用
//
// 为什么不直接 sessions.ts 里 export 单例:
//   SessionManager 需要 backend 注入,而 backend 又依赖 settings 里的 api key,
//   只能在 app.whenReady() 后异步装配。所以单独建一个模块持有单例。

import { createAnthropicSdkBackend, type AgentBackend } from './agentBackend'
import { SessionManager } from './sessions'
import { loadSettings } from './persistence'

let _backend: AgentBackend | null = null
let _sessionManager: SessionManager | null = null

export async function initRuntime(): Promise<void> {
  if (_sessionManager) return // 幂等
  const settings = await loadSettings()
  const apiKey = settings.providerApiKey || process.env.DEEPSEEK_API_KEY || ''
  _backend = createAnthropicSdkBackend({
    apiKey,
    baseURL: settings.providerBaseURL || 'https://api.deepseek.com/anthropic',
    maxTokens: settings.providerMaxTokens || 4096
  })
  _sessionManager = new SessionManager(_backend)
}

export function getSessionManager(): SessionManager {
  if (!_sessionManager) {
    throw new Error('runtime not initialized; call initRuntime() in app.whenReady()')
  }
  return _sessionManager
}

export function getBackend(): AgentBackend {
  if (!_backend) {
    throw new Error('runtime not initialized; call initRuntime() in app.whenReady()')
  }
  return _backend
}

/** settings 改完后调用,重建 backend 让新 apiKey/baseURL 生效 */
export async function reloadBackend(): Promise<void> {
  const settings = await loadSettings()
  const apiKey = settings.providerApiKey || process.env.DEEPSEEK_API_KEY || ''
  _backend = createAnthropicSdkBackend({
    apiKey,
    baseURL: settings.providerBaseURL || 'https://api.deepseek.com/anthropic',
    maxTokens: settings.providerMaxTokens || 4096
  })
  if (_sessionManager) {
    _sessionManager.setBackend(_backend)
  }
}