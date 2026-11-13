import {
  TWEAK_IDS,
  type RestorePointInfo,
  type TweakActionResult,
  type TweakId,
  type TweakInfo
} from '@shared/types'
import { getHardware } from '../hardware'
import { backup } from './backup'
import { CATALOG, TWEAKS, type TweakContext } from './catalog'
import { createRestorePoint, power, regKey, regRead, tweakEnv, type RegValue } from './sys'

const DAY_MS = 24 * 60 * 60 * 1000

async function context(): Promise<TweakContext> {
  const [hw, env, powerState] = await Promise.all([getHardware(false, () => {}), tweakEnv(), power.state()])
  return { hw, env, power: powerState }
}

async function describe(ctx: TweakContext): Promise<TweakInfo[]> {
  const values = await regRead(CATALOG.flatMap((t) => t.lecturas(ctx)))
  const reg = new Map<string, RegValue>(values.map((v) => [regKey(v), v]))

  return CATALOG.map((t) => {
    const entry = backup.get(t.id)
    return {
      id: t.id,
      titulo: t.titulo,
      descripcion: t.descripcion,
      categoria: t.categoria,
      riesgo: t.riesgo,
      reinicio: t.reinicio,
      motivoNoAplica: t.motivoNoAplica(ctx),
      activo: t.activo(ctx, reg, entry?.data),
      revertible: entry !== undefined,
      aplicadoEn: entry?.appliedAt ?? null
    }
  })
}

export async function listTweaks(): Promise<TweakInfo[]> {
  return describe(await context())
}

/** Solo IDs del catálogo y sin repetir: lo demás se descarta sin más. */
export function sanitizeIds(ids: unknown): TweakId[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids)].filter((id): id is TweakId => TWEAK_IDS.includes(id as TweakId))
}

// Una sola operación a la vez: dos escrituras cruzadas podrían guardar un respaldo falso.
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function ensureRestorePoint(): Promise<RestorePointInfo> {
  const last = backup.restorePointAt()
  if (last && Date.now() - new Date(last).getTime() < DAY_MS) return { status: 'omitido', detail: null }
  try {
    const r = await createRestorePoint()
    if (r.status !== 'no_disponible') backup.setRestorePointAt(new Date().toISOString())
    return { status: r.status, detail: r.detail }
  } catch (err) {
    // Sin punto de restauración se sigue igual: el respaldo propio permite revertir.
    return { status: 'no_disponible', detail: message(err) }
  }
}

export function applyTweaks(ids: TweakId[]): Promise<TweakActionResult> {
  return exclusive(async () => {
    let ctx = await context()
    const before = new Map((await describe(ctx)).map((t) => [t.id, t]))
    const pending = ids.filter((id) => {
      const info = before.get(id)
      return info && !info.activo && info.motivoNoAplica === null
    })
    const restorePoint = pending.length > 0 ? await ensureRestorePoint() : null

    const results: TweakActionResult['results'] = []
    for (const id of ids) {
      const info = before.get(id)!
      if (info.motivoNoAplica !== null) {
        results.push({ id, ok: false, error: info.motivoNoAplica })
        continue
      }
      if (info.activo) {
        results.push({ id, ok: true, error: null })
        continue
      }
      const tweak = TWEAKS.get(id)!
      let added = false
      let data: unknown
      try {
        data = backup.get(id)?.data
        if (data === undefined) {
          data = await tweak.respaldar(ctx)
          added = backup.add(id, data)
        }
        await tweak.aplicar(ctx, data)
        // aplicar puede completar el respaldo (p. ej. el GUID del plan creado).
        if (added) {
          backup.remove(id)
          backup.add(id, data)
        }
        results.push({ id, ok: true, error: null })
      } catch (err) {
        if (added) {
          // Se deshace lo que haya quedado a medias antes de soltar el respaldo.
          await tweak.revertir(data).then(
            () => backup.remove(id),
            () => {}
          )
        }
        results.push({ id, ok: false, error: message(err) })
      }
    }

    ctx = await context()
    return { restorePoint, results, tweaks: await describe(ctx) }
  })
}

/** Sin ids, revierte todo lo que Optikax aplicó. */
export function revertTweaks(ids?: TweakId[]): Promise<TweakActionResult> {
  return exclusive(async () => {
    const targets = (ids ?? backup.ids()).filter((id) => TWEAKS.has(id))
    const results: TweakActionResult['results'] = []
    for (const id of targets) {
      const entry = backup.get(id)
      if (!entry) {
        results.push({ id, ok: false, error: 'Optikax no aplicó este ajuste: no hay un valor original que restaurar.' })
        continue
      }
      try {
        await TWEAKS.get(id)!.revertir(entry.data)
        backup.remove(id)
        results.push({ id, ok: true, error: null })
      } catch (err) {
        results.push({ id, ok: false, error: message(err) })
      }
    }
    return { restorePoint: null, results, tweaks: await describe(await context()) }
  })
}
