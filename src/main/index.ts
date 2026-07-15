// Electron 主进程入口
//  - 创建主窗口(通过 windows.ts 工厂)
//  - 注册 IPC(包含 scope:* 与 serial:*)
//  - 处理 quit 时清理子进程(CLI 会话 + 串口)

import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { sessionManager } from './sessions'
import { serialManager } from './serial'
import { createMainWindow, getMainWindow, openScopeWindow } from './windows'

void app.whenReady().then(() => {
  registerIpc(getMainWindow)
  createMainWindow()

  // Smoke helper: MOTRA_SCOPE_DEMO=1 时自动打开 scope 窗口
  if (process.env.MOTRA_SCOPE_DEMO === '1') {
    setTimeout(() => openScopeWindow(), 1500)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS 习惯保持进程,其他平台 quit
  if (process.platform !== 'darwin') app.quit()
})

// 退出前确保杀掉所有子进程(CLI 会话 + 串口)
app.on('before-quit', () => {
  sessionManager.killAll()
  serialManager.close()
})