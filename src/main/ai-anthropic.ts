import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { AiSource } from '@shared/types'
import { AiError, STRUCTURE_PROMPT, SYSTEM_PROMPT, type AiEngine } from './ai-engine'
import { emptyUsage, estimateCost, RecomendacionSchema, type UsageTotals } from './ai-schema'

/**
 * Motor de Claude (Anthropic), el predeterminado.
 * Investigación: claude-opus-5-5 con thinking adaptativo, effort high, búsqueda web en streaming,
 * pause_turn y refusal. Si el modelo declina por política, la API reintenta en un modelo de
 * respaldo dentro de la misma llamada (fallbacks del servidor).
 * Estructuración: beta.messages.parse + betaZodOutputFormat (effort low).
 */

const MODEL = 'claude-opus-5-5'
const BETAS = ['server-side-fallback-2026-07-01']
const MAX_CONTINUATIONS = 5

function addUsage(totals: UsageTotals, usage: Anthropic.Beta.BetaUsage): void {
  totals.input += usage.input_tokens
  totals.output += usage.output_tokens
  totals.cacheWrite += usage.cache_creation_input_tokens ?? 0
  totals.cacheRead += usage.cache_read_input_tokens ?? 0
  totals.searches += usage.server_tool_use?.web_search_requests ?? 0
}

export function anthropicEngine(apiKey: string): AiEngine {
  const api = new Anthropic({ apiKey })
  const usage = emptyUsage()

  return {
    name: 'Claude',

    async research(input, signal, emit) {
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
            msg.stop_reason === 'max_tokens' ? 'El informe se cortó antes de terminar. Prueba de nuevo.' : 'El modelo no devolvió un informe.'
          )
        }
        return { report, model: msg.model, sources: [...sources.values()], queries }
      }
      throw new AiError('La investigación tardó demasiado. Prueba de nuevo.')
    },

    async structure(prompt, signal) {
      const msg = await api.beta.messages.parse(
        {
          model: MODEL,
          max_tokens: 16000,
          betas: BETAS,
          fallbacks: 'default',
          output_config: { effort: 'low', format: betaZodOutputFormat(RecomendacionSchema) },
          system: STRUCTURE_PROMPT,
          messages: [{ role: 'user', content: prompt }]
        },
        { signal }
      )
      addUsage(usage, msg.usage)
      if (msg.stop_reason === 'refusal') throw new AiError('El modelo no pudo estructurar el informe. Prueba de nuevo.')
      if (!msg.parsed_output) throw new AiError('La respuesta del modelo no tenía el formato esperado. Prueba de nuevo.')
      return msg.parsed_output
    },

    cost: () => estimateCost(usage),

    async test() {
      await api.models.retrieve(MODEL)
    },

    friendly(err) {
      if (err instanceof AiError) return err
      if (err instanceof Anthropic.APIUserAbortError) return new AiError('Análisis cancelado.')
      if (err instanceof Anthropic.AuthenticationError) return new AiError('La API key de Anthropic no es válida. Revísala en Ajustes.')
      if (err instanceof Anthropic.PermissionDeniedError)
        return new AiError('Tu cuenta de Anthropic no tiene acceso a este modelo o a la búsqueda web.')
      if (err instanceof Anthropic.RateLimitError) return new AiError('Anthropic limitó las peticiones. Prueba de nuevo en unos minutos.')
      if (err instanceof Anthropic.BadRequestError) return new AiError(`La API rechazó la petición: ${err.message}`)
      if (err instanceof Anthropic.InternalServerError) return new AiError('El servicio de Anthropic falló. Prueba de nuevo más tarde.')
      if (err instanceof Anthropic.APIConnectionError) return new AiError('No hay conexión con Anthropic. Revisa tu internet.')
      if (err instanceof Anthropic.APIError) return new AiError(`Error de la API (${err.status ?? '?'}): ${err.message}`)
      return err instanceof Error ? err : new Error(String(err))
    }
  }
}
