import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import type { GameModeStatus } from '@shared/types'
import { syncGameMode } from './gamemode'
import { getSettings, updateSettings } from './store'

/**
 * Icono en la bandeja: la app sigue viva con la ventana cerrada para que el Modo Juego funcione.
 * Menú: abrir, encender o apagar el Modo Juego, y salir de verdad.
 */

let tray: Tray | null = null
let lastStatus: GameModeStatus | null = null
let openWindow: () => void = () => {}

const iconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(app.getAppPath(), 'resources', 'tray.png')

function rebuild(): void {
  if (!tray) return
  const activo = getSettings().modoJuego.activo
  const juego = lastStatus?.juego?.name
  tray.setToolTip(juego ? `Optikax · jugando ${juego}` : activo ? 'Optikax · Modo Juego activo' : 'Optikax')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Optikax', click: () => openWindow() },
      { type: 'separator' },
      ...(juego ? [{ label: `Jugando: ${juego}`, enabled: false }] : []),
      {
        label: 'Modo Juego automático',
        type: 'checkbox',
        checked: activo,
        click: (item) => {
          updateSettings({ modoJuego: { activo: item.checked } })
          syncGameMode()
          rebuild()
        }
      },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() }
    ])
  )
}

export function createTray(onOpen: () => void): void {
  openWindow = onOpen
  tray = new Tray(nativeImage.createFromPath(iconPath()))
  tray.on('click', () => openWindow())
  rebuild()
}

/** Refresca el texto y el menú cuando cambia el estado del Modo Juego. */
export function updateTray(status: GameModeStatus): void {
  lastStatus = status
  rebuild()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
