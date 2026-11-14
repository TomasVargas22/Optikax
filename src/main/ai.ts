import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI_PROVIDER_LABEL,
  type AiAnalysis,
  type AiKeyTest,
  type AiProgress,
  type AiProvider,
  type HardwareProfile,
  type TweakInfo
} from '@shared/types'
import { anthropicEngine } from './ai-anthropic'
import { AiError, type AiEngine } from './ai-engine'
import { geminiEngine } from './ai-gemini'
import { finalizeRecommendation } from './ai-schema'
import { getHardware } from './hardware'
import { getSettings, readApiKey, writeAtomic } from './store'
import { listTweaks } from './tweaks'

/**
 * Análisis con IA, solo en el proceso principal (la clave nunca llega al renderer).
 * Paso 1: investigación con búsqueda web. Paso 2: estructuración con salida validada por esquema.
 * El proveedor (Claude o Gemini) se elige en Ajustes; la validación contra el catálogo es la misma
 * para los dos. La IA solo elige entre IDs del catálogo; nunca se ejecuta nada que genere el modelo.
 */

export { AiError }

interface Running {
  promise: Promise<AiAnalysis>
  abort: AbortController
}
let running: Running | null = null

const cacheFile = (): string => join(app.getPath('userData'), 'analysis.json')

export function lastAnalysis(): AiAnalysis | null {
  try {
    if (!existsSync(cacheFile())) return null
    return JSON.parse(readFileSync(cacheFile(), 'utf8')) as AiAnalysis
  } catch {
    return null
  }
}

function engine(provider: AiProvider): AiEngine {
  const apiKey = readApiKey(provider)
  if (!apiKey) throw new AiError(`Configura tu API key de ${AI_PROVIDER_LABEL[provider]} en Ajustes para usar el análisis.`)
  return provider === 'gemini' ? geminiEngine(apiKey) : anthropicEngine(apiKey)
}

/** Lo que se envía al modelo: el hardware sin errores internos y el estado del catálogo. */
function researchInput(hw: HardwareProfile, tweaks: TweakInfo[]): string {
  const { errors: _errors, scannedAt: _scannedAt, ...hardware } = hw
  const catalogo = tweaks.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    descripcion: t.descripcion,
    categoria: t.categoria,
    riesgo: t.riesgo,
    nota: t.nota,
    reinicio: t.reinicio,
    estado: t.motivoNoAplica ? `no aplica: ${t.motivoNoAplica}` : t.activo ? 'activo' : 'inactivo'
  }))
  return JSON.stringify({ hardware, catalogo })
}

function structurePrompt(report: string, tweaks: TweakInfo[]): string {
  const catalogo = tweaks.map((t) => `- ${t.id}: ${t.titulo} (riesgo ${t.riesgo})`).join('\n')
  return `Catálogo de ajustes:\n${catalogo}\n\nInforme:\n${report}`
}

export function analyze(emit: (p: AiProgress) => void): Promise<AiAnalysis> {
  if (running) return running.promise
  const abort = new AbortController()

  const promise = (async (): Promise<AiAnalysis> => {
    // Cede un tick: si engine() lanzara en el acto, el finally se ejecutaría antes de que
    // `running` se asigne abajo y quedaría apuntando para siempre a una promesa rechazada.
    await Promise.resolve()
    const provider = getSettings().ia.proveedor
    let eng: AiEngine | null = null
    try {
      eng = engine(provider)
      const [hw, tweaks] = await Promise.all([getHardware(false, () => {}), listTweaks()])

      emit({ kind: 'fase', fase: 'investigando', text: `${eng.name} está investigando en foros para tu hardware…` })
      const found = await eng.research(researchInput(hw, tweaks), abort.signal, emit)

      emit({ kind: 'fase', fase: 'estructurando', text: 'Ordenando las recomendaciones…' })
      const raw = await eng.structure(structurePrompt(found.report, tweaks), abort.signal)
      const totalMB = (hw.derived.ram?.totalBytes ?? 16 * 2 ** 30) / 2 ** 20
      const { recomendacion, descartados } = finalizeRecommendation(raw, totalMB)

      const analysis: AiAnalysis = {
        createdAt: new Date().toISOString(),
        model: found.model,
        proveedor: provider,
        recomendacion,
        fuentes: found.sources,
        busquedas: found.queries,
        costoUSD: Math.round(eng.cost() * 100) / 100,
        descartados
      }
      writeAtomic(cacheFile(), JSON.stringify(analysis, null, 2))
      return analysis
    } catch (err) {
      throw eng ? eng.friendly(err) : err
    } finally {
      // Solo se suelta si sigue siendo esta ejecución (el cast evita el estrechamiento a never).
      if ((running as Running | null)?.abort === abort) running = null
    }
  })()

  running = { promise, abort }
  return promise
}

export function cancelAnalysis(): void {
  running?.abort.abort()
}

/** Valida la clave del proveedor y el acceso al modelo sin generar tokens. */
export async function testApiKey(provider: AiProvider): Promise<AiKeyTest> {
  let eng: AiEngine | null = null
  try {
    eng = engine(provider)
    await eng.test()
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: (eng ? eng.friendly(err) : (err as Error)).message }
  }
}
