import { useEffect, useState } from 'react'
import { errorMessage } from './errors'
import {
  recommendedTweaks,
  type RestorePointInfo,
  type TweakActionResult,
  type TweakCategory,
  type TweakId,
  type TweakInfo,
  type TweakRecommendation
} from '@shared/types'

const CATEGORY_LABEL: Record<TweakCategory, string> = {
  energia: 'Energía',
  juego: 'Juego',
  gpu: 'GPU',
  cpu: 'CPU',
  entrada: 'Mouse',
  red: 'Red',
  visual: 'Visual',
  memoria: 'Memoria'
}

const RESTART_LABEL = { no: null, sesion: 'Pide cerrar sesión', reinicio: 'Pide reiniciar' } as const

const RESTORE_POINT_TEXT: Record<RestorePointInfo['status'], string> = {
  creado: 'Se creó un punto de restauración antes de aplicar.',
  reciente: 'Windows ya tenía un punto de restauración de las últimas 24 horas; se usa ese.',
  omitido: 'Ya había un punto de restauración reciente creado por Optikax.',
  no_disponible:
    'No se pudo crear un punto de restauración (Protección del sistema está apagada). Los valores originales quedaron guardados igual y puedes revertir desde aquí.'
}

interface Notice {
  restorePoint: RestorePointInfo | null
  ok: number
  errors: { titulo: string; error: string }[]
  restart: 'no' | 'sesion' | 'reinicio'
  action: 'aplicar' | 'revertir'
}

function summarize(r: TweakActionResult, action: Notice['action']): Notice {
  const byId = new Map(r.tweaks.map((t) => [t.id, t]))
  const done = r.results.filter((x) => x.ok).map((x) => byId.get(x.id)!)
  return {
    restorePoint: r.restorePoint,
    ok: done.length,
    errors: r.results
      .filter((x) => !x.ok)
      .map((x) => ({ titulo: byId.get(x.id)?.titulo ?? x.id, error: x.error ?? 'Error desconocido' })),
    restart: done.some((t) => t.reinicio === 'reinicio') ? 'reinicio' : done.some((t) => t.reinicio === 'sesion') ? 'sesion' : 'no',
    action
  }
}

/** Pantalla Optimizar: funcional; las tarjetas tipo producto y el cursor lima llegan en la fase 8. */
export function Optimizar() {
  const [tweaks, setTweaks] = useState<TweakInfo[] | null>(null)
  const [selected, setSelected] = useState<Set<TweakId>>(new Set())
  const [busy, setBusy] = useState<'aplicar' | 'revertir' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ia, setIa] = useState<TweakRecommendation[] | null>(null)

  useEffect(() => {
    window.optikax.tweaks.list().then(setTweaks, (e: unknown) => setError(errorMessage(e)))
    void window.optikax.ai.last().then((a) => setIa(a?.recomendacion.ajustes ?? null))
  }, [])

  const run = (action: 'aplicar' | 'revertir', ids?: TweakId[]): void => {
    setBusy(action)
    setError(null)
    setNotice(null)
    const call = action === 'aplicar' ? window.optikax.tweaks.apply(ids ?? []) : window.optikax.tweaks.revert(ids)
    call
      .then((r) => {
        setTweaks(r.tweaks)
        setNotice(summarize(r, action))
        setSelected(new Set())
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const toggle = (id: TweakId): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  if (error && !tweaks) return <p className="lede">No se pudieron leer los ajustes: {error}</p>
  if (!tweaks) return <p className="block eyebrow">Leyendo el estado de los ajustes…</p>

  // Sin análisis de IA solo entran los de riesgo bajo; con él, lo que diga la IA (ver recommendedTweaks).
  const recommended = recommendedTweaks(tweaks, ia)
  const iaById = new Map((ia ?? []).map((r) => [r.id, r]))
  const revertibles = tweaks.filter((t) => t.revertible)
  const activos = tweaks.filter((t) => t.activo).length

  return (
    <>
      <section className="block">
        <div className="block-head">
          <p className="eyebrow">
            <span className="num">{activos}</span> de <span className="num">{tweaks.length}</span> activos
          </p>
          <div className="toolbar">
            {recommended.length > 0 && (
              <button
                type="button"
                className="pill"
                disabled={busy !== null}
                title="Los de riesgo medio solo entran si el análisis de IA los recomienda para tu equipo."
                onClick={() => setSelected(new Set(recommended))}
              >
                Seleccionar recomendados
              </button>
            )}
            {revertibles.length > 0 && (
              <button type="button" className="pill" disabled={busy !== null} onClick={() => run('revertir')}>
                {busy === 'revertir' ? 'Revirtiendo…' : 'Revertir todo'}
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null || selected.size === 0}
              onClick={() => run('aplicar', [...selected])}
            >
              {busy === 'aplicar'
                ? 'Aplicando…'
                : selected.size === 0
                  ? 'Elige ajustes'
                  : `Aplicar ${selected.size} ajuste${selected.size > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

        <div aria-live="polite">
          {busy === 'aplicar' && (
            <p className="notice">Creando un punto de restauración y aplicando. Puede tardar hasta un minuto…</p>
          )}
          {error && <p className="notice" data-kind="error">{error}</p>}
          {notice && (
            <div className="notice" data-kind={notice.errors.length ? 'error' : 'ok'}>
              <p>
                <b>
                  {notice.ok} ajuste{notice.ok === 1 ? '' : 's'} {notice.action === 'aplicar' ? 'aplicado' : 'revertido'}
                  {notice.ok === 1 ? '' : 's'}.
                </b>{' '}
                {notice.restart === 'reinicio' && 'Reinicia el equipo para que todo surta efecto. '}
                {notice.restart === 'sesion' && 'Cierra sesión y vuelve a entrar para que todo surta efecto. '}
                {notice.restorePoint && RESTORE_POINT_TEXT[notice.restorePoint.status]}
              </p>
              {notice.errors.map((e) => (
                <p key={e.titulo}>
                  <b>{e.titulo}:</b> {e.error}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>

      <ul className="tweaks">
        {tweaks.map((t) => {
          const isSelectable = !t.activo && t.motivoNoAplica === null
          const isSelected = selected.has(t.id)
          const restart = RESTART_LABEL[t.reinicio]
          return (
            <li key={t.id} className="tweak" data-state={t.activo ? 'activo' : t.motivoNoAplica ? 'no-aplica' : 'inactivo'} data-selected={isSelected || undefined}>
              <div className="tweak-top">
                <span className="tweak-tags">
                  <span>{CATEGORY_LABEL[t.categoria]}</span>
                  {t.riesgo === 'medio' && <span data-tag="riesgo">Riesgo medio</span>}
                  {restart && <span>{restart}</span>}
                </span>
                {isSelectable && (
                  <button
                    type="button"
                    className="tweak-add"
                    aria-pressed={isSelected}
                    aria-label={`${isSelected ? 'Quitar' : 'Seleccionar'}: ${t.titulo}`}
                    disabled={busy !== null}
                    onClick={() => toggle(t.id)}
                  >
                    {isSelected ? '✓' : '+'}
                  </button>
                )}
              </div>
              <h3>{t.titulo}</h3>
              <p>{t.descripcion}</p>
              {t.nota && <p className="tweak-note">{t.nota}</p>}
              {iaById.get(t.id)?.aplicar && (
                <p className="tweak-ia">
                  <b>Recomendado por la IA</b> · {iaById.get(t.id)!.motivo}
                </p>
              )}
              <div className="tweak-foot">
                {t.motivoNoAplica ? (
                  <span className="tweak-status">No aplica · {t.motivoNoAplica}</span>
                ) : t.activo ? (
                  <span className="tweak-status" data-on>
                    {t.revertible ? 'Activo · aplicado por Optikax' : 'Activo · ya estaba así'}
                  </span>
                ) : (
                  <span className="tweak-status">{t.revertible ? 'Inactivo · cambió desde que se aplicó' : 'Inactivo'}</span>
                )}
                {t.revertible && (
                  <button type="button" className="link" disabled={busy !== null} onClick={() => run('revertir', [t.id])}>
                    Revertir
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
