import { create } from 'zustand'
import type { AppLanguage, SerialStatus } from '../../../shared/types'

export type AppView = 'chat' | 'tasks' | 'settings'
export interface ToastMessage { id: number; text: string; tone?: 'info' | 'error' }

interface AppStore {
  view: AppView
  previousView: Exclude<AppView, 'settings'>
  language: AppLanguage
  recentWorkspaces: string[]
  sidebarCollapsed: boolean
  scopeStatus: SerialStatus
  toasts: ToastMessage[]
  settingsDirty: boolean
  setView: (view: AppView) => void
  setLanguage: (language: AppLanguage) => void
  setRecentWorkspaces: (paths: string[]) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (value: boolean) => void
  setScopeStatus: (status: SerialStatus) => void
  toast: (text: string, tone?: ToastMessage['tone']) => void
  dismissToast: (id: number) => void
  setSettingsDirty: (value: boolean) => void
}

const initialCollapsed = localStorage.getItem('motra.sidebar.collapsed') === 'true'

export const useAppStore = create<AppStore>((set) => ({
  view: 'chat', previousView: 'chat', language: 'en', recentWorkspaces: [], sidebarCollapsed: initialCollapsed,
  scopeStatus: { isOpen: false, port: '', baud: 0, bytesIn: 0, framesIn: 0, dropped: 0, error: null },
  toasts: [], settingsDirty: false,
  setView: (view) => set((state) => {
    if (state.view === 'settings' && view !== 'settings' && state.settingsDirty) {
      const message = state.language === 'zh-CN' ? '放弃未保存的设置更改？' : 'Discard unsaved settings changes?'
      if (!window.confirm(message)) return state
    }
    return { view, settingsDirty: view === 'settings' ? state.settingsDirty : false, previousView: view === 'settings' ? state.view === 'tasks' ? 'tasks' : 'chat' : view }
  }),
  setLanguage: (language) => set({ language }),
  setRecentWorkspaces: (recentWorkspaces) => set({ recentWorkspaces }),
  toggleSidebar: () => set((state) => {
    const value = !state.sidebarCollapsed; localStorage.setItem('motra.sidebar.collapsed', String(value)); return { sidebarCollapsed: value }
  }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setScopeStatus: (scopeStatus) => set({ scopeStatus }),
  toast: (text, tone = 'info') => set((state) => {
    const duplicate = state.toasts.find((item) => item.text === text)
    if (duplicate) return state
    const item = { id: Date.now() + Math.random(), text, tone }
    window.setTimeout(() => useAppStore.getState().dismissToast(item.id), 3000)
    return { toasts: [...state.toasts, item] }
  }),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
  ,setSettingsDirty: (settingsDirty) => set({ settingsDirty })
}))
