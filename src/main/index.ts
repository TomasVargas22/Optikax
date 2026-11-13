import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type WindowState } from '@shared/types'
import { stopAutoClean } from './memory'
import { worker } from './ps'
import { registerIpc, TITLEBAR, TITLEBAR_HEIGHT } from './ipc'

let mainWindow: BrowserWindow | null = null

function windowState(win: BrowserWindow): WindowState {
  if (win.isMinimized() || !win.isVisible()) return 'oculta'
  return win.isFocused() ? 'visible' : 'sin-foco'
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: '#010101',
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLEBAR.oscuro, height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  // El renderer pausa el 3D y los sondeos cuando la ventana no se ve.
  const notify = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.windowState, windowState(win))
  }
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide'] as const) {
    win.on(ev as 'focus', notify)
  }

  // Los enlaces (fuentes de la IA) se abren en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.optikax.app')
    registerIpc(() => mainWindow)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    stopAutoClean()
    worker.stop()
  })
}
