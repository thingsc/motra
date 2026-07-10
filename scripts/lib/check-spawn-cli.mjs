// check-spawn-cli.mjs - 驱动与 src/main/sessions.ts 行为对齐的最小 CliRunner,
// 验证 spawn + StringDecoder 行切分 + 事件发出链路。
//
// 不 import 真实 sessions.ts,因为它 new EventEmitter,需要 electron 上下文;
// 在这里把"spawn + 行切分"的语义复刻到本 checker,行为需要和 src/main/sessions.ts
// 保持一致——任何修改 sessions.ts 的代码都需要同步调整本文件。

import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'

class CliRunner {
  constructor(spawnFn = nodeSpawn) {
    this.spawnFn = spawnFn
    this.procs = new Map()
    this.buf = new Map()
    this.events = []
    this.listeners = []
  }
  on(fn) { this.listeners.push(fn) }
  emit(e) { this.events.push(e); for (const fn of this.listeners) fn(e) }
  async start(opts) {
    const id = opts.sessionId ?? `sess-${randomUUID().slice(0, 8)}`
    if (this.procs.has(id)) this.kill(id)
    const cmd = opts.cmd
    const args = opts.args ?? []
    const cwd = opts.cwd ?? process.cwd()
    const child = this.spawnFn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    })
    this.procs.set(id, child)
    this.buf.set(id, { stream: 'stdout', pending: '' })
    // claude -p 不消费 stdin,但保持打开会令它等 EOF —— 立即关掉走 default 行为
    if (!opts.keepStdin) {
      try { child.stdin.end() } catch {}
    }
    const dec = new StringDecoder('utf8')
    child.stdout.on('data', (b) => this.#chunk(id, 'stdout', b, dec))
    child.stderr.on('data', (b) => this.#chunk(id, 'stderr', b, dec))
    child.on('exit', (code, signal) => {
      const slot = this.buf.get(id)
      if (slot && slot.pending) {
        this.emit({ sessionId: id, type: slot.stream, chunk: slot.pending })
      }
      this.procs.delete(id)
      this.buf.delete(id)
      this.emit({ sessionId: id, type: 'exit', code, signal })
    })
    this.emit({ sessionId: id, type: 'started', pid: child.pid ?? -1 })
    return id
  }
  sendInput(id, text) {
    const c = this.procs.get(id)
    if (!c) throw new Error(`no proc ${id}`)
    c.stdin.write(text.endsWith('\n') ? text : text + '\n')
  }
  kill(id) {
    try { this.procs.get(id)?.kill() } catch {}
  }
  #chunk(id, stream, buf, dec) {
    const text = dec.write(buf) + dec.end()
    if (!text) return
    const slot = this.buf.get(id)
    slot.stream = stream
    const parts = text.split(/\r?\n/)
    const tail = parts.pop() ?? ''
    for (const line of parts) this.emit({ sessionId: id, type: stream, chunk: line + '\n' })
    slot.pending = tail
  }
  waitExit(id, timeoutMs) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
      this.on((e) => {
        if (e.sessionId === id && e.type === 'exit') {
          clearTimeout(t)
          resolve(e)
        }
      })
    })
  }
}

export async function runSpawnCli(item, ctx) {
  const a = item.args ?? {}
  const waitMs = Number(item.timeoutMs ?? a.waitMs ?? 20_000)
  const runner = new CliRunner()

  if (item.hook === 'cli-spawn-with-starter-message') {
    return runStarterProbe(runner, a, waitMs)
  }
  if (item.hook === 'cli-streaming-linetest') {
    return runLineTest(runner, a, waitMs)
  }
  return { ok: false, error: `spawn-cli 未知 hook: ${item.hook}` }
}

async function runStarterProbe(runner, args, waitMs) {
  // args 即最终命令行;CliRunner.start 默认会 end stdin,避免 cli 等 EOF
  const sid = await runner.start({
    cmd: args.cmd,
    args: args.args ?? []
  })
  try {
    await runner.waitExit(sid, waitMs)
  } catch (err) {
    runner.kill(sid)
    return { ok: false, error: `未在 ${waitMs}ms 内退出: ${err.message}` }
  }
  const types = runner.events.map((e) => e.type)
  const stdout = runner.events
    .filter((e) => e.type === 'stdout')
    .map((e) => e.chunk)
    .join('')
  const missing = ['started', 'exit'].filter((t) => !types.includes(t))
  if (missing.length) {
    return { ok: false, error: `缺事件: ${missing.join(',')}` }
  }
  if (!stdout.length) {
    return {
      ok: false,
      error: '无 stdout 输出',
      detail: runner.events.map((e) =>
        `[${e.type}] ${(e.chunk ?? e.message ?? e.code ?? '').toString().trim().slice(0, 200)}`
      )
    }
  }
  return {
    ok: true,
    detail: [
      `pid=${runner.events.find((e) => e.type === 'started')?.pid}`,
      `events: ${types.join(',')}`,
      `stdout length: ${stdout.length}`,
      `head: ${stdout.trim().slice(0, 80)}`
    ]
  }
}

async function runLineTest(runner, args, waitMs) {
  const sid = await runner.start({ cmd: args.cmd, args: args.args })
  try {
    await runner.waitExit(sid, waitMs)
  } catch (err) {
    runner.kill(sid)
    return { ok: false, error: `${args.cmd} 未在 ${waitMs}ms 内退出: ${err.message}` }
  }
  const stdoutEvents = runner.events.filter((e) => e.type === 'stdout')
  if (stdoutEvents.length < 3) {
    return {
      ok: false,
      error: `期望至少 3 段 stdout,实际 ${stdoutEvents.length}`,
      detail: stdoutEvents.map((e) => JSON.stringify(e.chunk))
    }
  }
  return {
    ok: true,
    detail: [
      `${stdoutEvents.length} 段 stdout,总长 ${stdoutEvents.reduce((n, e) => n + e.chunk.length, 0)} chars`,
      `tail: ${stdoutEvents[stdoutEvents.length - 1].chunk.trim()}`
    ]
  }
}
