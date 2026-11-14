import { useEffect, useState } from 'react'
import {
  recommendedTweaks,
  type AiAnalysis,
  type AiProgress,
  type ManualCategory,
  type TweakInfo
} from '@shared/types'
import { errorMessage } from './errors'

const CATEGORY: Record<ManualCategory, string> = {
  bios: 'BIOS',
  drivers: 'Drivers',
  panel_gpu: 'Panel de la GPU',
  juego: 'En el juego',
  hardware: 'Hardware',
  windows: 'Windows'
}

const PERFIL = { entrada: 'Gama de entrada', media: 'Gama media', alta: 'Gama alta', entusiasta: 'Entusiasta' } as const

const dateText = (iso: string): string =>
  new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })

/** Pantalla Análisis IA: funcional; el carrusel y la animación de escaneo llegan en la fase de interfaz. */
export function Analisis({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null)
  const [tweaks, setTweaks] = useState<TweakInfo[] | null>(null)
  const [running, setRunning] = useState(false)
  const [feed, setFeed] = useState<AiProgress[]>([])
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)

  useEffect(() => {
    void window.optikax.apiKey.has().then(setHasKey)
    void window.optikax.ai.last().then(setAnalysis)
    window.optikax.tweaks.list().then(setTweaks, () => setTweaks([]))
    return window.optikax.ai.onProgress((p) => setFeed((prev) => [...prev, p]))
  }, [])

  const start = (): void => {
    setRunning(true)
    setError(null)
    setApplied(null)
    setFeed([])
    window.optikax.ai
      .analyze()
      .then(setAnalysis)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setRunning(false))
  }

  const toApply = analysis && tweaks ? recommendedTweaks(tweaks, analysis.recomendacion.ajustes) : []
  const applyRecommended = (): void => {
    setError(null)
    window.optikax.tweaks
      .apply(toApply)
      .then((r) => {
        setTweaks(r.tweaks)
        const ok = r.results.filter((x) => x.ok).length
        const fails = r.results.filter((x) => !x.ok).map((x) => `${x.id}: ${x.error}`)
        setApplied(`${ok} ajuste${ok === 1 ? '' : 's'} aplicado${ok === 1 ? '' : 's'}.${fails.length ? ` Fallaron: ${fails.join('; ')}` : ''}`)
      })
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const useRamThresholds = (): void => {
    if (!analysis) return
    const { autoLimpieza, umbralStandbyMB, umbralLibreMB } = analysis.recomendacion.ram
    window.optikax.settings
      .update({ ram: { autoLimpieza, umbralStandbyMB, umbralLibreMB } })
      .then(() => setApplied('Umbrales de memoria guardados.'))
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const titulo = (id: string): string => tweaks?.find((t) => t.id === id)?.titulo ?? id
  const searches = feed.filter((p): p is Extract<AiProgress, { kind: 'busqueda' }> => p.kind === 'busqueda')
  const phase = [...feed].reverse().find((p): p is Extract<AiProgress, { kind: 'fase' }> => p.kind === 'fase')
  const sourcesFound = feed.filter((p) => p.kind === 'fuente').length

  return (
    <>
      <section className="block">
        <div className="block-head">
          <p className="eyebrow">
            {analysis ? `Último análisis · ${dateText(analysis.createdAt)}` : 'Sin análisis todavía'}
          </p>
          <div className="toolbar">
            {running ? (
              <button type="button" className="pill" onClick={() => void window.optikax.ai.cancel()}>
                Cancelar
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={!hasKey} onClick={start}>
                {analysis ? 'Re-analizar' : 'Analizar mi equipo'}
              </button>
            )}
          </div>
        </div>
        <p className="lede">
          Usa Claude con búsqueda web. Coste estimado: ≈ $0.10–0.40 por análisis, que se cobra en tu cuenta de Anthropic.
        </p>

        <div aria-live="polite">
          {hasKey === false && (
            <p className="notice">
              Para analizar necesitas una API key de Anthropic.{' '}
              <button type="button" className="link" onClick={onOpenSettings}>
                Configurarla en Ajustes
              </button>
            </p>
          )}
          {error && <p className="notice" data-kind="error">{error}</p>}
          {applied && <p className="notice" data-kind="ok">{applied}</p>}
          {running && (
            <div className="notice">
              <p>
                <b>{phase?.text ?? 'Preparando…'}</b> {sourcesFound > 0 && `${sourcesFound} fuentes encontradas.`}
              </p>
              {searches.map((s) => (
                <p key={s.query}>Buscando: {s.query}</p>
              ))}
            </div>
          )}
        </div>
      </section>

      {analysis && !running && (
        <>
          <section className="block">
            <p className="eyebrow">
              {PERFIL[analysis.recomendacion.perfil]} · coste ≈ ${analysis.costoUSD.toFixed(2)} · {analysis.busquedas.length}{' '}
              búsquedas
            </p>
            <p className="lede">{analysis.recomendacion.resumen}</p>
            {analysis.recomendacion.advertencias.map((a) => (
              <p key={a} className="notice" data-kind="error">
                {a}
              </p>
            ))}
          </section>

          <section className="block">
            <div className="block-head">
              <p className="eyebrow">Ajustes del catálogo</p>
              <div className="toolbar">
                <button type="button" className="btn-primary" disabled={toApply.length === 0} onClick={applyRecommended}>
                  {toApply.length === 0 ? 'Nada pendiente' : `Aplicar ${toApply.length} recomendado${toApply.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
            <ul className="tweaks">
              {analysis.recomendacion.ajustes.map((a) => (
                <li key={a.id} className="tweak" data-selected={a.aplicar || undefined}>
                  <span className="tweak-tags">
                    <span data-tag={a.aplicar ? 'riesgo' : undefined}>{a.aplicar ? 'Recomendado' : 'No recomendado'}</span>
                  </span>
                  <h3>{titulo(a.id)}</h3>
                  <p>{a.motivo}</p>
                </li>
              ))}
            </ul>
          </section>

          {analysis.recomendacion.manuales.length > 0 && (
            <section className="block">
              <p className="eyebrow">Para hacer a mano</p>
              <ul className="tweaks">
                {analysis.recomendacion.manuales.map((m) => (
                  <li key={m.titulo} className="tweak">
                    <span className="tweak-tags">
                      <span>{CATEGORY[m.categoria]}</span>
                      <span>Impacto {m.impacto}</span>
                    </span>
                    <h3>{m.titulo}</h3>
                    <p>{m.detalle}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="block">
            <div className="block-head">
              <p className="eyebrow">Memoria</p>
              <button type="button" className="pill" onClick={useRamThresholds}>
                Usar estos umbrales
              </button>
            </div>
            <p className="lede">
              Limpieza automática {analysis.recomendacion.ram.autoLimpieza ? 'activada' : 'desactivada'}: purgar la standby cuando
              pase de <span className="num">{analysis.recomendacion.ram.umbralStandbyMB}</span> MB y queden menos de{' '}
              <span className="num">{analysis.recomendacion.ram.umbralLibreMB}</span> MB libres.
            </p>
          </section>

          {analysis.fuentes.length > 0 && (
            <section className="block">
              <p className="eyebrow">Fuentes</p>
              <ul className="sources">
                {analysis.fuentes.map((f) => (
                  <li key={f.url}>
                    <a href={f.url} target="_blank" rel="noreferrer">
                      {f.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  )
}
