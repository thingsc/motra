import { create } from 'zustand'
import type { CliEvent, ProviderSettingsView, Session } from '../../../shared/types'
import { ensureSubId } from './id'

export interface DraftTask {
  text: string
  model: string
  workspacePath?: string
}

interface SessionStore {
  sessions: Record<string, Session>
  order: string[]
  currentId: string | null
  inflight: Set<string>
  creatingDraft: boolean
  settings: ProviderSettingsView
  draft: DraftTask
  hydrate: (list: Session[]) => void
  setSettings: (settings: ProviderSettingsView) => void
  patchSettings: (patch: Partial<ProviderSettingsView>) => void
  select: (id: string | null) => void
  newDraft: (workspacePath?: string) => void
  patchDraft: (patch: Partial<DraftTask>) => void
  setCreatingDraft: (value: boolean) => void
  upsert: (session: Session) => void
  remove: (id: string) => void
  applyEvent: (event: CliEvent) => void
  pushUserMessage: (sessionId: string, text: string) => void
  pushSystemMessage: (sessionId: string, text: string) => void
  markInflight: (sessionId: string, value: boolean) => void
}

const DEFAULT_SETTINGS: ProviderSettingsView = {
  providerApiKey: '',
  providerBaseURL: 'https://api.deepseek.com/anthropic',
  providerModel: 'deepseek-chat',
  providerModels: ['deepseek-chat', 'deepseek-reasoner'],
  providerMaxTokens: 4096,
  providerSystem: ''
}

function sortedOrder(sessions: Record<string, Session>): string[] {
  return Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt).map((s) => s.id)
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: {},
  order: [],
  currentId: null,
  inflight: new Set(),
  creatingDraft: false,
  settings: DEFAULT_SETTINGS,
  draft: { text: '', model: DEFAULT_SETTINGS.providerModel },

  hydrate: (list) => {
    const sessions = Object.fromEntries(list.map((s) => [s.id, { ...s, status: 'idle' as const }]))
    set({ sessions, order: sortedOrder(sessions), currentId: null })
  },
  setSettings: (settings) => set((state) => ({
    settings,
    draft: state.currentId === null && !state.draft.text
      ? { ...state.draft, model: settings.providerModel }
      : state.draft
  })),
  patchSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
  select: (currentId) => set({ currentId }),
  newDraft: (workspacePath) => set((state) => ({
    currentId: null,
    draft: { text: '', model: state.settings.providerModel, workspacePath: workspacePath ?? state.draft.workspacePath }
  })),
  patchDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  setCreatingDraft: (creatingDraft) => set({ creatingDraft }),
  upsert: (session) => set((state) => {
    const sessions = { ...state.sessions, [session.id]: session }
    return { sessions, order: sortedOrder(sessions) }
  }),
  remove: (id) => set((state) => {
    const { [id]: _removed, ...sessions } = state.sessions
    const inflight = new Set(state.inflight)
    inflight.delete(id)
    return { sessions, order: sortedOrder(sessions), inflight, currentId: state.currentId === id ? null : state.currentId }
  }),
  applyEvent: (event) => set((state) => {
    const session = state.sessions[event.sessionId]
    if (!session) return state
    const next: Session = { ...session, messages: [...session.messages], updatedAt: Date.now() }
    const inflight = new Set(state.inflight)
    if (event.type === 'stdout' || event.type === 'stderr') {
      const last = next.messages[next.messages.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        next.messages[next.messages.length - 1] = { ...last, content: last.content + event.chunk }
      } else {
        next.messages.push({ id: ensureSubId(), role: 'assistant', content: event.chunk, ts: Date.now(), streaming: true })
      }
    } else if (event.type === 'turn-end' || event.type === 'exit' || event.type === 'error') {
      next.status = event.type === 'error' || (event.type === 'exit' && event.code !== 0) ? 'error' : 'idle'
      const last = next.messages[next.messages.length - 1]
      if (last?.streaming) next.messages[next.messages.length - 1] = { ...last, streaming: false }
      inflight.delete(event.sessionId)
    } else if (event.type === 'message') {
      next.messages.push(event.message)
    }
    const sessions = { ...state.sessions, [next.id]: next }
    return { sessions, order: sortedOrder(sessions), inflight }
  }),
  pushUserMessage: (sessionId, text) => set((state) => {
    const session = state.sessions[sessionId]
    if (!session) return state
    const next = { ...session, updatedAt: Date.now(), messages: [...session.messages, { id: ensureSubId(), role: 'user' as const, content: text, ts: Date.now() }] }
    const sessions = { ...state.sessions, [sessionId]: next }
    return { sessions, order: sortedOrder(sessions) }
  }),
  pushSystemMessage: (sessionId, text) => set((state) => {
    const session = state.sessions[sessionId]
    if (!session) return state
    const next = { ...session, messages: [...session.messages, { id: ensureSubId(), role: 'system' as const, content: text, ts: Date.now() }] }
    return { sessions: { ...state.sessions, [sessionId]: next } }
  }),
  markInflight: (sessionId, value) => set((state) => {
    const inflight = new Set(state.inflight)
    if (value) inflight.add(sessionId); else inflight.delete(sessionId)
    return { inflight }
  })
}))
