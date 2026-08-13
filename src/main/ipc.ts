// IPC 处理器注册。
//
// 与 v1 (CLI 模式) 的差异:
//   - SessionManager 从 runtime.ts 取,而不是 sessions.ts 的单例(backend 注入)
//   - cli:start 入参改成 StartCliOpts v2(model / system / sessionId / title)
//   - 新增 settings:get / settings:set(用户改 API key / model / baseURL 时用)
//   - 移除 cli:input 的"自动 Restart"逻辑:旧版是为了 spawn 进程死掉后复活,
//     SDK 模式下没有进程,sendInput 直接报错给前端即可

import { ipcMain, BrowserWindow, dialog, app, type OpenDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getSessionManager } from './runtime'
import { serialManager, SerialManager } from './serial'
import { openScopeWindow, getScopeWindow } from './windows'
import {
  loadSessions,
  saveSessions,
  loadSettings,
  saveSettings,
  loadPreferences,
  savePreferences,
  type ProviderSettings
} from './persistence'
import { reloadBackend } from './runtime'
import type {
  Session,
  StartCliOpts,
  Message,
  SerialCfgWire,
  SerialEvent,
  SerialPortInfo,
  ProviderSettingsView
} from '../shared/types'

const execFileAsync = promisify(execFile)

// 内存中的 session 列表(对应磁盘 sessions.json 的当前视图)
const sessions = new Map<string, Session>()

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  const sessionManager = getSessionManager()

  // 把 sessionManager 的事件转发到所有渲染窗口
  sessionManager.on('cli:event', (e) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('cli:event', e)
    }
    // 同步状态到内存中的 session
    const s = sessions.get(e.sessionId)
    if (!s) return
    if (e.type === 'started') s.status = 'idle'
    if (e.type === 'stdout' || e.type === 'stderr') {
      // sessionManager 内部已经把流式文本写进 s.messages,这里不需要再 appendAssistant
      // 只需要更新时间戳
      s.updatedAt = Date.now()
    }
    if (e.type === 'turn-end') {
      s.status = 'idle'
      s.updatedAt = Date.now()
    }
    if (e.type === 'exit') {
      s.status = e.code === 0 ? 'idle' : 'error'
      s.updatedAt = Date.now()
    }
    if (e.type === 'error') {
      s.status = 'error'
    }
    void persist().catch((err) => console.error('[ipc] persist failed:', err))
  })

  ipcMain.handle('cli:start', async (_evt, opts: StartCliOpts) => {
    const session = await sessionManager.start(opts)
    const old = sessions.get(session.id)
    if (old) {
      // 保留老 messages(用户在 v1 → v2 迁移后能继续看到历史)
      if (old.messages.length > 0) session.messages = [...old.messages]
    }
    sessions.set(session.id, session)
    await persist()
    return session
  })

  ipcMain.handle('cli:input', async (_evt, sessionId: string, text: string) => {
    let s = sessions.get(sessionId)
    if (!s) {
      // 重启场景:内存 sessions map 没了,但磁盘 sessions.json 还在。
      // 从磁盘 reload,把 session 装回内存,并在 sessionManager 里 start 重建(只是
      // 占位,不发起任何请求),把 messages 历史同步过去,这样多轮上下文能续上。
      const disk = await loadSessions()
      const found = disk.find((x) => x.id === sessionId)
      if (!found) {
        throw new Error(`session ${sessionId} not found`)
      }
      const rebuilt = await sessionManager.start({
        sessionId: found.id,
        model: found.model,
        title: found.title,
        system: found.systemPrompt,
        workspacePath: found.workspacePath
      })
      rebuilt.messages = [...found.messages]
      sessions.set(rebuilt.id, rebuilt)
      s = rebuilt
    }
    // sessionManager.sendInput 内部会 push user 消息 + 触发流式回复
    sessionManager.sendInput(sessionId, text)
    await persist()
  })

  ipcMain.handle('cli:kill', async (_evt, sessionId: string) => {
    sessionManager.kill(sessionId)
    const s = sessions.get(sessionId)
    if (s) {
      s.status = 'idle'
      await persist()
    }
  })

  ipcMain.handle('cli:list', async () => {
    return await loadSessions()
  })

  ipcMain.handle('cli:delete', async (_evt, sessionId: string) => {
    sessions.delete(sessionId)
    const list = await loadSessions()
    const next = list.filter((s) => s.id !== sessionId)
    await saveSessions(next)
  })

  ipcMain.handle('task:rename', async (_evt, sessionId: string, title: string) => {
    const normalized = requireNonEmptyString(title, 'title')
    const session = sessionManager.rename(requireNonEmptyString(sessionId, 'sessionId'), normalized)
    sessions.set(session.id, session)
    await persist()
    return session
  })

  ipcMain.handle('task:updateContext', async (_evt, sessionId: string, patch: { model?: string; workspacePath?: string | null }) => {
    requireNonEmptyString(sessionId, 'sessionId')
    if (!patch || typeof patch !== 'object') throw new Error('invalid context patch')
    if (patch.model !== undefined) requireNonEmptyString(patch.model, 'model')
    if (patch.workspacePath) await assertDirectory(patch.workspacePath)
    const session = sessionManager.updateContext(sessionId, patch)
    sessions.set(session.id, session)
    await persist()
    return session
  })

  // 首次启动时,把磁盘的 session 装入内存
  // 同时也要塞进 SessionManager 内部 map,否则用户重启 app 后点开历史 session
  // 直接续聊会撞到 "session not found"(前端 IPC map 有,但 SessionManager.sessions 空着)
  void (async () => {
    const list = await loadSessions()
    const mgr = getSessionManager()
    for (const found of list) {
      const s = await mgr.start({
        sessionId: found.id,
        model: found.model,
        title: found.title,
        system: found.systemPrompt,
        workspacePath: found.workspacePath
      })
      // start() 创建的 session 是空 messages,这里把历史灌回去,这样 sendInput
      // 时 backend 能拿到完整多轮上下文
      s.messages = [...found.messages]
      sessions.set(s.id, s)
    }
  })()

  // ────────────────────────────────────────────────────────────────
  // settings 通道 — 用户改 API key / baseURL / model 时调用
  // ────────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', async (): Promise<ProviderSettingsView> => {
    // 不返回 providerApiKey 完整值(防 XSS / log 泄漏),只返回"是否已设置"
    const s = await loadSettings()
    return {
      providerApiKey: s.providerApiKey ? '••••configured' : '',
      providerBaseURL: s.providerBaseURL ?? 'https://api.deepseek.com/anthropic',
      providerModel: s.providerModel ?? 'deepseek-chat',
      providerModels: s.providerModels ?? ['deepseek-chat', 'deepseek-reasoner'],
      providerMaxTokens: s.providerMaxTokens ?? 4096,
      providerSystem: s.providerSystem ?? ''
    }
  })

  ipcMain.handle('settings:set', async (_evt, patch: Partial<ProviderSettingsView>) => {
    // patch.providerApiKey 是脱敏后的值:
    //   - '__keep__' → 不更新 key 字段(用户没改 key,保留旧值)
    //   - ''         → 清空 key
    //   - 其他        → 当真实 key 写入
    const sanitized: ProviderSettings = { ...patch }
    if (patch.providerApiKey === '__keep__') {
      delete sanitized.providerApiKey
    } else if (patch.providerApiKey === '') {
      sanitized.providerApiKey = ''
    }
    // 其他情况直接写入(用户填了真实 key)
    const next = await saveSettings(sanitized)
    // 重建 backend 让新配置生效
    await reloadBackend()
    // 返回脱敏 view 给前端
    return {
      providerApiKey: next.providerApiKey ? '••••configured' : '',
      providerBaseURL: next.providerBaseURL ?? 'https://api.deepseek.com/anthropic',
      providerModel: next.providerModel ?? 'deepseek-chat',
      providerModels: next.providerModels ?? ['deepseek-chat'],
      providerMaxTokens: next.providerMaxTokens ?? 4096,
      providerSystem: next.providerSystem ?? ''
    }
  })

  ipcMain.handle('preferences:get', async () => {
    const settings = await loadSettings()
    const preferences = await loadPreferences()
    if (!settings.languageConfigured) {
      preferences.language = app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
    }
    return preferences
  })
  ipcMain.handle('preferences:set', async (_evt, patch) => savePreferences(patch ?? {}))

  ipcMain.handle('workspace:select', async () => {
    const win = getMainWindow()
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const selected = result.filePaths[0]
    await assertDirectory(selected)
    const preferences = await loadPreferences()
    await savePreferences({ recentWorkspaces: [selected, ...preferences.recentWorkspaces.filter((p) => p !== selected)].slice(0, 5) })
    return selected
  })

  ipcMain.handle('workspace:getGitStatus', async (_evt, workspacePath: string) => {
    const directory = requireNonEmptyString(workspacePath, 'workspacePath')
    await assertDirectory(directory)
    try {
      const top = await execGit(directory, ['rev-parse', '--show-toplevel'])
      if (!top.trim()) return { isRepository: false, branch: null, dirty: false }
      const branch = (await execGit(directory, ['branch', '--show-current'])).trim() || null
      const dirty = (await execGit(directory, ['status', '--porcelain', '--untracked-files=normal'])).trim().length > 0
      return { isRepository: true, branch, dirty }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/not a git repository/i.test(message)) return { isRepository: false, branch: null, dirty: false }
      return { isRepository: false, branch: null, dirty: false, error: message }
    }
  })

  // ────────────────────────────────────────────────────────────────
  // 虚拟示波器(scope)通道 — 与 cli:* 并行(与 v1 一致)
  // ────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────
  // 虚拟示波器(scope)通道 — 与 cli:* 并行(与 v1 一致)
  // ────────────────────────────────────────────────────────────────

  ipcMain.handle('scope:open', async () => {
    openScopeWindow()
  })
  ipcMain.handle('scope:getStatus', async () => serialManager.getStatus())

  ipcMain.handle('serial:list', async (): Promise<SerialPortInfo[]> => {
    return SerialManager.listPorts()
  })

  ipcMain.handle('serial:open', async (_evt, cfg: SerialCfgWire) => {
    await serialManager.open(cfg)
    serialManager.attachDataListener()
    const win = getScopeWindow()
    if (win && !win.isDestroyed()) {
      const cfg = serialManager.getCfg()
      win.webContents.send('serial:event', {
        type: 'cfg',
        channels: cfg.channels,
        txFields: cfg.txFields
      })
    }
  })

  ipcMain.handle('serial:close', async () => {
    serialManager.close()
  })

  ipcMain.handle('serial:send', async (_evt, values: number[]) => {
    serialManager.sendCommand(values)
  })

  ipcMain.handle('serial:getCfg', async () => {
    return serialManager.getCfg()
  })

  // 把 SerialManager 的事件转发到 scope 窗口(只发到 scope,不广播主窗口)
  serialManager.removeAllListeners('frame')
  serialManager.removeAllListeners('bytes')
  serialManager.removeAllListeners('status')
  serialManager.on('frame', (decoded: Float64Array) => {
    const win = getScopeWindow()
    if (!win || win.isDestroyed()) return
    const nChannels = serialManager.getCfg().channels.length
    const nPairs = decoded.length / nChannels
    const evt: SerialEvent = {
      type: 'frame',
      payload: Array.from(decoded),
      nPairs,
      nChannels
    }
    win.webContents.send('serial:event', evt)
  })
  serialManager.on('bytes', (chunk: Uint8Array) => {
    const win = getScopeWindow()
    if (!win || win.isDestroyed()) return
    const evt: SerialEvent = { type: 'bytes', payload: Array.from(chunk) }
    win.webContents.send('serial:event', evt)
  })
  serialManager.on('status', (status) => {
    const win = getScopeWindow()
    if (win && !win.isDestroyed()) {
      const evt: SerialEvent = { type: 'status', status }
      win.webContents.send('serial:event', evt)
    }
    const main = getMainWindow()
    if (main && !main.isDestroyed()) main.webContents.send('scope:status', status)
  })
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

async function assertDirectory(directory: string): Promise<void> {
  const stat = await fs.stat(directory)
  if (!stat.isDirectory()) throw new Error('workspace path is not a directory')
}

async function execGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 3000, maxBuffer: 1024 * 1024 })
  return stdout
}

async function persist(): Promise<void> {
  const list = Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  await saveSessions(list)
}
