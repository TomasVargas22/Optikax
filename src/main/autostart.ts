import { app } from 'electron'
import { execFile } from 'node:child_process'

/**
 * Inicio con Windows. Optikax pide administrador, y Windows no arranca solas las apps elevadas
 * que están en la clave Run del registro: por eso se usa una tarea programada al iniciar sesión
 * con privilegios máximos. Arranca con --hidden para quedarse en la bandeja.
 */

const TASK = 'Optikax'

function schtasks(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('schtasks.exe', args, { windowsHide: true }, (err, _out, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve()
    )
  })
}

export async function setAutostart(on: boolean): Promise<void> {
  if (!app.isPackaged) throw new Error('El inicio con Windows solo funciona en la app instalada.')
  if (on) {
    await schtasks(['/Create', '/F', '/TN', TASK, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/TR', `"${process.execPath}" --hidden`])
  } else {
    // Si la tarea no existe, no hay nada que quitar.
    await schtasks(['/Delete', '/F', '/TN', TASK]).catch(() => {})
  }
}

export const startHidden = (): boolean => process.argv.includes('--hidden')
