// Session + 子进程管理:
//  - Map<sessionId, ChildProcess> 存进程
//  - stdout / stderr 行切分缓冲 → emit('cli:event', ...)
//  - 给前端暴露 start / input / kill

import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
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

// 诊断日志:写到 ~/Library/Application Support/Motra/motra.log,不依赖 terminal
// 排查时 cat 这个文件就能看到主进程每一步发生了什么
function motraLog(tag: string, msg: string): void {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}\n`
  try { console.log(line.trim()) } catch { /* ignore */ }
  try {
    const dir = app.getPath('userData')
    void fs.appendFile(path.join(dir, 'motra.log'), line, 'utf8').catch(() => { /* ignore */ })
  } catch { /* ignore */ }
}

export class SessionManager extends EventEmitter {
  private processes = new Map<string, ChildProcessWithoutNullStreams>()
  /** { id → 'stdout'/'stderr' 上一次没切完的那段 } */
  private lineBuffer = new Map<string, { stream: 'stdout' | 'stderr'; dec: StringDecoder; pending: string }>()
  /** 运行时元数据:每个 session 在 claude init event 后拿到的 session-id,
   *  用来在后续 Restart 时通过 --resume 接回上下文 */
  private sessionMeta = new Map<string, { claudeSessionId?: string }>()
  /** in-memory Session 对象引用(消息 / 状态等),用来 init event 后立刻更新字段 */
  private sessionObjects = new Map<string, Session>()
  /** 是否已经为该进程日志过一次 text_delta(用于 first-text 标记) */
  private _loggedText = false

  async start(opts: StartCliOpts): Promise<Session> {
    const id = opts.sessionId ?? cryptoRandomId()
    // 不允许重复启动:如果同 id 还在跑,先杀掉
    if (this.processes.has(id)) this.kill(id)

    // 不传 args 时走默认交互模式:claude 进入 REPL,sendInput 通过 stdin 一行行喂 prompt。
    // 之前默认 ['--print'] 是错的:`--print` 是一次性模式,要求启动时一次收完 prompt,否则 3s 后自己报错退出。
    // stream-json 协议:
    //   - --print 强制走一次性 stdin/stdout 通道(避免 TTY 检测)
    //   - --input-format stream-json : stdin 收 newline-delimited JSON
    //       客户端发  {"type":"user","message":{"role":"user","content":"..."}}
    //   - --output-format stream-json: stdout 输出 event 流(每行一个 JSON),
    //       type ∈ { system, assistant, result, ... }
    // 这是 Anthropic 官方为 SDK 场景设计的协议,比 node-pty 更轻,
    // 天然支持多轮 + 流式 + 跨进程会话(session_id 由 init event 返回)。
    const args =
      opts.args ?? [
        '--print',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        // 启用后 claude 会同时输出 stream_event(text_delta / thinking_delta ...),
        // 那是真正的逐 token 增量,可以给前端做流式追加
        '--include-partial-messages'
      ]
    const cmd = opts.cmd || 'claude'
    const cwd = opts.cwd ?? process.cwd()

    // 如果外部提供了 resumeSessionId(从老 session 的 claudeSessionId 来),
    // 在 args 里加 --resume,让 claude 端续接上下文
    if (opts.resumeSessionId && !args.includes('--resume')) {
      args.push('--resume', opts.resumeSessionId)
    }

    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // 不强制 shell:直接 exec,避免路径解析歧义
      shell: false
    })

    this.processes.set(id, child)
    motraLog('start', `session=${id} pid=${child.pid} cwd=${cwd} args=${args.join(' ')}`)
    this.lineBuffer.set(id, {
      stream: 'stdout',
      dec: new StringDecoder('utf8'),
      pending: ''
    })

    child.stdout.on('data', (buf: Buffer) => {
      // 每次 stdout 有数据就记一条(截断 80 字符避免日志爆炸)
      motraLog('stdout', `${id} ${buf.length}B: ${buf.toString('utf8').slice(0, 80).replace(/\n/g, '\\n')}`)
      this.handleChunk(id, 'stdout', buf)
    })
    child.stderr.on('data', (buf: Buffer) => {
      motraLog('stderr', `${id} ${buf.length}B: ${buf.toString('utf8').slice(0, 120).replace(/\n/g, '\\n')}`)
      this.handleChunk(id, 'stderr', buf)
    })

    child.on('error', (err) => {
      motraLog('child-error', `${id}: ${err.message}`)
      this.emitEvent({ sessionId: id, type: 'error', message: err.message })
    })

    child.on('exit', (code, signal) => {
      motraLog('child-exit', `${id} code=${code} signal=${signal}`)
      // exit 前把残余缓冲 flush 出来
      const buf = this.lineBuffer.get(id)
      if (buf && buf.pending) {
        this.emitEvent({
          sessionId: id,
          type: buf.stream,
          chunk: buf.pending
        })
      }
      this.processes.delete(id)
      this.lineBuffer.delete(id)
      // 注意:sessionObjects 和 sessionMeta 保留,claudeSessionId 还要给后续 Restart 用
      this.emitEvent({ sessionId: id, type: 'exit', code, signal })
    })

    this.emitEvent({ sessionId: id, type: 'started', pid: child.pid ?? -1 })

    const now = Date.now()
    const session: Session = {
      id,
      title: opts.title ?? `New ${new Date(now).toLocaleString('zh-CN')}`,
      createdAt: now,
      updatedAt: now,
      // 关键:spawn 后子进程不一定真在"做事"(stream-json 模式下它在等 user message),
      // 所以默认 idle,由 sendInput 触发 running,result event 触发回 idle。
      status: 'idle',
      cmd,
      args,
      cwd,
      messages: [],
      // 如果是 --resume 启动,claude 端会复用同一个 session-id;这里先占位,
      // 等 init event 回来再覆盖(也可能就是同一个值)
      claudeSessionId: opts.resumeSessionId
    }
    this.sessionObjects.set(id, session)
    if (opts.resumeSessionId) {
      this.sessionMeta.set(id, { claudeSessionId: opts.resumeSessionId })
    }
    return session
  }

  sendInput(sessionId: string, text: string): void {
    const child = this.processes.get(sessionId)
    if (!child) {
      motraLog('sendInput', `FAIL not running: ${sessionId} text="${text.slice(0, 40)}"`)
      throw new Error(`session ${sessionId} not running`)
    }
    motraLog('sendInput', `OK: ${sessionId} text="${text.slice(0, 40)}"`)
    // stream-json 协议:每条消息一个 JSON object,以 \n 结束
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text }
    })
    child.stdin.write(payload + '\n')
  }

  kill(sessionId: string): void {
    const child = this.processes.get(sessionId)
    if (!child) return
    try {
      child.kill()
    } catch {
      // 已经退出,忽略
    }
  }

  isRunning(sessionId: string): boolean {
    return this.processes.has(sessionId)
  }

  /** 释放所有子进程,app.quit 时调用 */
  killAll(): void {
    for (const [id] of this.processes) this.kill(id)
  }

  // -------- 内部 --------

  private handleChunk(id: string, stream: 'stdout' | 'stderr', buf: Buffer): void {
    const slot = this.lineBuffer.get(id)
    if (!slot) return
    const text = slot.dec.write(buf) + slot.dec.end()
    if (!text) return
    slot.stream = stream
    this.emitByLines(id, stream, text)
  }

  private emitByLines(id: string, stream: 'stdout' | 'stderr', text: string): void {
    // 半行累积 + 按 \n 切。保留最后一段(可能没换行结尾)进 buffer
    const parts = text.split(/\r?\n/)
    const tail = parts.pop() ?? ''
    for (const line of parts) {
      this.processStreamLine(id, stream, line)
    }
    const slot = this.lineBuffer.get(id)
    if (slot) slot.pending = tail
  }

  /**
   * 解析一行 stream-json event,只把 assistant 的 text 片段透传给前端。
   * 其他 type(system / thinking_tokens / result / user / tool_result ...)
   * 一律忽略,避免把协议噪音塞进 ChatPane。
   */
  private processStreamLine(
    id: string,
    stream: 'stdout' | 'stderr',
    line: string
  ): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let evt: Record<string, unknown> | null = null
    try {
      evt = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      // 非 JSON 行(罕见):当成原始 stderr 透传,方便排查
      if (stream === 'stderr') {
        this.emitEvent({ sessionId: id, type: 'stderr', chunk: trimmed + '\n' })
      }
      return
    }
    if (!evt || typeof evt !== 'object') return

    const type = evt['type']
    const subtype = evt['subtype']
    if (type === 'system' && subtype === 'init') {
      // claude CLI 在 stream-json 协议下,启动后会发一个 system/init event,
      // 带 session_id(后续 --resume 用这个续接)。存到内存 session + 通知前端 + ipc 层持久化。
      const sid = evt['session_id']
      if (typeof sid === 'string' && sid.length > 0) {
        const meta = this.sessionMeta.get(id) ?? {}
        meta.claudeSessionId = sid
        this.sessionMeta.set(id, meta)
        const s = this.sessionObjects.get(id)
        if (s) s.claudeSessionId = sid
        motraLog('init', `${id} claudeSessionId=${sid}`)
        this.emitEvent({ sessionId: id, type: 'session-init', claudeSessionId: sid })
      }
      return
    }
    if (type === 'stream_event') {
      // --include-partial-messages 启用后才会有这个类型。
      // 这里拿到的是 Anthropic 原生 streaming event:
      //   message_start / content_block_start / content_block_delta
      //   / content_block_stop / message_delta / message_stop
      // 我们只对 text_delta 感兴趣(thinking_delta 暂不暴露给 UI)。
      const inner = evt['event'] as
        | {
            type?: string
            delta?: { type?: string; text?: unknown }
          }
        | undefined
      const delta = inner?.delta
      if (
        inner?.type === 'content_block_delta' &&
        delta?.type === 'text_delta' &&
        typeof delta.text === 'string' &&
        delta.text.length > 0
      ) {
        if (!this._loggedText) {
          motraLog('text_delta', `${id} first="${delta.text.slice(0, 30)}"`)
          this._loggedText = true
        }
        this.emitEvent({ sessionId: id, type: 'stdout', chunk: delta.text })
      }
      return
    }
    if (type === 'assistant') {
      // 有了 stream_event 的 text_delta 增量后,这里不能再 emit 完整 text,会重复。
      // assistant 事件的累积内容交给前端 streaming 状态自然累加。
      return
    }
    if (type === 'result') {
      // 一轮回复结束:前端用来关 streaming 标记 + 清 inflight
      this.emitEvent({ sessionId: id, type: 'turn-end' })
      return
    }
    // type === 'system' | 'user' | 'tool_result' | ... 都静默丢掉
  }

  private emitEvent(e: CliEvent): void {
    this.emit('cli:event', e)
  }
}

// 全局单例
export const sessionManager = new SessionManager()
