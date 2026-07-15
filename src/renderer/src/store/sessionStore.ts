// Zustand store — 第二步只覆盖 STEP 1 必要状态:
//   sessions 列表 / 当前选中 / 默认 provider / model / system
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
  /** 有 in-flight 回复的 session id(sendInput 后到 turn-end 之间) */
  inflight: Set<string>
  /** 默认模型(用于 New Session 时填进 Session.model) */
  providerModel: string
  /** 默认 system prompt */
  providerSystem: string

  setProvider: (patch: Partial<Pick<SessionStore, 'providerModel' | 'providerSystem'>>) => void
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
  // 默认走 DeepSeek。settings 加载后可以被 SettingsPopover 覆盖。
  providerModel: 'deepseek-chat',
  providerSystem: '',

  setProvider: (patch) => set((s) => ({ ...s, ...patch })),

  hydrate: (list) => {
    const map: Record<string, Session> = {}
    const order: string[] = []
    const sorted = [...list].sort((a, b) => b.updatedAt - a.createdAt)
    for (const s of sorted) {
      // 重启后所有 session 都视作 idle(没有正在跑的 SDK 流)
      map[s.id] = { ...s, status: 'idle' }
      order.push(s.id)
    }
    // 把第一个 session 的 model 作为 UI 默认值
    const firstModel = sorted[0]?.model ?? 'deepseek-chat'
    set({
      sessions: map,
      order,
      currentId: order[0] ?? null,
      providerModel: firstModel
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
        next.status = 'idle' // SDK 模式下 started 后立即 idle
      } else if (e.type === 'stdout' || e.type === 'stderr') {
        // v2 SDK 模式下,SessionManager 自己维护一份 messages(给 backend 用),
        // 但渲染端的 store.sessions 是独立副本,这里也要同步追加,否则 UI 看不到内容。
        // 注意:append 行为必须在 next.messages(已经在上面 [...s.messages] 深拷)上做,
        // 否则 React 不会 re-render。
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