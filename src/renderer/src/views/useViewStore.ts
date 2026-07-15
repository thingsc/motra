import { create } from 'zustand'

export type ActiveTool = 'chat' | 'scope' | null

interface ViewState {
  activeTool: ActiveTool
  setActiveTool: (t: ActiveTool) => void
}

/**
 * 侧栏"工具箱"激活状态。
 * 注意:这个 store 只反映"哪个工具入口高亮",与 sessionStore.currentId 解耦——
 * 主窗口永远显示聊天,scope 入口高亮只是为了视觉反馈"工具已开"。
 */
export const useViewStore = create<ViewState>((set) => ({
  activeTool: null,
  setActiveTool: (t) => set({ activeTool: t })
}))