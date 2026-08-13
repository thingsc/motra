// 主进程窗口工厂。
// 抽 createMainWindow / openScopeWindow 两个工厂,index.ts 只负责调用与生命周期。

import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindowRef: BrowserWindow | null = null
let scopeWindowRef: BrowserWindow | null = null

/** 主窗口访问器(给 SessionManager / Persistence 等用) */
export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null
}

/** scope 窗口访问器(给 SerialManager IPC 转发用) */
export function getScopeWindow(): BrowserWindow | null {
  return scopeWindowRef && !scopeWindowRef.isDestroyed() ? scopeWindowRef : null
}

const SHARED_WEB_PREFERENCES = {
  preload: path.join(__dirname, '../preload/index.mjs'),
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false
} as const

function attachExternalLinkHandler(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function pickEntryUrl(subpath: string): { devUrl: string; prodFile: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    return { devUrl: `${devUrl}${subpath}`, prodFile: '' }
  }
  return { devUrl: '', prodFile: path.join(__dirname, `../renderer${subpath}`) }
}

/**
 * 创建主窗口(三栏聊天 SPA)。
 * 与 STEP 1 的 createWindow() 行为一致:1280×800,show:false 等 ready-to-show。
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'Motra',
    backgroundColor: '#11110f',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: { ...SHARED_WEB_PREFERENCES }
  })

  win.once('ready-to-show', () => win.show())
  attachExternalLinkHandler(win)

  const entry = pickEntryUrl('/index.html')
  if (entry.devUrl) void win.loadURL(entry.devUrl)
  else void win.loadFile(entry.prodFile)

  mainWindowRef = win
  win.on('closed', () => {
    if (mainWindowRef === win) mainWindowRef = null
  })
  return win
}

/**
 * 打开/激活 scope 窗口(独立 BrowserWindow,1000×720)。
 * 不设置 parent，避免 macOS 将它视为会跟随主窗口移动的子窗口。
 * 已存在则 focus,否则新建。scope 窗口加载 renderer 的 scope.html 子入口。
 */
export function openScopeWindow(): BrowserWindow {
  if (scopeWindowRef && !scopeWindowRef.isDestroyed()) {
    scopeWindowRef.focus()
    return scopeWindowRef
  }

  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    title: '虚拟示波器 — Motra',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: { ...SHARED_WEB_PREFERENCES }
  })

  win.once('ready-to-show', () => win.show())
  attachExternalLinkHandler(win)

  const entry = pickEntryUrl('/scope.html')
  const demoQuery = process.env.MOTRA_SCOPE_DEMO === '1' ? '?demo=1' : ''
  if (entry.devUrl) void win.loadURL(entry.devUrl + demoQuery)
  else void win.loadFile(entry.prodFile)

  scopeWindowRef = win
  win.on('closed', () => {
    if (scopeWindowRef === win) scopeWindowRef = null
  })
  return win
}
