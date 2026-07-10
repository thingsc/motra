// Zustand store - 第一步只覆盖 STEP 1 必要状态:
//   sessions 列表 / 当前选中 / 是否开启 CLI 配置面板 / 启动参数(cmd, args, cwd)
//
// 真实会话内容从主进程事件流回填,store 只做引用。

import { create } from 'zustand'
import type { CliEvent, Session } from '../../../shared/types'
import { ensureSubId } from './id'

type Status = 'idle' | 'running' | 'exited' | 'error'

interface SessionStore {
  sessions: Record<string, Session>
  order: string[] // 按 updatedAt 倒序的 session id
  currentId: string | null
  /** 有 in-flight 回复的 session id(stream-json 模式下 sendInput 后到 result event 之间) */
  inflight: Set<string>
  cliCmd: string
  cliArgs: string
  cliCwd: string

  setCli: (patch: Partial<Pick<SessionStore, 'cliCmd' | 'cliArgs' | 'cliCwd'>>) => void
  hydrate: (list: Session[]) => void
  select: (id: string | null) => void
  upsert: (s: Session) => void
  remove: (id: string) => void
  applyEvent: (e: CliEvent) => void
  pushUserMessage: (sessionId: string, text: string) => void
  pushSystemMessage: (sessionId: string, text: string) => void
  markInflight: (sessionId: string, value: boolean) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  order: [],
  currentId: null,
  inflight: new Set(),
  cliCmd: 'claude',
  // 默认走 stream-json 协议:子进程用 stdin/stdout 的 newline-delimited JSON
  // 维持多轮 + 流式,避免 pipe stdin 触发 claude 的 --print 一次性模式。
  // --include-partial-messages 让 claude 输出 stream_event(text_delta 增量),前端才能做流式
  cliArgs: '--print --input-format stream-json --output-format stream-json --verbose --include-partial-messages',
  cliCwd: '',

  setCli: (patch) => set((s) => ({ ...s, ...patch })),

  hydrate: (list) => {
    const map: Record<string, Session> = {}
    const order: string[] = []
    const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
    for (const s of sorted) {
      map[s.id] = { ...s, status: 'idle' } // 重启后所有进程都被视作 idle
      order.push(s.id)
    }
    set({
      sessions: map,
      order,
      currentId: order[0] ?? null
    })
  },

  select: (id) => set({ currentId: id }),

  upsert: (s) =>
    set((state) => {
      const existed = !!state.sessions[s.id]
      const map = { ...state.sessions, [s.id]: s }
      const order = existed ? state.order : [s.id, ...state.order]
      return {
        sessions: map,
        order,
        currentId: state.currentId ?? s.id
      }
    }),

  remove: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.sessions
      return {
        sessions: rest,
        order: state.order.filter((x) => x !== id),
        currentId: state.currentId === id ? null : state.currentId
      }
    }),

  applyEvent: (e) =>
    set((state) => {
      const s = state.sessions[e.sessionId]
      if (!s) return state
      const next: Session = { ...s, messages: [...s.messages], updatedAt: Date.now() }

      if (e.type === 'started') {
        next.status = 'idle' // spawn 完仍然 idle,直到 sendInput 才 running
      } else if (e.type === 'stdout' || e.type === 'stderr') {
        const last = next.messages[next.messages.length - 1]
        if (last && last.role === 'assistant' && last.streaming) {
          next.messages[next.messages.length - 1] = {
            ...last,
            content: last.content + e.chunk
          }
        } else {
          next.messages.push({
            id: ensureSubId(),
            role: 'assistant',
            content: e.chunk,
            ts: Date.now(),
            streaming: true
          })
        }
      } else if (e.type === 'turn-end') {
        // stream-json 协议下,result event 表示这一轮结束
        next.status = 'idle'
        const last = next.messages[next.messages.length - 1]
        if (last && last.streaming) {
          next.messages[next.messages.length - 1] = { ...last, streaming: false }
        }
        const inflight = new Set(state.inflight)
        inflight.delete(e.sessionId)
        const order = [e.sessionId, ...state.order.filter((x) => x !== e.sessionId)]
        return { sessions: { ...state.sessions, [s.id]: next }, order, inflight }
      } else if (e.type === 'exit') {
        next.status = e.code === 0 ? 'idle' : 'error'
        const last = next.messages[next.messages.length - 1]
        if (last && last.streaming) {
          next.messages[next.messages.length - 1] = { ...last, streaming: false }
        }
        const inflight = new Set(state.inflight)
        inflight.delete(e.sessionId)
        const order = [e.sessionId, ...state.order.filter((x) => x !== e.sessionId)]
        return { sessions: { ...state.sessions, [s.id]: next }, order, inflight }
      } else if (e.type === 'error') {
        next.status = 'error'
      } else if (e.type === 'message') {
        // 主进程告知一条 user/system 消息已落地
        next.messages.push(e.message)
      }

      // 把被 hit 的 session 推到 order 首位
      const order = [e.sessionId, ...state.order.filter((x) => x !== e.sessionId)]
      return { sessions: { ...state.sessions, [s.id]: next }, order }
    }),

  pushUserMessage: (sessionId, text) =>
    set((state) => {
      const s = state.sessions[sessionId]
      if (!s) return state
      const next: Session = {
        ...s,
        messages: [
          ...s.messages,
          { id: ensureSubId(), role: 'user', content: text, ts: Date.now() }
        ],
        updatedAt: Date.now()
      }
      return { sessions: { ...state.sessions, [sessionId]: next } }
    }),

  pushSystemMessage: (sessionId, text) =>
    set((state) => {
      const s = state.sessions[sessionId]
      if (!s) return state
      const next: Session = {
        ...s,
        messages: [
          ...s.messages,
          { id: ensureSubId(), role: 'system', content: text, ts: Date.now() }
        ],
        updatedAt: Date.now()
      }
      return { sessions: { ...state.sessions, [sessionId]: next } }
    }),

  markInflight: (sessionId, value) =>
    set((state) => {
      const inflight = new Set(state.inflight)
      if (value) inflight.add(sessionId)
      else inflight.delete(sessionId)
      return { inflight }
    })
}))
