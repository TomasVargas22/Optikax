import type { AiProgress, AiSource } from '@shared/types'

/**
 * Lo común a los proveedores de IA: la interfaz de un "motor" y los prompts.
 * Cada motor hace los mismos dos pasos (investigar con búsqueda web y estructurar en JSON), y
 * la validación final contra el catálogo vive fuera, en ai-schema.ts, igual para todos.
 */

export class AiError extends Error {}

export interface Research {
  report: string
  model: string
  sources: AiSource[]
  queries: string[]
}

export interface AiEngine {
  /** Para los mensajes: "Claude", "Gemini". */
  name: string
  research(input: string, signal: AbortSignal, emit: (p: AiProgress) => void): Promise<Research>
  /** Devuelve el JSON sin validar; lo valida finalizeRecommendation. */
  structure(prompt: string, signal: AbortSignal): Promise<unknown>
  /** Coste estimado en USD de todo lo hecho con este motor. */
  cost(): number
  /** Valida la clave sin generar tokens. */
  test(): Promise<void>
  /** Mensaje en español para un fallo de la API. Nunca incluye la clave. */
  friendly(err: unknown): Error
}

export const SYSTEM_PROMPT = `Eres un experto en optimizar PCs con Windows para jugar. Recibes, en JSON, el hardware exacto de un equipo, el estado actual de los ajustes que la app Optikax puede aplicar y el catálogo de esos ajustes.

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

export const STRUCTURE_PROMPT = `Conviertes un informe de optimización de PC en datos estructurados para la app Optikax. Usa solo lo que dice el informe; no añadas recomendaciones nuevas. Escribe en español.
- "ajustes": un elemento por cada ajuste del catálogo que el informe trate, con aplicar=true si lo recomienda para este equipo y un motivo concreto de una o dos frases.
- "manuales": lo que el usuario tiene que hacer a mano, con su categoría e impacto.
- "ram": los umbrales que proponga el informe; si no propone ninguno, usa standby 1024 y libre 2048 por cada 16 GB de RAM.
- "advertencias": riesgos o avisos importantes del informe.`
