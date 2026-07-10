// sessions.json 持久化:启动读、每次变更写。
// 路径:app.getPath('userData')/sessions.json

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Session } from '../shared/types'

interface PersistShape {
  version: 1
  sessions: Session[]
}

let cache: Session[] | null = null
let filePath: string | null = null

function getFilePath(): string {
  if (filePath) return filePath
  const dir = app.getPath('userData')
  filePath = path.join(dir, 'sessions.json')
  return filePath
}

export async function loadSessions(): Promise<Session[]> {
  if (cache) return cache
  const fp = getFilePath()
  try {
    const raw = await fs.readFile(fp, 'utf8')
    const parsed = JSON.parse(raw) as PersistShape
    if (parsed && Array.isArray(parsed.sessions)) {
      cache = parsed.sessions.map(normalizeSession)
      return cache
    }
    cache = []
    return cache
  } catch (err: unknown) {
    // 文件不存在或损坏,给空数组
    cache = []
    return cache
  }
}

export async function saveSessions(sessions: Session[]): Promise<void> {
  cache = sessions
  const fp = getFilePath()
  const payload: PersistShape = { version: 1, sessions }
  await fs.mkdir(path.dirname(fp), { recursive: true })
  // tmp 文件名要每次 unique,否则并发 saveSessions 会竞争同一个 tmp,
  // 后写者覆盖前写者的内容,前者 rename 时后者已经 rename 走 → ENOENT
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await fs.rename(tmp, fp)
}

// 把磁盘上的对象规整成 Session 形状,做最轻的兜底
function normalizeSession(s: Partial<Session>): Session {
  return {
    id: s.id ?? cryptoRandomId(),
    title: s.title ?? 'Untitled',
    createdAt: s.createdAt ?? Date.now(),
    updatedAt: s.updatedAt ?? s.createdAt ?? Date.now(),
    status: s.status ?? 'idle',
    cmd: s.cmd ?? 'claude',
    // 磁盘数据缺失 args 时的兜底:走 stream-json 协议,而不是裸 --print
    // (裸 --print + pipe stdin 会被 claude 立刻要求 prompt,3s 后报错退出)
    args: Array.isArray(s.args)
      ? s.args
      : [
          '--print',
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages'
        ],
    cwd: s.cwd,
    messages: Array.isArray(s.messages) ? s.messages : []
  }
}

export function cryptoRandomId(): string {
  return randomUUID()
}
