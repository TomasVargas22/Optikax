import { motion, useSpring } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import {
  recommendedTweaks,
  type RestorePointInfo,
  type TweakActionResult,
  type TweakCategory,
  type TweakId,
  type TweakInfo,
  type TweakRecommendation
} from '@shared/types'
import { errorMessage } from './errors'

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

/** Íconos de línea monocromos, uno por categoría. */
const ICON: Record<TweakCategory, ReactNode> = {
  energia: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  juego: (
    <>
      <rect x="2" y="7" width="20" height="11" rx="5.5" />
      <path d="M7 10.5v4M5 12.5h4M15.5 11.5h.01M18 13.5h.01" />
    </>
  ),
  gpu: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="9" cy="12" r="3" />
      <path d="M15 10h4M15 14h4M5 18v2" />
    </>
  ),
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  entrada: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="6" />
      <path d="M12 6v4" />
    </>
  ),
  red: <path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01" />,
  visual: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  memoria: (
    <>
      <rect x="2" y="7" width="20" height="10" rx="1" />
      <path d="M6 10v4M10 10v4M14 10v4M18 10v4M5 17v3M19 17v3" />
    </>
  )
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

/** Círculo lima que sigue al puntero sobre las tarjetas, con un muelle para que no se sienta pegado. */
function LimeCursor({ label }: { label: string | null }) {
  const x = useSpring(0, { stiffness: 500, damping: 40, mass: 0.4 })
  const y = useSpring(0, { stiffness: 500, damping: 40, mass: 0.4 })
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      x.set(e.clientX)
      y.set(e.clientY)
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [x, y])
  return (
    <motion.div className="lime-cursor" style={{ x, y }} data-visible={label ? '' : undefined} aria-hidden="true">
      <span>{label}</span>
    </motion.div>
  )
}

export function Optimizar() {
  const [tweaks, setTweaks] = useState<TweakInfo[] | null>(null)
  const [selected, setSelected] = useState<Set<TweakId>>(new Set())
  const [busy, setBusy] = useState<'aplicar' | 'revertir' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ia, setIa] = useState<TweakRecommendation[] | null>(null)
  const [hover, setHover] = useState<string | null>(null)

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
      <p className="block eyebrow">
        <span className="num">{activos}</span> de <span className="num">{tweaks.length}</span> activos
      </p>

      <div aria-live="polite">
        {busy === 'aplicar' && <p className="notice">Creando un punto de restauración y aplicando. Puede tardar hasta un minuto…</p>}
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

      <ul className="products" onPointerLeave={() => setHover(null)}>
        {tweaks.map((t) => {
          const isSelectable = !t.activo && t.motivoNoAplica === null && busy === null
          const isSelected = selected.has(t.id)
          const restart = RESTART_LABEL[t.reinicio]
          const rec = iaById.get(t.id)
          return (
            <li
              key={t.id}
              className="product"
              data-state={t.activo ? 'activo' : t.motivoNoAplica ? 'no-aplica' : 'inactivo'}
              data-selected={isSelected || undefined}
              onPointerEnter={() => setHover(isSelectable ? (isSelected ? 'Quitar' : 'Aplicar') : 'Ver')}
              onClick={() => {
                if (!isSelectable) return
                toggle(t.id)
                setHover(isSelected ? 'Aplicar' : 'Quitar')
              }}
            >
              <div className="product-art">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {ICON[t.categoria]}
                </svg>
                {isSelectable && (
                  <button
                    type="button"
                    className="product-add"
                    aria-pressed={isSelected}
                    aria-label={`${isSelected ? 'Quitar' : 'Seleccionar'}: ${t.titulo}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(t.id)
                    }}
                  >
                    {isSelected ? '✓' : '+'}
                  </button>
                )}
              </div>
              <span className="product-tags">
                <span>{CATEGORY_LABEL[t.categoria]}</span>
                {t.riesgo === 'medio' && <span data-tag="riesgo">Riesgo medio</span>}
                {restart && <span>{restart}</span>}
              </span>
              <h3>{t.titulo}</h3>
              <p>{t.descripcion}</p>
              {t.nota && <p className="product-note">{t.nota}</p>}
              {rec?.aplicar && (
                <p className="product-ia">
                  <b>Recomendado por la IA</b> {rec.motivo}
                </p>
              )}
              <div className="product-foot">
                {t.motivoNoAplica ? (
                  <span className="product-status">No aplica · {t.motivoNoAplica}</span>
                ) : t.activo ? (
                  <span className="product-status" data-on>
                    {t.revertible ? 'Activo · aplicado por Optikax' : 'Activo · ya estaba así'}
                  </span>
                ) : (
                  <span className="product-status">{t.revertible ? 'Inactivo · cambió desde que se aplicó' : 'Inactivo'}</span>
                )}
                {t.revertible && (
                  <button
                    type="button"
                    className="link"
                    disabled={busy !== null}
                    onClick={(e) => {
                      e.stopPropagation()
                      run('revertir', [t.id])
                    }}
                  >
                    Revertir
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="apply-bar" role="region" aria-label="Acciones">
        <p>
          {selected.size === 0 ? (
            'Elige ajustes con +'
          ) : (
            <>
              <b className="num">{selected.size}</b> seleccionado{selected.size > 1 ? 's' : ''}
            </>
          )}
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
            {busy === 'aplicar' ? 'Aplicando…' : `Aplicar${selected.size ? ` ${selected.size}` : ''}`}
          </button>
        </div>
      </div>

      <LimeCursor label={hover} />
    </>
  )
}
