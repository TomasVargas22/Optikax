import type {
  MemoryEvent,
  MemoryState,
  PurgeKind,
  PurgeOrigin,
  PurgeResult
} from '@shared/types'
import { native } from './native'
import { getSettings } from './store'

const MB = 2 ** 20
const CHECK_MS = 5_000
/** Tiempo mínimo entre dos limpiezas automáticas, para no purgar en bucle. */
const MIN_GAP_MS = 30_000
const MAX_EVENTS = 50

export const PURGE_KINDS: readonly PurgeKind[] = ['standby', 'standbyLow', 'workingSets', 'modified']

const events: MemoryEvent[] = []
const listeners = new Set<(e: MemoryEvent) => void>()
let timer: NodeJS.Timeout | null = null
let lastAuto = 0
let purging = false
let totalBytes = 0

export function onMemoryEvent(cb: (e: MemoryEvent) => void): void {
  listeners.add(cb)
}

function record(event: MemoryEvent): MemoryEvent {
  events.unshift(event)
  events.length = Math.min(events.length, MAX_EVENTS)
  for (const cb of listeners) cb(event)
  return event
}

/** Cuánta memoria recuperó la limpieza, según qué lista vacía cada tipo. */
export function freedBytes(r: PurgeResult): number {
  const diff =
    r.kind === 'workingSets'
      ? r.after.availBytes - r.before.availBytes // pasa de "en uso" a disponible
      : r.kind === 'modified'
        ? r.before.modifiedBytes - r.after.modifiedBytes
        : r.before.standbyBytes - r.after.standbyBytes
  return Math.max(0, diff)
}

export async function purge(kind: PurgeKind, origin: PurgeOrigin): Promise<MemoryEvent> {
  if (purging) throw new Error('Ya hay una limpieza en curso.')
  purging = true
  try {
    const result = await native.purge(kind)
    totalBytes = result.after.totalBytes
    return record({ at: new Date().toISOString(), kind, origin, freedBytes: freedBytes(result) })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    record({ at: new Date().toISOString(), kind, origin, freedBytes: 0, error })
    throw err
  } finally {
    purging = false
  }
}

/** Umbrales por defecto al estilo ISLC: con 16 GB, standby ≥ 1024 MB y libre < 2048 MB. */
export function defaultThresholds(total: number): { standbyMB: number; libreMB: number } {
  const totalMB = total / MB
  const step = (v: number): number => Math.round(v / 256) * 256
  const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
  return {
    standbyMB: clamp(step(totalMB / 16), 512, 4096),
    libreMB: clamp(step(totalMB / 8), 1024, 8192)
  }
}

function thresholds(): { standbyMB: number; libreMB: number; automaticos: boolean } {
  const { umbralStandbyMB, umbralLibreMB } = getSettings().ram
  const auto = defaultThresholds(totalBytes || 16 * 1024 * MB)
  return {
    standbyMB: umbralStandbyMB > 0 ? umbralStandbyMB : auto.standbyMB,
    libreMB: umbralLibreMB > 0 ? umbralLibreMB : auto.libreMB,
    automaticos: umbralStandbyMB <= 0 && umbralLibreMB <= 0
  }
}

export async function memoryState(): Promise<MemoryState> {
  if (!totalBytes) totalBytes = (await native.memStats()).totalBytes
  const t = thresholds()
  return {
    autoLimpieza: getSettings().ram.autoLimpieza,
    umbralStandbyMB: t.standbyMB,
    umbralLibreMB: t.libreMB,
    umbralesAutomaticos: t.automaticos,
    events: [...events]
  }
}

async function autoCheck(): Promise<void> {
  if (purging || Date.now() - lastAuto < MIN_GAP_MS) return
  try {
    const m = await native.memStats()
    totalBytes = m.totalBytes
    const t = thresholds()
    if (m.standbyBytes >= t.standbyMB * MB && m.freeBytes < t.libreMB * MB) {
      lastAuto = Date.now()
      await purge('standby', 'auto')
    }
  } catch {
    // Un fallo puntual (worker reiniciándose) no debe tumbar el temporizador.
  }
}

/** Arranca o detiene la limpieza automática según los ajustes. Llamar al iniciar y tras cada cambio. */
export function syncAutoClean(): void {
  const enabled = getSettings().ram.autoLimpieza
  if (enabled && !timer) {
    timer = setInterval(() => void autoCheck(), CHECK_MS)
    void autoCheck()
  } else if (!enabled && timer) {
    clearInterval(timer)
    timer = null
  }
}

export function stopAutoClean(): void {
  if (timer) clearInterval(timer)
  timer = null
}
