import { runScript, worker } from '../ps'

/** Acceso de bajo nivel para los ajustes: registro, planes de energía, mouse y entorno. */

export type RegKind = 'DWord' | 'String' | 'ExpandString'

export interface RegRef {
  /** "HKLM\..." o "HKCU\...". */
  path: string
  name: string
}

export interface RegValue extends RegRef {
  keyExists: boolean
  exists: boolean
  /** Tipo real en el registro; puede ser uno que la app no maneja (Binary, MultiString…). */
  kind: string | null
  value: number | string | null
}

export type RegWrite =
  | (RegRef & { kind: RegKind; value: number | string })
  | (RegRef & { delete: true })
  | { path: string; name: ''; deleteKeyIfEmpty: true }

export interface RegWriteResult extends RegRef {
  ok: boolean
  keyCreated: boolean
  error: string | null
}

export const regKey = (ref: RegRef): string => `${ref.path}\\${ref.name}`.toLowerCase()

export async function regRead(items: RegRef[]): Promise<RegValue[]> {
  if (items.length === 0) return []
  return (await worker.request<{ items: RegValue[] }>('regRead', { items })).items
}

/** Lanza si alguna escritura falla; el mensaje nombra la primera. */
export async function regWrite(items: RegWrite[]): Promise<RegWriteResult[]> {
  if (items.length === 0) return []
  const { items: results } = await worker.request<{ items: RegWriteResult[] }>('regWrite', { items })
  const failed = results.find((r) => !r.ok)
  if (failed) throw new Error(`No se pudo escribir ${failed.path}\\${failed.name}: ${failed.error}`)
  return results
}

export interface PowerState {
  active: string
  schemes: string[]
}

/** GUID de los planes de energía de Windows (iguales en todos los idiomas). */
export const POWER_PLANS = {
  ULTIMATE: 'e9a42b02-d5df-448d-aa00-03f14749eb61',
  HIGH_PERFORMANCE: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  BALANCED: '381b4222-f694-41f0-9685-ff5bb260df2e',
  POWER_SAVER: 'a1841308-3541-4fab-bc81-f71556f20b4a'
} as const

// powercfg a veces tarda más de 10 s (otro programa tocando planes a la vez); no debe impedir restaurar.
const POWER_TIMEOUT_MS = 30_000

export const power = {
  state: () => worker.request<PowerState>('power', { op: 'state' }, POWER_TIMEOUT_MS),
  setActive: (guid: string) => worker.request<boolean>('power', { op: 'setActive', guid }, POWER_TIMEOUT_MS),
  duplicate: async (guid: string) =>
    (await worker.request<{ guid: string }>('power', { op: 'duplicate', guid }, POWER_TIMEOUT_MS)).guid,
  delete: (guid: string) => worker.request<boolean>('power', { op: 'delete', guid }, POWER_TIMEOUT_MS)
}

/** Aplica en vivo la aceleración del mouse: [umbral1, umbral2, aceleración]. */
export function setMouse(threshold1: number, threshold2: number, speed: number): Promise<number[]> {
  return worker.request<number[]>('setMouse', { threshold1, threshold2, speed })
}

export interface TweakEnv {
  /** null si no se pudo leer. */
  memoryCompression: boolean | null
  /** La tarjeta de red por la que sale el tráfico a internet. */
  nic: { guid: string; name: string } | null
}

let envCache: { at: number; value: Promise<TweakEnv> } | null = null
const ENV_TTL_MS = 60_000

/** Lectura lenta (≈1–2 s): se guarda un minuto. */
export function tweakEnv(): Promise<TweakEnv> {
  if (!envCache || Date.now() - envCache.at > ENV_TTL_MS) {
    const value = runScript<TweakEnv>('tweaks.ps1', { input: { action: 'env' } })
    envCache = { at: Date.now(), value }
    value.catch(() => (envCache = null))
  }
  return envCache.value
}

export async function setMemoryCompression(enable: boolean): Promise<boolean> {
  envCache = null
  const r = await runScript<{ memoryCompression: boolean }>('tweaks.ps1', {
    input: { action: 'memoryCompression', enable }
  })
  return r.memoryCompression
}

export interface RestorePointResult {
  status: 'creado' | 'reciente' | 'no_disponible'
  detail: string | null
  latest: { sequence: number; description: string; createdAt: string | null } | null
}

export function createRestorePoint(): Promise<RestorePointResult> {
  return runScript<RestorePointResult>('tweaks.ps1', { input: { action: 'restorePoint' }, timeoutMs: 180_000 })
}
