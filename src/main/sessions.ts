// Session 管理 + Provider 流式调用。
//
// 与 Step 1 CLI 模式的区别:
//   - 不再 spawn 子进程,所有消息直接走 AgentBackend.stream()
//   - 多轮上下文由本类自己维护 messages 数组,不需要靠 CLI 的 --resume
//   - 对外 API(start / sendInput / kill / killAll / isRunning)与事件协议
//     (started / stdout / turn-end / error / exit)与旧版一致,
//     renderer 与 ipc.ts 几乎零改动
//
// 后端是 backend.ts 注入的(测试可注入 mock)。

import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { cryptoRandomId } from './persistence'
import type {
  CliEvent,
  Message,
  Session,
  StartCliOpts
} from '../shared/types'
import type { AgentBackend } from './agentBackend'

// 诊断日志写到 userData/motra.log,跟旧版保持同一个文件便于排查
function motraLog(tag: string, msg: string): void {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}\n`
  try { console.log(line.trim()) } catch { /* ignore */ }
  try {
    const dir = app.getPath('userData')
    void fs.appendFile(path.join(dir, 'motra.log'), line, 'utf8').catch(() => { /* ignore */ })
  } catch { /* ignore */ }
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>()
  /** 每个 session 一个 AbortController,Stop 按钮调 abort() 断流 */
  private controllers = new Map<string, AbortController>()
  /** 当前是否处于 in-flight 状态(发完 user 还没收到 turn-end) */
  private inflight = new Set<string>()
  private _backend: AgentBackend

  constructor(backend: AgentBackend) {
    super()
    this._backend = backend
  }

  /** settings 改完后由 runtime.ts 调用,替换 backend 实例 */
  setBackend(backend: AgentBackend): void {
    this._backend = backend
  }

  async start(opts: StartCliOpts): Promise<Session> {
    const id = opts.sessionId ?? cryptoRandomId()
    // 同 id 已存在:杀进程 + 清 controller(老 messages 保留给调用方决定要不要复用)
    if (this.sessions.has(id)) {
      this.kill(id)
    }

    const now = Date.now()
    const session: Session = {
      id,
      title: opts.title ?? `New ${new Date(now).toLocaleString('zh-CN')}`,
      createdAt: now,
      updatedAt: now,
      // spawn 后立即 idle,等 sendInput 才 running,跟旧版语义一致
      status: 'idle',
      model: opts.model,
      backend: 'sdk',
      messages: []
    }
    this.sessions.set(id, session)
    motraLog('start', `session=${id} model=${opts.model} backend=${this._backend.id}`)
    this.emitEvent({ sessionId: id, type: 'started', pid: -1 })
    return session
  }

  /**
   * 推一条 user 消息 + 触发 backend 流式回复。
   * 流结束(events on turn-end 或 error)前会持续 emit stdout/turn-end/error。
   */
  sendInput(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      motraLog('sendInput', `FAIL no session: ${sessionId}`)
      throw new Error(`session ${sessionId} not found`)
    }
    if (this.inflight.has(sessionId)) {
      // 上一轮还没结束,直接报错让上层决定
      throw new Error(`session ${sessionId} is busy`)
    }

    // 1. push user 消息到历史
    session.messages.push({
      id: cryptoRandomId(),
      role: 'user',
      content: text,
      ts: Date.now()
    })
    session.updatedAt = Date.now()
    session.status = 'running'
    this.inflight.add(sessionId)
    motraLog('sendInput', `OK ${sessionId} text="${text.slice(0, 40)}"`)

    // 2. 准备 controller + 调 backend
    const controller = new AbortController()
    this.controllers.set(sessionId, controller)

    // history = 除最后一条 user 外的所有消息(避免重复把刚 push 的 user 喂回去)
    const history = session.messages.slice(0, -1).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))

    let assistantBuffer = ''
    let lastAssistantMsg: Message | null = null

    // 后端回调
    const onDelta = (chunk: string): void => {
      // 流式追加到最近一条 assistant 消息
      if (!lastAssistantMsg || !lastAssistantMsg.streaming) {
        lastAssistantMsg = {
          id: cryptoRandomId(),
          role: 'assistant',
          content: chunk,
          ts: Date.now(),
          streaming: true
        }
        session.messages.push(lastAssistantMsg)
      } else {
        lastAssistantMsg.content += chunk
      }
      assistantBuffer += chunk
      this.emitEvent({ sessionId, type: 'stdout', chunk })
    }

    const onDone = (info: { inputTokens: number; outputTokens: number }): void => {
      motraLog('turn-end', `${sessionId} in=${info.inputTokens} out=${info.outputTokens}`)
      if (lastAssistantMsg) lastAssistantMsg.streaming = false
      session.status = 'idle'
      this.inflight.delete(sessionId)
      this.controllers.delete(sessionId)
      this.emitEvent({ sessionId, type: 'turn-end' })
    }

    const onError = (err: Error): void => {
      motraLog('backend-error', `${sessionId}: ${err.message}`)
      if (lastAssistantMsg) lastAssistantMsg.streaming = false
      session.status = 'error'
      this.inflight.delete(sessionId)
      this.controllers.delete(sessionId)
      this.emitEvent({ sessionId, type: 'error', message: err.message })
    }

    // 启动流(立刻同步返回;真实工作在 SDK 里)
    void this._backend
      .stream({
        sessionId,
        history,
        userText: text,
        model: session.model,
        signal: controller.signal,
        onDelta,
        onDone,
        onError
      })
      .catch((err: unknown) => {
        // backend.stream 自身抛错(理论上不会,因为它在内部 catch 后调 onError;
        // 兜底防止 SDK 抛 APIUserAbortError 等未被 onError 接住的错误)
        onError(err instanceof Error ? err : new Error(String(err)))
      })
  }

  kill(sessionId: string): void {
    const controller = this.controllers.get(sessionId)
    if (!controller) return
    try {
      controller.abort()
    } catch {
      // ignore
    }
    this.controllers.delete(sessionId)
    const session = this.sessions.get(sessionId)
    if (session) {
      // 把正在 streaming 的 assistant 消息关掉
      const last = session.messages[session.messages.length - 1]
      if (last && last.role === 'assistant' && last.streaming) {
        last.streaming = false
      }
      session.status = 'idle'
    }
    this.inflight.delete(sessionId)
    this.emitEvent({ sessionId, type: 'exit', code: 0, signal: null })
  }

  isRunning(sessionId: string): boolean {
    return this.inflight.has(sessionId)
  }

  killAll(): void {
    for (const id of Array.from(this.controllers.keys())) {
      this.kill(id)
    }
  }

  private emitEvent(e: CliEvent): void {
    this.emit('cli:event', e)
  }
}