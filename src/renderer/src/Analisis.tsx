import { useEffect, useState } from 'react'
import { recommendedTweaks, type AiAnalysis, type AiProgress, type ManualCategory, type TweakInfo } from '@shared/types'
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

const dateText = (iso: string): string => new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
const pad = (n: number): string => String(n).padStart(2, '0')

interface Slide {
  key: string
  tag: string
  impacto: string | null
  titulo: string
  texto: string
}

/** Carrusel horizontal de recomendaciones: línea de progreso, contador y flechas en pastilla. */
function Carousel({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0)
  const last = slides.length - 1
  const go = (i: number): void => setIndex(Math.max(0, Math.min(last, i)))

  return (
    <div
      className="carousel"
      role="region"
      aria-roledescription="carrusel"
      aria-label="Recomendaciones"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(index + 1)
        if (e.key === 'ArrowLeft') go(index - 1)
      }}
    >
      <div className="carousel-viewport">
        <ol className="carousel-track" style={{ transform: `translateX(calc(${-index} * (var(--slide-w) + var(--s-3))))` }}>
          {slides.map((s, i) => (
            <li
              key={s.key}
              className="slide"
              aria-hidden={i !== index}
              aria-label={`${i + 1} de ${slides.length}`}
              data-current={i === index || undefined}
              onClick={() => go(i)}
            >
              <span className="slide-num num">{pad(i + 1)}</span>
              <span className="product-tags">
                <span>{s.tag}</span>
                {s.impacto && <span data-tag="riesgo">Impacto {s.impacto}</span>}
              </span>
              <h3>{s.titulo}</h3>
              <p>{s.texto}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="carousel-controls">
        <div className="carousel-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${(index + 1) / slides.length})` }} />
        </div>
        <p className="carousel-count num" aria-live="polite">
          {pad(index + 1)}/{pad(slides.length)}
        </p>
        <div className="carousel-arrows">
          <button type="button" className="pill" aria-label="Anterior" disabled={index === 0} onClick={() => go(index - 1)}>
            ←
          </button>
          <button type="button" className="pill" aria-label="Siguiente" disabled={index === last} onClick={() => go(index + 1)}>
            →
          </button>
        </div>
      </div>
    </div>
  )
}

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

  const rec = analysis?.recomendacion
  const slides: Slide[] = rec
    ? [
        ...rec.ajustes
          .filter((a) => a.aplicar)
          .map((a) => ({ key: a.id, tag: 'Ajuste automático', impacto: null, titulo: titulo(a.id), texto: a.motivo })),
        ...rec.manuales.map((m) => ({
          key: `m-${m.titulo}`,
          tag: CATEGORY[m.categoria],
          impacto: m.impacto,
          titulo: m.titulo,
          texto: m.detalle
        }))
      ]
    : []
  const notRecommended = rec?.ajustes.filter((a) => !a.aplicar) ?? []

  return (
    <>
      <section className="block">
        <div className="block-head">
          <p className="eyebrow">{analysis ? `Último análisis · ${dateText(analysis.createdAt)}` : 'Sin análisis todavía'}</p>
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
        <p className="lede">Usa Claude con búsqueda web. Coste estimado: ≈ $0.10–0.40 por análisis, en tu cuenta de Anthropic.</p>

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
        </div>

        {running && (
          <div className="scan">
            <div className="radar" aria-hidden="true">
              <span />
            </div>
            <div className="scan-feed" aria-live="polite">
              <p>
                <b>{phase?.text ?? 'Preparando…'}</b>
              </p>
              <p className="num">
                {searches.length} búsquedas · {sourcesFound} fuentes
              </p>
              <ol>
                {searches.slice(-6).map((s) => (
                  <li key={s.query}>Buscando: {s.query}</li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </section>

      {analysis && rec && !running && (
        <>
          <section className="block">
            <p className="eyebrow">
              {PERFIL[rec.perfil]} · coste ≈ ${analysis.costoUSD.toFixed(2)} · {analysis.busquedas.length} búsquedas
            </p>
            <p className="lede">{rec.resumen}</p>
            {rec.advertencias.map((a) => (
              <p key={a} className="notice" data-kind="error">
                {a}
              </p>
            ))}
          </section>

          {slides.length > 0 && (
            <section className="block">
              <div className="block-head">
                <p className="eyebrow">Lo que recomienda para tu equipo</p>
                <button type="button" className="btn-primary" disabled={toApply.length === 0} onClick={applyRecommended}>
                  {toApply.length === 0 ? 'Nada pendiente' : `Aplicar ${toApply.length} recomendado${toApply.length === 1 ? '' : 's'}`}
                </button>
              </div>
              <Carousel slides={slides} />
            </section>
          )}

          {notRecommended.length > 0 && (
            <details className="block disclosure">
              <summary className="eyebrow">No recomendados para tu equipo ({notRecommended.length})</summary>
              <ul className="plain-list">
                {notRecommended.map((a) => (
                  <li key={a.id}>
                    <b>{titulo(a.id)}</b> · {a.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <section className="block">
            <div className="block-head">
              <p className="eyebrow">Memoria</p>
              <button type="button" className="pill" onClick={useRamThresholds}>
                Usar estos umbrales
              </button>
            </div>
            <p className="lede">
              Limpieza automática {rec.ram.autoLimpieza ? 'activada' : 'desactivada'}: purgar la standby cuando pase de{' '}
              <span className="num">{rec.ram.umbralStandbyMB}</span> MB y queden menos de <span className="num">{rec.ram.umbralLibreMB}</span>{' '}
              MB libres.
            </p>
          </section>

          {analysis.fuentes.length > 0 && (
            <section className="block">
              <p className="eyebrow">Fuentes ({analysis.fuentes.length})</p>
              <ul className="sources">
                {analysis.fuentes.map((f) => (
                  <li key={f.url}>
                    <a href={f.url} target="_blank" rel="noreferrer">
                      {f.title}
                    </a>
                    <span>{new URL(f.url).hostname.replace(/^www\./, '')}</span>
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
