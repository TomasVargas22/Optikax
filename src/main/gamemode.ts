import { app, Notification } from 'electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ActiveGame, GameConflict, GameInfo, GameModeStatus, GameSession } from '@shared/types'
import { findConflicts, pickGame } from './game-detect'
import { onMemoryEvent, purge, setGameBoost } from './memory'
import { native } from './native'
import { getSettings, writeAtomic } from './store'
import { power, POWER_PLANS } from './tweaks/sys'

/**
 * Modo Juego automático: sondea los procesos cada 3 s y, al detectar un juego, sube su prioridad,
 * purga la memoria standby, pasa a un plan de alto rendimiento si el actual es de ahorro y activa la
 * limpieza agresiva. Al cerrar el juego deja todo como estaba. Funciona con la ventana cerrada.
 */

const POLL_MS = 3_000
const MAX_SESSIONS = 50

const { ULTIMATE, HIGH_PERFORMANCE, BALANCED, POWER_SAVER } = POWER_PLANS
/**
 * Solo se cambia el plan si el activo es uno de ahorro de Windows. Un plan propio (p. ej. uno de
 * alto rendimiento ajustado a mano o el de KernelOS) se respeta: no hay forma fiable de saber qué hace.
 */
const LOW_POWER_PLANS: readonly string[] = [BALANCED, POWER_SAVER]

interface Pending extends ActiveGame {
  /** Plan que había antes y el que puso Optikax; null si no se tocó. */
  powerFrom: string | null
  powerTo: string | null
  freedBytes: number
}

let current: Pending | null = null
let timer: NodeJS.Timeout | null = null
let polling = false
let conflicts: GameConflict[] = []
let notify: (s: GameModeStatus) => void = () => {}

const pendingFile = (): string => join(app.getPath('userData'), 'gamemode-pending.json')
const sessionsFile = (): string => join(app.getPath('userData'), 'game-sessions.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

/** Se guarda ANTES de cada cambio, para poder deshacerlo aunque la app se cierre de golpe. */
const savePending = (p: Pending): void => writeAtomic(pendingFile(), JSON.stringify(p, null, 2))
const clearPending = (): void => rmSync(pendingFile(), { force: true })

// El historial se lee del disco una vez y después vive en memoria.
let sessionsCache: GameSession[] | null = null

function sessions(): GameSession[] {
  sessionsCache ??= readJson<GameSession[]>(sessionsFile(), [])
  return sessionsCache
}

function addSession(s: GameSession): void {
  sessionsCache = [s, ...sessions()].slice(0, MAX_SESSIONS)
  writeAtomic(sessionsFile(), JSON.stringify(sessionsCache, null, 2))
}

const publicGame = (p: Pending): ActiveGame => ({
  pid: p.pid,
  name: p.name,
  path: p.path,
  motivo: p.motivo,
  startedAt: p.startedAt,
  acciones: [...p.acciones]
})

export async function gameModeStatus(): Promise<GameModeStatus> {
  // Con el modo apagado no hay sondeo: se miran los conflictos una vez al pedir el estado.
  if (!timer) conflicts = await native.listProcesses().then(findConflicts, () => conflicts)
  return {
    activo: getSettings().modoJuego.activo,
    juego: current ? publicGame(current) : null,
    sesiones: [...sessions()],
    conflictos: conflicts
  }
}

function emit(): void {
  void gameModeStatus().then(notify, () => {})
}

/** Vuelve al plan de antes, salvo que otro programa lo haya cambiado mientras tanto. */
async function restorePower(p: Pending): Promise<string | null> {
  if (!p.powerFrom || !p.powerTo) return null
  const st = await power.state()
  if (st.active !== p.powerTo) return 'Otro programa cambió el plan de energía durante el juego: no se tocó.'
  await power.setActive(st.schemes.includes(p.powerFrom) ? p.powerFrom : BALANCED)
  return 'Plan de energía restaurado.'
}

async function beginGame(game: GameInfo): Promise<void> {
  const p: Pending = { ...game, startedAt: new Date().toISOString(), acciones: [], powerFrom: null, powerTo: null, freedBytes: 0 }
  current = p
  savePending(p)

  // 1. Prioridad alta (nunca tiempo real). Si ya está por encima de normal, no se toca.
  try {
    const { priority } = await native.getPriority(p.pid)
    if (priority === 'Normal' || priority === 'BelowNormal' || priority === 'Idle') {
      await native.setPriority(p.pid, 'High')
      p.acciones.push('Prioridad alta')
    } else p.acciones.push(`Prioridad ya era ${priority}`)
  } catch {
    p.acciones.push('El juego no permite cambiar su prioridad')
  }

  // 2. Purga de la memoria standby (los MB se suman con el evento de memoria).
  try {
    await purge('standby', 'juego')
    p.acciones.push('Memoria standby purgada')
  } catch {
    p.acciones.push('No se pudo purgar la memoria')
  }

  // 3. Plan de alto rendimiento, solo si el activo es de ahorro.
  try {
    const st = await power.state()
    const target = st.schemes.includes(ULTIMATE) ? ULTIMATE : st.schemes.includes(HIGH_PERFORMANCE) ? HIGH_PERFORMANCE : null
    if (LOW_POWER_PLANS.includes(st.active) && target) {
      p.powerFrom = st.active
      p.powerTo = target
      savePending(p)
      await power.setActive(target)
      p.acciones.push('Plan de energía de alto rendimiento')
    } else if (!LOW_POWER_PLANS.includes(st.active)) {
      p.acciones.push('El plan de energía ya era de rendimiento')
    }
  } catch {
    p.powerFrom = p.powerTo = null
    p.acciones.push('No se pudo cambiar el plan de energía')
  }

  // 4. Limpieza automática agresiva mientras dure el juego.
  setGameBoost(true)
  p.acciones.push('Limpieza automática agresiva')
  savePending(p)

  if (Notification.isSupported()) {
    new Notification({ title: 'Modo Juego', body: `${p.name}: optimizado para jugar.`, silent: true }).show()
  }
  emit()
}

async function endGame(): Promise<void> {
  const p = current
  if (!p) return
  setGameBoost(false)
  const acciones = [...p.acciones]
  try {
    const note = await restorePower(p)
    if (note) acciones.push(note)
  } catch {
    acciones.push('No se pudo restaurar el plan de energía.')
  }
  const endedAt = new Date()
  addSession({
    game: p.name,
    startedAt: p.startedAt,
    endedAt: endedAt.toISOString(),
    durationSec: Math.round((endedAt.getTime() - new Date(p.startedAt).getTime()) / 1000),
    freedBytes: p.freedBytes,
    acciones
  })
  clearPending()
  current = null
  emit()
}

async function tick(): Promise<void> {
  if (polling) return
  polling = true
  try {
    const procs = await native.listProcesses()
    const found = findConflicts(procs)
    const changed = found.map((c) => c.name).join() !== conflicts.map((c) => c.name).join()
    conflicts = found
    if (changed) emit()
    if (current) {
      if (!procs.some((x) => x.pid === current!.pid)) await endGame()
      return
    }
    const fg = await native.foregroundPid().catch(() => null)
    const game = pickGame(procs, getSettings().modoJuego.juegosPersonalizados, fg)
    if (game) await beginGame(game)
  } catch {
    // Un fallo puntual del worker no debe parar el sondeo.
  } finally {
    polling = false
  }
}

/** Si la app se cerró con un juego abierto, deshace lo que quedó cambiado. */
export async function recoverPending(): Promise<void> {
  const p = readJson<Pending | null>(pendingFile(), null)
  if (!p) return
  try {
    await restorePower(p)
  } finally {
    clearPending()
  }
}

/** Arranca o detiene el sondeo según los ajustes. Llamar al iniciar y tras cada cambio. */
export function syncGameMode(): void {
  const on = getSettings().modoJuego.activo
  if (on && !timer) {
    timer = setInterval(() => void tick(), POLL_MS)
    void tick()
  } else if (!on && timer) {
    clearInterval(timer)
    timer = null
    void endGame()
  }
  emit()
}

export async function startGameMode(onChange: (s: GameModeStatus) => void): Promise<void> {
  notify = onChange
  onMemoryEvent((e) => {
    if (current && e.origin === 'juego') {
      current.freedBytes += e.freedBytes
      savePending(current)
    }
  })
  await recoverPending().catch(() => {})
  syncGameMode()
}

export const hasActiveGame = (): boolean => current !== null

/** Al salir de la app con un juego abierto: restaura antes de cerrar. */
export async function shutdownGameMode(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = null
  await endGame()
}
