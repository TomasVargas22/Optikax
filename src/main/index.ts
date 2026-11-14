import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type WindowState } from '@shared/types'
import { hasActiveGame, shutdownGameMode, startGameMode } from './gamemode'
import { stopAutoClean } from './memory'
import { worker } from './ps'
import { registerIpc, TITLEBAR, TITLEBAR_HEIGHT } from './ipc'
import { createTray, destroyTray, updateTray } from './tray'

let mainWindow: BrowserWindow | null = null
/** true solo al salir desde la bandeja o el sistema: cerrar la ventana la oculta. */
let quitting = false

function showWindow(): void {
  if (!mainWindow) return createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

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
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'resources', 'icon.png'),
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

  // Cerrar la ventana la manda a la bandeja: el Modo Juego sigue funcionando.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Verificación de los ajustes (npm run verify:tweaks): solo en desarrollo, sin ventana
// y con un backup.json temporal para no tocar el del usuario.
const verifyMode = app.isPackaged ? null : (process.env['OPTIKAX_VERIFY'] ?? null)

if (verifyMode === '1' || verifyMode === 'ai' || verifyMode === 'game') {
  app.setPath('userData', join(app.getPath('temp'), 'optikax-verify'))
  void app.whenReady().then(async () => {
    let code = 1
    try {
      if (verifyMode === 'game') {
        const { runGameVerification } = await import('./verify-game')
        code = await runGameVerification()
      } else if (verifyMode === 'ai') {
        const { runAiVerification } = await import('./verify-ai')
        code = await runAiVerification()
      } else {
        const { runVerification } = await import('./verify')
        code = await runVerification()
      }
    } catch (err) {
      console.error('[verify]', err)
    }
    worker.stop()
    app.exit(code)
  })
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.optikax.app')
    registerIpc(() => mainWindow)
    createWindow()
    createTray(showWindow)
    void startGameMode((status) => {
      updateTray(status)
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.gameModeChange, status)
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Con un juego abierto, se restaura el plan de energía antes de salir.
  app.on('before-quit', (e) => {
    quitting = true
    if (!hasActiveGame()) return
    e.preventDefault()
    void shutdownGameMode().finally(() => app.quit())
  })
  // La ventana se oculta en vez de cerrarse; la app solo termina desde la bandeja.
  app.on('window-all-closed', () => {})
  app.on('will-quit', () => {
    stopAutoClean()
    destroyTray()
    worker.stop()
  })
}
