import type { EquipmentProfile, StorageInfo } from '@shared/types'
import { getHardware } from './hardware'
import { buildProfile } from './profile'
import { runScript } from './ps'
import { listTweaks } from './tweaks'

/** Unidades, juegos instalados y TRIM (resources/scripts/storage.ps1, solo lectura). */
let cache: Promise<StorageInfo> | null = null

export function getStorage(force = false): Promise<StorageInfo> {
  if (!cache || force) {
    cache = runScript<StorageInfo>('storage.ps1', { timeoutMs: 60_000 })
    cache.catch(() => (cache = null))
  }
  return cache
}

/** Perfil del equipo: recomendaciones por componente con el estado real de los ajustes. */
export async function equipmentProfile(force = false): Promise<EquipmentProfile> {
  const [hw, storage, tweaks] = await Promise.all([
    getHardware(force, () => {}),
    getStorage(force).catch(() => null),
    listTweaks()
  ])
  return buildProfile(hw, storage, tweaks)
}
