// Preload:仅暴露受控 API,禁止 require。
// 通过 contextBridge 把 MotraApi 注入到 window.api,renderer 只看得到这个对象。

import { contextBridge, ipcRenderer } from 'electron'
import type {
  MotraApi,
  CliEvent,
  Session,
  StartCliOpts,
  SerialCfgWire,
  SerialEvent,
  ProviderSettingsView
} from '../shared/types'

const api: MotraApi = {
  startCli: (opts: StartCliOpts) => ipcRenderer.invoke('cli:start', opts),
  sendInput: (sessionId: string, text: string) =>
    ipcRenderer.invoke('cli:input', sessionId, text),
  killCli: (sessionId: string) => ipcRenderer.invoke('cli:kill', sessionId),
  listSessions: () => ipcRenderer.invoke('cli:list'),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('cli:delete', sessionId),
  renameTask: (sessionId, title) => ipcRenderer.invoke('task:rename', sessionId, title),
  updateTaskContext: (sessionId, patch) => ipcRenderer.invoke('task:updateContext', sessionId, patch),
  onCliEvent: (cb: (e: CliEvent) => void) => {
    const listener = (_evt: Electron.IpcRendererEvent, payload: CliEvent): void => cb(payload)
    ipcRenderer.on('cli:event', listener)
    return () => ipcRenderer.removeListener('cli:event', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<ProviderSettingsView>) =>
    ipcRenderer.invoke('settings:set', patch),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: (patch) => ipcRenderer.invoke('preferences:set', patch),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  getGitStatus: (workspacePath) => ipcRenderer.invoke('workspace:getGitStatus', workspacePath),

  // scope 相关
  openScope: () => ipcRenderer.invoke('scope:open'),
  getScopeStatus: () => ipcRenderer.invoke('scope:getStatus'),
  onScopeStatus: (cb) => {
    const listener = (_evt: Electron.IpcRendererEvent, status: Parameters<typeof cb>[0]): void => cb(status)
    ipcRenderer.on('scope:status', listener)
    return () => ipcRenderer.removeListener('scope:status', listener)
  },
  serialList: () => ipcRenderer.invoke('serial:list'),
  serialOpen: (cfg: SerialCfgWire) => ipcRenderer.invoke('serial:open', cfg),
  serialClose: () => ipcRenderer.invoke('serial:close'),
  serialSend: (values: number[]) => ipcRenderer.invoke('serial:send', values),
  serialGetCfg: () => ipcRenderer.invoke('serial:getCfg'),
  onSerialEvent: (cb: (e: SerialEvent) => void) => {
    const listener = (_evt: Electron.IpcRendererEvent, payload: SerialEvent): void => cb(payload)
    ipcRenderer.on('serial:event', listener)
    return () => ipcRenderer.removeListener('serial:event', listener)
  },

  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }
}

contextBridge.exposeInMainWorld('api', api)
