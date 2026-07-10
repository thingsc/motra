// Preload:仅暴露受控 API,禁止 require。
// 通过 contextBridge 把 MotraApi 注入到 window.api,renderer 只看得到这个对象。

import { contextBridge, ipcRenderer } from 'electron'
import type { MotraApi, CliEvent, Session, StartCliOpts } from '../shared/types'

const api: MotraApi = {
  startCli: (opts: StartCliOpts) => ipcRenderer.invoke('cli:start', opts),
  sendInput: (sessionId: string, text: string) =>
    ipcRenderer.invoke('cli:input', sessionId, text),
  killCli: (sessionId: string) => ipcRenderer.invoke('cli:kill', sessionId),
  listSessions: () => ipcRenderer.invoke('cli:list'),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('cli:delete', sessionId),
  onCliEvent: (cb: (e: CliEvent) => void) => {
    const listener = (_evt: Electron.IpcRendererEvent, payload: CliEvent): void => cb(payload)
    ipcRenderer.on('cli:event', listener)
    return () => ipcRenderer.removeListener('cli:event', listener)
  },
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }
}

contextBridge.exposeInMainWorld('api', api)
