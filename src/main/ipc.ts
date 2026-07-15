// IPC 处理器注册。所有渲染进程能调的接口都列在这里。

import { ipcMain, BrowserWindow } from 'electron'
import { sessionManager } from './sessions'
import { serialManager, SerialManager } from './serial'
import { openScopeWindow, getScopeWindow } from './windows'
import { loadSessions, saveSessions } from './persistence'
import type {
  Session,
  StartCliOpts,
  Message,
  SerialCfgWire,
  SerialEvent,
  SerialPortInfo
} from '../shared/types'

// 内存中的 session 列表,与子进程运行时为同一对象(简化:按 id 索引)
const sessions = new Map<string, Session>()

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  // 把 sessionManager 的事件转发到所有渲染窗口
  sessionManager.on('cli:event', (e) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('cli:event', e)
    }
    // 同步状态到内存中的 session(便于 list / 关窗持久化)
    const s = sessions.get(e.sessionId)
    if (!s) return
    if (e.type === 'started') s.status = 'running'
    if (e.type === 'stdout' || e.type === 'stderr') {
      // 把流式追加到当前正在生长的 assistant 消息(若有 user 在前)
      appendAssistant(s, e.chunk)
    }
    if (e.type === 'exit') {
      s.status = e.code === 0 ? 'idle' : 'error'
      const last = s.messages[s.messages.length - 1]
      if (last && last.streaming) last.streaming = false
    }
    if (e.type === 'session-init') {
      // 记录 claude 端的 session-id,后续 Restart 时通过 --resume 续接
      s.claudeSessionId = e.claudeSessionId
    }
    if (e.type === 'error') {
      s.status = 'error'
    }
    s.updatedAt = Date.now()
    persist().catch((err) => console.error('[ipc] persist failed:', err))
  })

  ipcMain.handle('cli:start', async (_evt, opts: StartCliOpts) => {
    const session = await sessionManager.start(opts)
    // 保留老 session 的 messages / claudeSessionId(自动 Restart / 手动 Restart 时
    // 不让 UI 历史丢,并且能通过 --resume 续接 claude 端上下文)。
    // sessionManager.start 返回的对象 messages=[];如果磁盘/memory 里已有这个 sessionId
    // 的历史,把 messages 和 claudeSessionId 复制过去。其他字段(cmd/args/status)以新启动为准。
    const old = sessions.get(session.id)
    if (old) {
      if (old.messages.length > 0) session.messages = [...old.messages]
      if (old.claudeSessionId && !session.claudeSessionId) {
        session.claudeSessionId = old.claudeSessionId
      }
    }
    sessions.set(session.id, session)
    await persist()
    return session
  })

  ipcMain.handle('cli:input', async (_evt, sessionId: string, text: string) => {
    const s = sessions.get(sessionId)
    if (s) {
      // 主进程只负责自己的内存 + 持久化;渲染端 store 已经在 App.tsx submitMessage
      // 里乐观 push 了 user 消息,这里不再回传,避免重复。
      pushMessage(s, {
        role: 'user',
        content: text,
        ts: Date.now()
      })
      await persist()
    }
    sessionManager.sendInput(sessionId, text)
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

  // 首次启动时,把磁盘的 session 装入内存(并杀掉任何尚存的进程)
  void loadSessions().then((list) => {
    for (const s of list) sessions.set(s.id, s)
  })

  // ────────────────────────────────────────────────────────────────
  // 虚拟示波器(scope)通道 — 与 cli:* 并行
  // ────────────────────────────────────────────────────────────────

  ipcMain.handle('scope:open', async () => {
    openScopeWindow()
  })

  ipcMain.handle('serial:list', async (): Promise<SerialPortInfo[]> => {
    return SerialManager.listPorts()
  })

  ipcMain.handle('serial:open', async (_evt, cfg: SerialCfgWire) => {
    await serialManager.open(cfg)
    // data 监听只 attach 一次(open 内部已 close 旧的,attacher 不会重复)
    serialManager.attachDataListener()
    // open 完成后,把当前通道 / txFields 推到 scope 窗口,renderer 据此 sync 视图层
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
    if (process.env.MOTRA_SCOPE_DEMO === '1') {
      try {
        const fs = require('fs')
        const line = `[${new Date().toISOString()}] frame nPairs=${nPairs} nChannels=${nChannels} first=${decoded[0]?.toFixed(1)},${decoded[1]?.toFixed(1)}\n`
        fs.appendFileSync('/tmp/scope-trace.log', line)
      } catch {}
    }
  })
  serialManager.on('bytes', (chunk: Uint8Array) => {
    const win = getScopeWindow()
    if (!win || win.isDestroyed()) return
    const evt: SerialEvent = { type: 'bytes', payload: Array.from(chunk) }
    win.webContents.send('serial:event', evt)
  })
  serialManager.on('status', (status) => {
    const win = getScopeWindow()
    if (!win || win.isDestroyed()) return
    const evt: SerialEvent = { type: 'status', status }
    win.webContents.send('serial:event', evt)
  })
}

// 把一条 stdout 流追加到 assistant 消息尾。
function appendAssistant(s: Session, chunk: string): void {
  const last = s.messages[s.messages.length - 1]
  if (last && last.role === 'assistant' && last.streaming) {
    last.content += chunk
    return
  }
  pushMessage(s, {
    role: 'assistant',
    content: chunk,
    ts: Date.now(),
    streaming: true
  })
}

function pushMessage(s: Session, m: Omit<Message, 'id'>): Message {
  const msg: Message = { id: cryptoSafeRandomId(), ...m }
  s.messages.push(msg)
  return msg
}

function cryptoSafeRandomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

async function persist(): Promise<void> {
  const list = Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  await saveSessions(list)
}
