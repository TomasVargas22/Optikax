import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from '@shared/types'

const dir = (): string => app.getPath('userData')
const settingsFile = (): string => join(dir(), 'settings.json')

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Mezcla `patch` sobre `base` solo en claves que existen en `base` y con el mismo tipo. */
function merge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, current] of Object.entries(base)) {
    const next = patch[k]
    if (next === undefined) continue
    if (isObject(current)) out[k] = merge(current, next)
    else if (Array.isArray(current)) {
      if (Array.isArray(next)) out[k] = next
    } else if (typeof next === typeof current) out[k] = next
  }
  return out as T
}

/** Escritura atómica: un corte de luz no deja el archivo a medias. */
export function writeAtomic(file: string, data: string | Buffer): void {
  mkdirSync(dir(), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  let stored: unknown = {}
  try {
    if (existsSync(settingsFile())) stored = JSON.parse(readFileSync(settingsFile(), 'utf8'))
  } catch {
    // Archivo corrupto: se arranca con los valores por defecto.
  }
  cache = merge(DEFAULT_SETTINGS, stored)
  return cache
}

const settingsListeners = new Set<(s: Settings) => void>()

/** Avisa de cada cambio, venga de la interfaz, de la bandeja o de otro módulo. */
export function onSettingsChange(cb: (s: Settings) => void): void {
  settingsListeners.add(cb)
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  cache = merge(getSettings(), patch)
  writeAtomic(settingsFile(), JSON.stringify(cache, null, 2))
  for (const cb of settingsListeners) cb(cache)
  return cache
}
