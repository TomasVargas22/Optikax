import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { setAutostart } from './autostart'
import { backup } from './tweaks/backup'
import { IPC, type AppInfo, type DeepPartial, type PurgeKind, type Settings, type TitleBarTheme } from '@shared/types'
import { gameModeStatus, syncGameMode } from './gamemode'
import { equipmentProfile } from './storage'
import { getHardware } from './hardware'
import { memoryState, onMemoryEvent, purge, PURGE_KINDS, syncAutoClean } from './memory'
import { native } from './native'
import { applyTweaks, listTweaks, revertTweaks, sanitizeIds } from './tweaks'
import { getSettings, onSettingsChange, updateSettings } from './store'

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
  onSettingsChange((s) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.settingsChanged, s)
  })
  ipcMain.handle(IPC.settingsUpdate, async (_e, patch: DeepPartial<Settings>) => {
    const before = getSettings().iniciarConWindows
    const next = updateSettings(patch)
    if (next.iniciarConWindows !== before) {
      try {
        await setAutostart(next.iniciarConWindows)
      } catch (err) {
        updateSettings({ iniciarConWindows: before })
        throw err
      }
    }
    syncAutoClean()
    syncGameMode()
    return getSettings()
  })

  // Copia de backup.json (los valores originales) donde el usuario elija.
  ipcMain.handle(IPC.backupExport, async (): Promise<string | null> => {
    if (!existsSync(backup.path())) throw new Error('Todavía no hay respaldo: Optikax no ha aplicado ningún ajuste.')
    const win = getWindow()
    const options = { defaultPath: 'optikax-respaldo.json', filters: [{ name: 'JSON', extensions: ['json'] }] }
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return null
    copyFileSync(backup.path(), r.filePath)
    return r.filePath
  })

  ipcMain.handle(IPC.gameModeStatus, () => gameModeStatus())
  ipcMain.handle(IPC.profileGet, (_e, force: unknown) => equipmentProfile(force === true))

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
}
