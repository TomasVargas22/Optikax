import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import {
  IPC,
  type AppInfo,
  type DeepPartial,
  type PurgeKind,
  type Settings,
  type TitleBarTheme
} from '@shared/types'
import { analyze, cancelAnalysis, lastAnalysis, testApiKey } from './ai'
import { getHardware } from './hardware'
import { memoryState, onMemoryEvent, purge, PURGE_KINDS, syncAutoClean } from './memory'
import { native } from './native'
import { applyTweaks, listTweaks, revertTweaks, sanitizeIds } from './tweaks'
import { clearApiKey, getSettings, hasApiKey, setApiKey, updateSettings } from './store'

export const TITLEBAR = {
  oscuro: { color: '#010101', symbolColor: '#F4F4F6' },
  claro: { color: '#F4F4F6', symbolColor: '#010101' }
} as const

export const TITLEBAR_HEIGHT = 56

/** `net session` solo termina bien en un proceso elevado. */
function isElevated(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('net', ['session'], { windowsHide: true }, (err) => resolve(!err))
  })
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  let elevated: Promise<boolean> | null = null

  ipcMain.handle(IPC.appInfo, async (): Promise<AppInfo> => {
    elevated ??= isElevated()
    return { version: app.getVersion(), elevado: await elevated, empaquetado: app.isPackaged }
  })

  ipcMain.handle(IPC.titleBarTheme, (_e, theme: TitleBarTheme) => {
    const colors = TITLEBAR[theme]
    if (!colors) return
    getWindow()?.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT })
  })

  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: DeepPartial<Settings>) => {
    const next = updateSettings(patch)
    syncAutoClean()
    return next
  })

  ipcMain.handle(IPC.hardwareScan, (_e, force: unknown) =>
    getHardware(force === true, (p) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.hardwareProgress, p)
    })
  )

  // El renderer solo manda IDs; las rutas del registro viven en el catálogo del proceso principal.
  ipcMain.handle(IPC.tweaksList, () => listTweaks())
  ipcMain.handle(IPC.tweaksApply, (_e, ids: unknown) => applyTweaks(sanitizeIds(ids)))
  ipcMain.handle(IPC.tweaksRevert, (_e, ids: unknown) =>
    revertTweaks(ids === undefined || ids === null ? undefined : sanitizeIds(ids))
  )

  ipcMain.handle(IPC.memoryStats, () => native.memStats())
  ipcMain.handle(IPC.memoryState, () => memoryState())
  ipcMain.handle(IPC.memoryPurge, (_e, kind: PurgeKind) => {
    if (!PURGE_KINDS.includes(kind)) throw new Error('Tipo de limpieza no válido.')
    return purge(kind, 'manual')
  })
  onMemoryEvent((event) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.memoryEvent, event)
  })
  syncAutoClean()

  ipcMain.handle(IPC.apiKeyHas, () => hasApiKey())
  ipcMain.handle(IPC.apiKeySet, (_e, key: unknown) => {
    if (typeof key !== 'string') throw new Error('API key inválida.')
    setApiKey(key)
  })
  ipcMain.handle(IPC.apiKeyClear, () => clearApiKey())
  ipcMain.handle(IPC.apiKeyTest, () => testApiKey())

  ipcMain.handle(IPC.aiLast, () => lastAnalysis())
  ipcMain.handle(IPC.aiAnalyze, () =>
    analyze((p) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.aiProgress, p)
    })
  )
  ipcMain.handle(IPC.aiCancel, () => cancelAnalysis())
}
