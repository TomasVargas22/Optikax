import * as z from 'zod/v4'
import {
  AI_PROFILES,
  MANUAL_CATEGORIES,
  TWEAK_IDS,
  type AiRecommendation,
  type TweakId,
  type TweakRecommendation
} from '@shared/types'

/**
 * Esquema del paso de estructuración. Los IDs de ajuste son un enum del catálogo:
 * el modelo no puede inventar otros, y aun así se vuelven a filtrar en código.
 * Sin min/max en los números: los límites se aplican en `finalizeRecommendation`.
 */
export const RecomendacionSchema = z.object({
  resumen: z.string().describe('Dos o tres frases sobre el equipo y lo que más le conviene.'),
  perfil: z.enum(AI_PROFILES),
  ajustes: z.array(
    z.object({
      id: z.enum(TWEAK_IDS),
      aplicar: z.boolean(),
      motivo: z.string().describe('Por qué sí o por qué no, concreto para este hardware.')
    })
  ),
  manuales: z.array(
    z.object({
      titulo: z.string(),
      detalle: z.string(),
      categoria: z.enum(MANUAL_CATEGORIES),
      impacto: z.enum(['alto', 'medio', 'bajo'])
    })
  ),
  ram: z.object({
    autoLimpieza: z.boolean(),
    umbralStandbyMB: z.number().int(),
    umbralLibreMB: z.number().int()
  }),
  advertencias: z.array(z.string())
})

export type RecomendacionRaw = z.infer<typeof RecomendacionSchema>

const MIN_THRESHOLD_MB = 256

/**
 * Última barrera antes de guardar: descarta IDs fuera del catálogo o repetidos
 * y deja los umbrales de RAM dentro de un rango que tenga sentido para el equipo.
 */
export function finalizeRecommendation(
  raw: unknown,
  totalRamMB: number
): { recomendacion: AiRecommendation; descartados: string[] } {
  // Primero se apartan los IDs que no son del catálogo; después se valida el resto.
  const descartados: string[] = []
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as { ajustes?: unknown }
  const known = (Array.isArray(input.ajustes) ? input.ajustes : []).filter((a: unknown) => {
    const id = (a as { id?: unknown } | null)?.id
    const ok = TWEAK_IDS.includes(id as TweakId)
    if (!ok) descartados.push(String(id))
    return ok
  })
  const r = RecomendacionSchema.parse({ ...input, ajustes: known })

  const seen = new Set<TweakId>()
  const ajustes: TweakRecommendation[] = []
  for (const a of r.ajustes) {
    if (seen.has(a.id)) continue
    seen.add(a.id)
    ajustes.push({ id: a.id, aplicar: a.aplicar, motivo: a.motivo.trim() })
  }

  const max = Math.max(MIN_THRESHOLD_MB, Math.round(totalRamMB / 2))
  const clamp = (n: number): number => Math.min(max, Math.max(MIN_THRESHOLD_MB, Math.round(n)))

  return {
    recomendacion: {
      resumen: r.resumen.trim(),
      perfil: r.perfil,
      ajustes,
      manuales: r.manuales,
      ram: {
        autoLimpieza: r.ram.autoLimpieza,
        umbralStandbyMB: clamp(r.ram.umbralStandbyMB),
        umbralLibreMB: clamp(r.ram.umbralLibreMB)
      },
      advertencias: r.advertencias.map((a) => a.trim()).filter(Boolean)
    },
    descartados
  }
}

/** Precios de Claude Opus 5.5 (USD por millón de tokens) y de la búsqueda web (por búsqueda). */
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2, search: 0.01 }

export interface UsageTotals {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  searches: number
}

export const emptyUsage = (): UsageTotals => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0 })

/** Estimación: si respondió un modelo de respaldo, su precio puede ser distinto. */
export function estimateCost(u: UsageTotals): number {
  const tokens =
    u.input * PRICE.input + u.output * PRICE.output + u.cacheWrite * PRICE.cacheWrite + u.cacheRead * PRICE.cacheRead
  return tokens / 1e6 + u.searches * PRICE.search
}
