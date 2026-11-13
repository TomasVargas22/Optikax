import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TweakId } from '@shared/types'
import { writeAtomic } from '../store'

/**
 * Respaldo de los valores originales, en %APPDATA%\Optikax\backup.json.
 * Cada ajuste se guarda una sola vez: volver a aplicarlo no pisa el original.
 */

export interface BackupEntry {
  appliedAt: string
  data: unknown
}

interface BackupFile {
  version: 1
  /** Último punto de restauración creado (o confirmado como reciente) desde Optikax. */
  restorePointAt: string | null
  tweaks: Partial<Record<TweakId, BackupEntry>>
}

const file = (): string => join(app.getPath('userData'), 'backup.json')

let cache: BackupFile | null = null

function load(): BackupFile {
  if (cache) return cache
  cache = { version: 1, restorePointAt: null, tweaks: {} }
  if (existsSync(file())) {
    // Si el respaldo no se puede leer, no se sigue: aplicar encima perdería los valores originales.
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as BackupFile
    if (parsed.version !== 1 || typeof parsed.tweaks !== 'object') {
      cache = null
      throw new Error('El archivo de respaldo tiene un formato desconocido.')
    }
    cache = parsed
  }
  return cache
}

const save = (): void => writeAtomic(file(), JSON.stringify(load(), null, 2))

export const backup = {
  get: (id: TweakId): BackupEntry | undefined => load().tweaks[id],
  ids: (): TweakId[] => Object.keys(load().tweaks) as TweakId[],
  /** No hace nada si el ajuste ya tiene respaldo. */
  add(id: TweakId, data: unknown): boolean {
    const b = load()
    if (b.tweaks[id]) return false
    b.tweaks[id] = { appliedAt: new Date().toISOString(), data }
    save()
    return true
  },
  remove(id: TweakId): void {
    delete load().tweaks[id]
    save()
  },
  restorePointAt: (): string | null => load().restorePointAt,
  setRestorePointAt(iso: string): void {
    load().restorePointAt = iso
    save()
  },
  path: file
}
