// Electron 主进程入口
//  - 创建 BrowserWindow(开发模式连 vite dev server,生产加载打包后的 index.html)
//  - 注册 IPC
//  - 处理 quit 时清理子进程

import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { sessionManager } from './sessions'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Motra',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 外部链接用默认浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // dev / prod 不同入口
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

void app.whenReady().then(() => {
  registerIpc(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS 习惯保持进程,其他平台 quit
  if (process.platform !== 'darwin') app.quit()
})

// 退出前确保杀掉所有 CLI 子进程
app.on('before-quit', () => {
  sessionManager.killAll()
})
