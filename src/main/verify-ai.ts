/**
 * Verificación del análisis IA sin API key (solo desarrollo): `npm run verify:ai`.
 * - Posprocesado del paso 2 con una salida simulada (fixtures/recomendacion-ejemplo.json).
 * - "Aplicar recomendados" con esa salida contra el catálogo real.
 * - Que el esquema se convierte en un formato de salida para la API.
 * - Mensajes de error sin clave y con una clave inválida (una petición sin coste a la API).
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { recommendedTweaks } from '@shared/types'
import { testApiKey } from './ai'
import { estimateCost, finalizeRecommendation, RecomendacionSchema } from './ai-schema'
import { hasApiKey } from './store'
import { listTweaks } from './tweaks'

export async function runAiVerification(): Promise<number> {
  const results: { caso: string; ok: boolean; detalle: string }[] = []
  const check = (caso: string, ok: boolean, detalle = ''): void => {
    results.push({ caso, ok, detalle })
    console.log(`[verify-ai] ${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? ` · ${detalle}` : ''}`)
  }

  // 1. Posprocesado de la salida simulada (16 GB de RAM).
  const raw = JSON.parse(readFileSync(join(app.getAppPath(), 'fixtures', 'recomendacion-ejemplo.json'), 'utf8')) as unknown
  const { recomendacion: r, descartados } = finalizeRecommendation(raw, 16 * 1024)
  check('descarta IDs fuera del catálogo', descartados.join() === 'disable_defender', descartados.join())
  const hags = r.ajustes.filter((a) => a.id === 'hags_on')
  check('quita duplicados y conserva el primero', hags.length === 1 && hags[0].aplicar, JSON.stringify(hags))
  check(
    'ajusta los umbrales de RAM a un rango sensato',
    r.ram.umbralStandbyMB === 256 && r.ram.umbralLibreMB === 8192,
    `standby ${r.ram.umbralStandbyMB}, libre ${r.ram.umbralLibreMB}`
  )
  check('limpia textos vacíos', r.resumen.startsWith('Equipo') && r.advertencias.length === 1)

  let rejected = false
  try {
    finalizeRecommendation({ ...(raw as object), perfil: 'gamer-pro' }, 16 * 1024)
  } catch {
    rejected = true
  }
  check('rechaza una salida que no cumple el esquema', rejected)

  // 2. "Aplicar recomendados" con la salida simulada contra el catálogo real.
  const tweaks = await listTweaks()
  const pending = new Set(tweaks.filter((t) => !t.activo && t.motivoNoAplica === null).map((t) => t.id))
  const ids = recommendedTweaks(tweaks, r.ajustes)
  check('no incluye riesgo medio sin motivo (network_throttling_off)', !ids.includes('network_throttling_off'), ids.join(', '))
  check('no incluye lo que la IA desaconseja (nagle_off)', !ids.includes('nagle_off'))
  check('solo incluye ajustes pendientes que aplican', ids.every((id) => pending.has(id)))
  const sinIa = recommendedTweaks(tweaks)
  check(
    'sin análisis solo entran los de riesgo bajo',
    sinIa.every((id) => tweaks.find((t) => t.id === id)?.riesgo === 'bajo'),
    sinIa.join(', ')
  )

  // 3. El esquema se puede enviar como formato de salida.
  const format = betaZodOutputFormat(RecomendacionSchema) as unknown as { type: string; schema: { properties?: object } }
  const props = Object.keys(format.schema?.properties ?? {})
  check('el esquema genera un json_schema válido', format.type === 'json_schema' && props.length === 6, props.join(', '))

  // 4. Estimación de coste: ~20 k de entrada, 8 k de salida y 10 búsquedas ≈ $0.34.
  const cost = estimateCost({ input: 20_000, output: 8_000, cacheWrite: 0, cacheRead: 0, searches: 10 })
  check('estimación de coste', Math.abs(cost - 0.34) < 0.001, `$${cost.toFixed(3)}`)

  // 5. Errores: sin clave, y con una clave inválida.
  if (!hasApiKey()) {
    const none = await testApiKey()
    check('sin clave pide configurarla', !none.ok && /Ajustes/.test(none.error ?? ''), none.error ?? '')
  }
  try {
    await new Anthropic({ apiKey: 'sk-ant-clave-invalida-de-prueba', maxRetries: 0 }).models.retrieve('claude-opus-5-5')
    check('una clave inválida da AuthenticationError', false, 'la API aceptó la clave')
  } catch (err) {
    check(
      'una clave inválida da AuthenticationError',
      err instanceof Anthropic.AuthenticationError,
      err instanceof Error ? err.constructor.name : String(err)
    )
  }

  return results.every((x) => x.ok) ? 0 : 1
}
