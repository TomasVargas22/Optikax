import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiAnalysis, AiKeyTest, AiProgress, AiSource, HardwareProfile, TweakInfo } from '@shared/types'
import { emptyUsage, estimateCost, finalizeRecommendation, RecomendacionSchema, type UsageTotals } from './ai-schema'
import { getHardware } from './hardware'
import { readApiKey, writeAtomic } from './store'
import { listTweaks } from './tweaks'

/**
 * Análisis con IA, solo en el proceso principal (la clave nunca llega al renderer).
 * Paso 1: investigación con búsqueda web y streaming del progreso.
 * Paso 2: estructuración del informe con salida validada por esquema.
 * La IA solo elige entre IDs del catálogo; nunca se ejecuta nada que genere el modelo.
 */

const MODEL = 'claude-opus-5-5'
// Si el modelo declina por política, la API reintenta en un modelo de respaldo dentro de la misma llamada.
const BETAS = ['server-side-fallback-2026-07-01']
const MAX_CONTINUATIONS = 5

const SYSTEM_PROMPT = `Eres un experto en optimizar PCs con Windows para jugar. Recibes, en JSON, el hardware exacto de un equipo, el estado actual de los ajustes que la app Optikax puede aplicar y el catálogo de esos ajustes.

Tu trabajo es investigar en foros y fuentes reales (Reddit, Tom's Hardware, Guru3D, Blur Busters, Linus Tech Tips, foros de NVIDIA y AMD, documentación de Microsoft) cuál es la mejor configuración para gaming con *estos* componentes concretos, y escribir un informe con lo que encuentres.

Criterios:
- Da más peso al consenso y a las pruebas medibles (benchmarks, frametimes, latencia) que a las opiniones sueltas o los mitos de "optimización". Si algo está discutido, dilo.
- Busca por el modelo exacto de CPU, GPU y placa cuando importe (por ejemplo, HAGS con esa generación de GPU, XMP/EXPO con esa memoria, Resizable BAR con esa placa).
- Los ajustes ya activos no hace falta recomendarlos de nuevo, pero puedes decir si conviene mantenerlos.

Qué puedes recomendar:
- Para aplicar automáticamente, SOLO IDs del catálogo recibido. Para cada uno que aplique a este equipo, di si conviene o no y por qué, en concreto para este hardware. Los de riesgo medio solo recomiéndalos si hay un motivo claro para este equipo o sus juegos.
- Todo lo demás va como recomendación manual que el usuario hará por su cuenta: XMP/EXPO, Resizable BAR, versión de BIOS, drivers limpios con DDU, NVIDIA Reflex o AMD Anti-Lag, límite de FPS, G-Sync o FreeSync, ajustes del panel de la GPU, cambios de hardware.
- Umbrales para la limpieza automática de la memoria standby (MB), según la RAM del equipo.

Límites que no se negocian:
- Nunca sugieras desactivar servicios de Windows, Defender, el firewall, UAC, SmartScreen, VBS/HVCI (integridad de memoria) ni las mitigaciones de Spectre/Meltdown, ni tocar la configuración de arranque de Windows, ni "debloat".
- No escribas comandos ni claves de registro para que alguien los ejecute.

Escribe el informe en español, claro y sin relleno. Cita de dónde sale cada conclusión importante.`

const STRUCTURE_PROMPT = `Conviertes un informe de optimización de PC en datos estructurados para la app Optikax. Usa solo lo que dice el informe; no añadas recomendaciones nuevas. Escribe en español.
- "ajustes": un elemento por cada ajuste del catálogo que el informe trate, con aplicar=true si lo recomienda para este equipo y un motivo concreto de una o dos frases.
- "manuales": lo que el usuario tiene que hacer a mano, con su categoría e impacto.
- "ram": los umbrales que proponga el informe; si no propone ninguno, usa standby 1024 y libre 2048 por cada 16 GB de RAM.
- "advertencias": riesgos o avisos importantes del informe.`

export class AiError extends Error {}

// ---------- Estado ----------

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

function client(): Anthropic {
  const apiKey = readApiKey()
  if (!apiKey) throw new AiError('Configura tu API key de Anthropic en Ajustes para usar el análisis.')
  return new Anthropic({ apiKey })
}

/** Mensajes en español para los fallos de la API. Nunca incluyen la clave. */
function friendly(err: unknown): Error {
  if (err instanceof AiError) return err
  if (err instanceof Anthropic.APIUserAbortError) return new AiError('Análisis cancelado.')
  if (err instanceof Anthropic.AuthenticationError) return new AiError('La API key no es válida. Revísala en Ajustes.')
  if (err instanceof Anthropic.PermissionDeniedError)
    return new AiError('Tu cuenta de Anthropic no tiene acceso a este modelo o a la búsqueda web.')
  if (err instanceof Anthropic.RateLimitError) return new AiError('Anthropic limitó las peticiones. Prueba de nuevo en unos minutos.')
  if (err instanceof Anthropic.BadRequestError) return new AiError(`La API rechazó la petición: ${err.message}`)
  if (err instanceof Anthropic.InternalServerError) return new AiError('El servicio de Anthropic falló. Prueba de nuevo más tarde.')
  if (err instanceof Anthropic.APIConnectionError) return new AiError('No hay conexión con Anthropic. Revisa tu internet.')
  if (err instanceof Anthropic.APIError) return new AiError(`Error de la API (${err.status ?? '?'}): ${err.message}`)
  return err instanceof Error ? err : new Error(String(err))
}

function addUsage(totals: UsageTotals, usage: Anthropic.Beta.BetaUsage): void {
  totals.input += usage.input_tokens
  totals.output += usage.output_tokens
  totals.cacheWrite += usage.cache_creation_input_tokens ?? 0
  totals.cacheRead += usage.cache_read_input_tokens ?? 0
  totals.searches += usage.server_tool_use?.web_search_requests ?? 0
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

// ---------- Paso 1: investigación ----------

interface Research {
  report: string
  model: string
  sources: AiSource[]
  queries: string[]
}

async function research(
  api: Anthropic,
  input: string,
  usage: UsageTotals,
  signal: AbortSignal,
  emit: (p: AiProgress) => void
): Promise<Research> {
  const sources = new Map<string, AiSource>()
  const queries: string[] = []
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: input }]

  const collect = (block: Anthropic.Beta.BetaContentBlock): void => {
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const query = typeof block.input['query'] === 'string' ? block.input['query'] : ''
      if (query && !queries.includes(query)) {
        queries.push(query)
        emit({ kind: 'busqueda', query })
      }
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      // Un error de búsqueda llega como objeto, no como lista: se ignora.
      for (const r of block.content) {
        if (!sources.has(r.url)) {
          const source = { url: r.url, title: r.title || r.url }
          sources.set(r.url, source)
          emit({ kind: 'fuente', source })
        }
      }
    }
  }

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = api.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: BETAS,
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }],
        // Estable entre análisis: se puede cachear.
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages
      },
      { signal }
    )
    stream.on('contentBlock', collect)
    const msg = await stream.finalMessage()
    addUsage(usage, msg.usage)
    msg.content.forEach(collect)

    if (msg.stop_reason === 'pause_turn') {
      // La búsqueda en el servidor llegó a su límite de vueltas: se reenvía tal cual y continúa.
      messages.push({ role: 'assistant', content: msg.content })
      continue
    }
    if (msg.stop_reason === 'refusal') {
      throw new AiError('El modelo no pudo completar este análisis. Prueba de nuevo más tarde.')
    }
    const report = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (!report) {
      throw new AiError(
        msg.stop_reason === 'max_tokens'
          ? 'El informe se cortó antes de terminar. Prueba de nuevo.'
          : 'El modelo no devolvió un informe.'
      )
    }
    return { report, model: msg.model, sources: [...sources.values()], queries }
  }
  throw new AiError('La investigación tardó demasiado. Prueba de nuevo.')
}

// ---------- Paso 2: estructurar ----------

export async function structure(
  api: Anthropic,
  report: string,
  tweaks: TweakInfo[],
  usage: UsageTotals,
  signal?: AbortSignal
): Promise<unknown> {
  const catalogo = tweaks.map((t) => `- ${t.id}: ${t.titulo} (riesgo ${t.riesgo})`).join('\n')
  const msg = await api.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(RecomendacionSchema) },
      system: STRUCTURE_PROMPT,
      messages: [{ role: 'user', content: `Catálogo de ajustes:\n${catalogo}\n\nInforme:\n${report}` }]
    },
    { signal }
  )
  addUsage(usage, msg.usage)
  if (msg.stop_reason === 'refusal') throw new AiError('El modelo no pudo estructurar el informe. Prueba de nuevo.')
  if (!msg.parsed_output) throw new AiError('La respuesta del modelo no tenía el formato esperado. Prueba de nuevo.')
  return msg.parsed_output
}

// ---------- API pública ----------

export function analyze(emit: (p: AiProgress) => void): Promise<AiAnalysis> {
  if (running) return running.promise
  const abort = new AbortController()

  const promise = (async (): Promise<AiAnalysis> => {
    // Cede un tick: si client() lanzara en el acto, el finally se ejecutaría antes de que
    // `running` se asigne abajo y quedaría apuntando para siempre a una promesa rechazada.
    await Promise.resolve()
    try {
      const api = client()
      const [hw, tweaks] = await Promise.all([getHardware(false, () => {}), listTweaks()])
      const usage = emptyUsage()

      emit({ kind: 'fase', fase: 'investigando', text: 'Investigando en foros para tu hardware…' })
      const found = await research(api, researchInput(hw, tweaks), usage, abort.signal, emit)

      emit({ kind: 'fase', fase: 'estructurando', text: 'Ordenando las recomendaciones…' })
      const raw = await structure(api, found.report, tweaks, usage, abort.signal)
      const totalMB = (hw.derived.ram?.totalBytes ?? 16 * 2 ** 30) / 2 ** 20
      const { recomendacion, descartados } = finalizeRecommendation(raw, totalMB)

      const analysis: AiAnalysis = {
        createdAt: new Date().toISOString(),
        model: found.model,
        recomendacion,
        fuentes: found.sources,
        busquedas: found.queries,
        costoUSD: Math.round(estimateCost(usage) * 100) / 100,
        descartados
      }
      writeAtomic(cacheFile(), JSON.stringify(analysis, null, 2))
      return analysis
    } catch (err) {
      throw friendly(err)
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

/** Consulta el modelo en la API: valida la clave y el acceso sin generar tokens. */
export async function testApiKey(): Promise<AiKeyTest> {
  try {
    await client().models.retrieve(MODEL)
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: friendly(err).message }
  }
}
