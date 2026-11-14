import { ApiError, GoogleGenAI } from '@google/genai'
import * as z from 'zod/v4'
import type { AiSource } from '@shared/types'
import { AiError, STRUCTURE_PROMPT, SYSTEM_PROMPT, type AiEngine } from './ai-engine'
import { RecomendacionSchema } from './ai-schema'

/**
 * Motor de Gemini (Google), alternativa a Claude. Usa la Interactions API de @google/genai 3.3.
 * Investigación: gemini-4-carbon (el modelo de razonamiento más capaz de la API) con Grounding
 * with Google Search y thinking alto. Estructuración: respuesta JSON validada contra el mismo
 * esquema que usa Claude (convertido a JSON Schema), con thinking bajo.
 * store: false → Google no guarda las conversaciones; la continuación automática reenvía la entrada.
 */

const MODEL = 'gemini-4-carbon'

/**
 * Precios publicados para gemini-4-carbon (USD por millón de tokens, nivel de pago) hasta el
 * 30/11/2026; desde el 1/12/2026 pasan a 4 / 20. La búsqueda: 14 USD por 1.000 consultas tras las
 * 5.000 gratuitas al mes. Se cuentan todas como de pago: es una estimación por arriba.
 */
const PRICE = { input: 2, output: 10, search: 0.014 }

/** El esquema de Optikax como JSON Schema para `response_format`. */
export function jsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(RecomendacionSchema) as Record<string, unknown>
  return schema
}

interface GeminiUsage {
  total_input_tokens?: number
  total_output_tokens?: number
  total_thought_tokens?: number
}

export function geminiEngine(apiKey: string): AiEngine {
  const ai = new GoogleGenAI({ apiKey })
  const totals = { input: 0, output: 0, searches: 0 }
  const addUsage = (u: GeminiUsage | undefined): void => {
    totals.input += u?.total_input_tokens ?? 0
    // El razonamiento se cobra como salida.
    totals.output += (u?.total_output_tokens ?? 0) + (u?.total_thought_tokens ?? 0)
  }

  return {
    name: 'Gemini',

    async research(input, signal, emit) {
      const interaction = await ai.interactions.create(
        {
          model: MODEL,
          system_instruction: SYSTEM_PROMPT,
          input,
          tools: [{ type: 'google_search' }],
          generation_config: { thinking_level: 'high' },
          store: false
        },
        { fetch_options: { signal } }
      )
      addUsage(interaction.usage)
      if (interaction.status !== 'completed') {
        throw new AiError(`Gemini no terminó el análisis (estado: ${interaction.status}). Prueba de nuevo.`)
      }

      // Consultas: pasos google_search_call. Fuentes: citas url_citation del texto final.
      const queries: string[] = []
      const sources = new Map<string, AiSource>()
      for (const step of interaction.steps) {
        if (step.type === 'google_search_call') {
          for (const q of step.arguments.queries ?? []) {
            if (q && !queries.includes(q)) {
              queries.push(q)
              emit({ kind: 'busqueda', query: q })
            }
          }
        } else if (step.type === 'model_output') {
          for (const block of step.content ?? []) {
            if (block.type !== 'text') continue
            for (const a of block.annotations ?? []) {
              if (a.type === 'url_citation' && a.url && !sources.has(a.url)) {
                const source = { url: a.url, title: a.title || a.url }
                sources.set(a.url, source)
                emit({ kind: 'fuente', source })
              }
            }
          }
        }
      }
      totals.searches += queries.length

      const report = (interaction.output_text ?? '').trim()
      if (!report) throw new AiError('Gemini no devolvió un informe. Prueba de nuevo.')
      return { report, model: interaction.model ?? MODEL, sources: [...sources.values()], queries }
    },

    async structure(prompt, signal) {
      const interaction = await ai.interactions.create(
        {
          model: MODEL,
          system_instruction: STRUCTURE_PROMPT,
          input: prompt,
          response_format: { type: 'text', mime_type: 'application/json', schema: jsonSchema() },
          generation_config: { thinking_level: 'low' },
          store: false
        },
        { fetch_options: { signal } }
      )
      addUsage(interaction.usage)
      try {
        return JSON.parse(interaction.output_text ?? '') as unknown
      } catch {
        throw new AiError('La respuesta de Gemini no tenía el formato esperado. Prueba de nuevo.')
      }
    },

    cost: () => (totals.input * PRICE.input + totals.output * PRICE.output) / 1e6 + totals.searches * PRICE.search,

    async test() {
      await ai.models.get({ model: MODEL })
    },

    friendly(err) {
      if (err instanceof AiError) return err
      if (err instanceof Error && err.name === 'AbortError') return new AiError('Análisis cancelado.')
      if (err instanceof ApiError) {
        if (err.status === 400 && /api key/i.test(err.message)) return new AiError('La API key de Gemini no es válida. Revísala en Ajustes.')
        if (err.status === 401 || err.status === 403)
          return new AiError('Tu clave de Gemini no tiene acceso a este modelo o a la búsqueda en Google.')
        if (err.status === 404) return new AiError(`El modelo ${MODEL} no está disponible para tu clave de Gemini.`)
        if (err.status === 429) return new AiError('Google limitó las peticiones (o se acabó la cuota gratuita). Prueba más tarde.')
        if (err.status >= 500) return new AiError('El servicio de Gemini falló. Prueba de nuevo más tarde.')
        return new AiError(`Error de la API de Gemini (${err.status}): ${err.message}`)
      }
      if (err instanceof TypeError && /fetch/i.test(err.message)) return new AiError('No hay conexión con Google. Revisa tu internet.')
      return err instanceof Error ? err : new Error(String(err))
    }
  }
}
