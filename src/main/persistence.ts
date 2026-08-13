// 持久化两件事:
//   1. sessions.json — 会话列表 + 消息历史(v1 = CLI 模式, v2 = SDK 模式)
//   2. settings.json — provider 配置(apiKey / baseURL / model / maxTokens)
//
// 路径都在 app.getPath('userData'),不进 git。

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppLanguage, AppPreferences, Session } from '../shared/types'
import { SESSIONS_FILE_VERSION } from '../shared/types'

// ──────────────────────────────────────────────────────────────
// sessions.json
// ──────────────────────────────────────────────────────────────

interface PersistShapeV2 {
  version: 2 | 3
  sessions: Session[]
}

interface PersistShapeV1 {
  version: 1
  sessions: Array<{
    id?: string
    title?: string
    createdAt?: number
    updatedAt?: number
    status?: Session['status']
    cmd?: string
    args?: string[]
    cwd?: string
    messages?: Session['messages']
    claudeSessionId?: string
  }>
}

let sessionsCache: Session[] | null = null
let sessionsPath: string | null = null
let sessionsReadFailed = false

function getSessionsPath(): string {
  if (sessionsPath) return sessionsPath
  const dir = app.getPath('userData')
  sessionsPath = path.join(dir, 'sessions.json')
  return sessionsPath
}

export async function loadSessions(): Promise<Session[]> {
  if (sessionsCache) return sessionsCache
  const fp = getSessionsPath()
  try {
    const raw = await fs.readFile(fp, 'utf8')
    const parsed = JSON.parse(raw) as PersistShapeV1 | PersistShapeV2
    if (parsed && Array.isArray(parsed.sessions)) {
      // v1 和 v2 都用同一个 normalizeSession 兼容
      sessionsCache = parsed.sessions.map(normalizeSession)
      sessionsReadFailed = false
      return sessionsCache
    }
    sessionsCache = []
    return sessionsCache
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') sessionsReadFailed = true
    sessionsCache = []
    return sessionsCache
  }
}

export async function saveSessions(sessions: Session[]): Promise<void> {
  if (sessionsReadFailed) {
    throw new Error('sessions.json could not be read; refusing to overwrite it')
  }
  sessionsCache = sessions
  const fp = getSessionsPath()
  const payload: PersistShapeV2 = { version: SESSIONS_FILE_VERSION, sessions }
  await fs.mkdir(path.dirname(fp), { recursive: true })
  // tmp 文件名 unique,避免并发 save 竞争
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await fs.rename(tmp, fp)
}

/**
 * 把磁盘对象规整成 v2 Session 形状。
 * 兼容 v1:丢弃 cmd/args/cwd/claudeSessionId,补齐 model/backend 字段。
 */
function normalizeSession(s: Partial<Session> & PersistShapeV1['sessions'][number]): Session {
  return {
    id: s.id ?? cryptoRandomId(),
    title: s.title ?? 'Untitled',
    createdAt: s.createdAt ?? Date.now(),
    updatedAt: s.updatedAt ?? s.createdAt ?? Date.now(),
    // v1 加载的 session 重启后默认 idle
    status: s.status ?? 'idle',
    // v1 没有 model 字段,默认 deepseek-chat(STEP 1 直连方案默认 provider)
    model: s.model ?? 'deepseek-chat',
    backend: 'sdk',
    messages: Array.isArray(s.messages) ? s.messages : [],
    workspacePath: typeof s.workspacePath === 'string' && s.workspacePath ? s.workspacePath : undefined,
    systemPrompt: typeof s.systemPrompt === 'string' ? s.systemPrompt : undefined
    // cmd/args/cwd/claudeSessionId 故意丢弃——已经不用 CLI 了
  }
}

export function cryptoRandomId(): string {
  return randomUUID()
}

// ──────────────────────────────────────────────────────────────
// settings.json — provider 配置
// ──────────────────────────────────────────────────────────────

export interface ProviderSettings {
  /** provider API key(DeepSeek / Anthropic 等共用 x-api-key) */
  providerApiKey?: string
  /** Anthropic-compatible baseURL,默认 DeepSeek */
  providerBaseURL?: string
  /** 默认模型,例如 'deepseek-chat' */
  providerModel?: string
  /** 单 Provider 下维护的本地模型名 */
  providerModels?: string[]
  /** 单轮 max_tokens */
  providerMaxTokens?: number
  /** 默认 system prompt */
  providerSystem?: string
  /** 主窗口语言与最近工作区属于应用偏好，但共用原子 settings 文件 */
  language?: AppLanguage
  languageConfigured?: boolean
  recentWorkspaces?: string[]
}

const DEFAULT_SETTINGS: Required<Omit<ProviderSettings, never>> = {
  providerApiKey: '',
  providerBaseURL: 'https://api.deepseek.com/anthropic',
  providerModel: 'deepseek-chat',
  providerModels: ['deepseek-chat', 'deepseek-reasoner'],
  providerMaxTokens: 4096,
  providerSystem: '',
  language: 'en',
  languageConfigured: false,
  recentWorkspaces: []
}

let settingsCache: ProviderSettings | null = null
let settingsPath: string | null = null

function getSettingsPath(): string {
  if (settingsPath) return settingsPath
  const dir = app.getPath('userData')
  settingsPath = path.join(dir, 'settings.json')
  return settingsPath
}

export async function loadSettings(): Promise<ProviderSettings> {
  if (settingsCache) return settingsCache
  const fp = getSettingsPath()
  try {
    const raw = await fs.readFile(fp, 'utf8')
    const parsed = JSON.parse(raw) as ProviderSettings
    settingsCache = normalizeSettings({ ...DEFAULT_SETTINGS, ...parsed })
    return settingsCache
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS }
    return settingsCache
  }
}

export async function saveSettings(patch: ProviderSettings): Promise<ProviderSettings> {
  const current = await loadSettings()
  settingsCache = normalizeSettings({ ...current, ...patch })
  const fp = getSettingsPath()
  await fs.mkdir(path.dirname(fp), { recursive: true })
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await fs.writeFile(tmp, JSON.stringify(settingsCache, null, 2), 'utf8')
  await fs.rename(tmp, fp)
  return settingsCache
}

export async function loadPreferences(): Promise<AppPreferences> {
  const settings = await loadSettings()
  return {
    language: settings.language === 'zh-CN' ? 'zh-CN' : 'en',
    recentWorkspaces: normalizeRecentWorkspaces(settings.recentWorkspaces)
  }
}

export async function savePreferences(patch: Partial<AppPreferences>): Promise<AppPreferences> {
  const next = await saveSettings({
    ...(patch.language ? { language: patch.language, languageConfigured: true } : {}),
    ...(patch.recentWorkspaces ? { recentWorkspaces: patch.recentWorkspaces } : {})
  })
  return {
    language: next.language === 'zh-CN' ? 'zh-CN' : 'en',
    recentWorkspaces: normalizeRecentWorkspaces(next.recentWorkspaces)
  }
}

function normalizeSettings(settings: ProviderSettings): ProviderSettings {
  const models = Array.from(new Set((settings.providerModels ?? [])
    .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    .map((model) => model.trim())))
  const fallback = settings.providerModel?.trim() || 'deepseek-chat'
  if (!models.includes(fallback)) models.unshift(fallback)
  return {
    ...settings,
    providerModel: fallback,
    providerModels: models,
    providerMaxTokens: Math.min(32768, Math.max(256, Number(settings.providerMaxTokens) || 4096)),
    language: settings.language === 'zh-CN' ? 'zh-CN' : 'en',
    recentWorkspaces: normalizeRecentWorkspaces(settings.recentWorkspaces)
  }
}

function normalizeRecentWorkspaces(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  return Array.from(new Set(paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))).slice(0, 5)
}

/** 测试用:把缓存清掉,下一次 load 重新读盘 */
export function __resetPersistenceForTest(): void {
  sessionsCache = null
  settingsCache = null
  sessionsReadFailed = false
}
