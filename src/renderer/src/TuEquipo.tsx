import { useCallback, useEffect, useState } from 'react'
import type { EquipmentProfile, ProfileComponent, ProfileRecommendation } from '@shared/types'
import { errorMessage } from './errors'

const LABEL: Record<ProfileComponent, string> = {
  ram: 'Memoria RAM',
  gpu: 'Tarjeta gráfica',
  cpu: 'Procesador',
  almacenamiento: 'Almacenamiento',
  pantalla: 'Pantallas',
  placa: 'Placa madre',
  windows: 'Windows'
}

/** Orden de las tarjetas: primero lo que más suele mover el rendimiento en juegos. */
const ORDER: ProfileComponent[] = ['ram', 'gpu', 'cpu', 'almacenamiento', 'pantalla', 'placa', 'windows']

const IMPACT = { alto: 'Impacto alto', medio: 'Impacto medio', bajo: 'Impacto bajo' } as const

function Rec({ rec, busy, onApply }: { rec: ProfileRecommendation; busy: boolean; onApply: (r: ProfileRecommendation) => void }) {
  return (
    <li className="rec" data-impact={rec.impacto} data-done={rec.hecho || undefined}>
      <div className="rec-head">
        <span className="rec-impact">{rec.hecho ? 'Listo' : IMPACT[rec.impacto]}</span>
        {rec.tipo === 'automatico' && !rec.hecho && (
          <button type="button" className="btn-primary rec-apply" disabled={busy} onClick={() => onApply(rec)}>
            {busy ? 'Aplicando…' : 'Aplicar'}
          </button>
        )}
      </div>
      <h4>
        {rec.hecho && <span aria-hidden="true">✓ </span>}
        {rec.titulo}
      </h4>
      <p>{rec.detalle}</p>
      {rec.pasos && rec.pasos.length > 0 && !rec.hecho && (
        <ol className="rec-steps">
          {rec.pasos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      )}
      {rec.fuente && (
        <a className="rec-source" href={rec.fuente} target="_blank" rel="noreferrer">
          Fuente
        </a>
      )}
    </li>
  )
}

/** Recomendaciones por componente, calculadas en local con las reglas investigadas (sin internet). */
export function TuEquipo() {
  const [profile, setProfile] = useState<EquipmentProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback((force: boolean) => {
    setError(null)
    window.optikax.profile.get(force).then(setProfile, (e: unknown) => setError(errorMessage(e)))
  }, [])

  useEffect(() => load(false), [load])

  const apply = (rec: ProfileRecommendation): void => {
    if (!rec.tweakId) return
    setBusy(rec.id)
    setNotice(null)
    window.optikax.tweaks
      .apply([rec.tweakId])
      .then((r) => {
        const result = r.results[0]
        setNotice(result?.ok ? `${rec.titulo}: aplicado. Puedes revertirlo en Optimizar.` : `${rec.titulo}: ${result?.error ?? 'no se pudo aplicar.'}`)
        load(false)
      })
      .catch((e: unknown) => setNotice(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  if (error) return <p className="notice" data-kind="error">No se pudo analizar el equipo: {error}</p>
  if (!profile) return <p className="block eyebrow">Analizando tu equipo…</p>

  const pending = profile.recomendaciones.filter((r) => !r.hecho)
  const groups = ORDER.map((c) => ({
    componente: c,
    resumen: profile.componentes.find((s) => s.componente === c)?.resumen ?? null,
    recs: profile.recomendaciones.filter((r) => r.componente === c)
  })).filter((g) => g.recs.length > 0 || g.resumen)

  return (
    <section className="block equipo">
      <div className="block-head">
        <div>
          <p className="eyebrow">Tu equipo</p>
          <h2 className="equipo-title">
            Lo mejor para <em>tu</em> PC
          </h2>
        </div>
        <button type="button" className="pill" onClick={() => load(true)}>
          Volver a analizar
        </button>
      </div>
      <p className="lede">
        {pending.length === 0
          ? 'Todo lo recomendado para tus componentes ya está hecho.'
          : `${pending.length} recomendación${pending.length > 1 ? 'es' : ''} para tus componentes exactos, ordenadas por impacto. Se calculan en este equipo, sin internet.`}
      </p>
      <div aria-live="polite">{notice && <p className="notice">{notice}</p>}</div>

      <div className="equipo-grid">
        {groups.map((g) => (
          <article key={g.componente} className="equipo-card">
            <header>
              <h3>{LABEL[g.componente]}</h3>
              {g.resumen && <p className="equipo-spec">{g.resumen}</p>}
            </header>
            {g.recs.length > 0 ? (
              <ul className="recs">
                {g.recs.map((r) => (
                  <Rec key={r.id} rec={r} busy={busy === r.id} onApply={apply} />
                ))}
              </ul>
            ) : (
              <p className="equipo-empty">Sin recomendaciones: está bien configurado.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
