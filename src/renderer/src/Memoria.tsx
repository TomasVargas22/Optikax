import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from './errors'
import type { MemoryEvent, MemoryState, MemStats, PurgeKind } from '@shared/types'

const GB = 2 ** 30
const MB = 2 ** 20
const HISTORY = 60

const KIND_LABEL: Record<PurgeKind, string> = {
  standby: 'Standby',
  standbyLow: 'Standby de baja prioridad',
  workingSets: 'Working sets',
  modified: 'Lista Modified'
}
const ORIGIN_LABEL = { manual: 'Manual', auto: 'Automática', juego: 'Modo Juego' } as const

const SECONDARY: { kind: PurgeKind; title: string; note: string }[] = [
  {
    kind: 'standbyLow',
    title: 'Standby de baja prioridad',
    note: 'Limpieza suave: solo la caché que Windows menos necesita.'
  },
  {
    kind: 'workingSets',
    title: 'Vaciar working sets',
    note: 'Saca de la RAM lo que las apps no están usando. Puede causar micro-cargas al volver a ellas.'
  },
  {
    kind: 'modified',
    title: 'Vaciar lista Modified',
    note: 'Escribe a disco las páginas pendientes para poder liberarlas.'
  }
]

const gb = (bytes: number): string => (bytes / GB).toFixed(1)
function size(bytes: number): string {
  return bytes >= GB ? `${gb(bytes)} GB` : `${Math.round(bytes / MB).toLocaleString('es')} MB`
}
const time = (iso: string): string => new Date(iso).toLocaleTimeString('es', { hour12: false })

function Chart({ history }: { history: MemStats[] }) {
  const W = 600
  const H = 120
  // Las muestras entran por la derecha, como en un monitor de rendimiento.
  const x = (i: number): number => W - (history.length - 1 - i) * (W / (HISTORY - 1))
  const line = (value: (m: MemStats) => number): string =>
    history.map((m, i) => `${x(i).toFixed(1)},${(H - (value(m) / m.totalBytes) * H).toFixed(1)}`).join(' ')
  const used = line((m) => m.totalBytes - m.availBytes)
  const cached = line((m) => m.totalBytes - m.freeBytes)
  const first = history.length ? x(0).toFixed(1) : '0'

  return (
    <svg className="mem-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Uso de memoria en los últimos 60 segundos">
      {history.length > 1 && (
        <>
          <polygon className="mem-chart-cached" points={`${first},${H} ${cached} ${W},${H}`} />
          <polygon className="mem-chart-used" points={`${first},${H} ${used} ${W},${H}`} />
          <polyline className="mem-chart-line" points={used} />
        </>
      )}
    </svg>
  )
}

function ThresholdInput(props: { label: string; value: number; onCommit: (mb: number) => void }) {
  const [text, setText] = useState(String(props.value))
  useEffect(() => setText(String(props.value)), [props.value])

  const commit = (): void => {
    const n = Math.round(Number(text))
    if (Number.isFinite(n) && n >= 128 && n <= 65536 && n !== props.value) props.onCommit(n)
    else setText(String(props.value))
  }
  return (
    <label className="field">
      <span>{props.label}</span>
      <span className="field-input">
        <input
          className="num"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        MB
      </span>
    </label>
  )
}

/** Pantalla Memoria: funcional; el diseño final y la animación 3D llegan en la fase 8. */
export function Memoria({ visible }: { visible: boolean }) {
  const [history, setHistory] = useState<MemStats[]>([])
  const [state, setState] = useState<MemoryState | null>(null)
  const [busy, setBusy] = useState<PurgeKind | null>(null)
  const [last, setLast] = useState<MemoryEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mem = history.at(-1) ?? null
  const refreshState = useCallback(() => void window.optikax.memory.state().then(setState), [])

  // Sondeo cada segundo, solo mientras la pantalla se ve.
  useEffect(() => {
    if (!visible) return
    let alive = true
    const read = (): void => {
      window.optikax.memory.stats().then(
        (m) => alive && setHistory((h) => [...h.slice(-(HISTORY - 1)), m]),
        (e: unknown) => alive && setError(errorMessage(e))
      )
    }
    read()
    const timer = setInterval(read, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [visible])

  useEffect(() => {
    refreshState()
    return window.optikax.memory.onEvent((event) => {
      setLast(event)
      refreshState()
    })
  }, [refreshState])

  const purge = (kind: PurgeKind): void => {
    setBusy(kind)
    setError(null)
    window.optikax.memory
      .purge(kind)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const updateRam = (patch: { autoLimpieza?: boolean; umbralStandbyMB?: number; umbralLibreMB?: number }): void => {
    void window.optikax.settings.update({ ram: patch }).then(refreshState)
  }

  const segments = mem && [
    { id: 'uso', label: 'En uso', bytes: mem.totalBytes - mem.availBytes - mem.modifiedBytes },
    { id: 'modified', label: 'Modified', bytes: mem.modifiedBytes },
    { id: 'standby', label: 'Standby', bytes: mem.standbyBytes },
    { id: 'libre', label: 'Libre', bytes: mem.freeBytes }
  ]

  return (
    <>
      <div className="mem-hero">
        <div>
          <p className="eyebrow">Memoria libre</p>
          <h1 className="mem-figure num">
            {mem ? gb(mem.freeBytes) : '–'}
            <em>GB</em>
          </h1>
          <p className="lede num">
            {mem
              ? `${gb(mem.standbyBytes)} GB en standby · ${gb(mem.totalBytes - mem.availBytes)} de ${gb(mem.totalBytes)} GB en uso`
              : 'Leyendo la memoria…'}
          </p>
        </div>
        <div className="mem-cta">
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => purge('standby')}>
            {busy === 'standby' ? 'Limpiando…' : 'Limpiar standby'}
          </button>
          <p className="mem-result num" aria-live="polite">
            {error ? (
              <span className="mem-error">{error}</span>
            ) : last ? (
              last.error ? (
                <span className="mem-error">La limpieza falló: {last.error}</span>
              ) : (
                <>
                  <b>+{size(last.freedBytes)}</b> liberados · {KIND_LABEL[last.kind]}
                </>
              )
            ) : (
              'La standby es caché que Windows guarda por si acaso. Limpiarla es seguro.'
            )}
          </p>
        </div>
      </div>

      {segments && mem && (
        <section className="block">
          <div className="mem-bar" aria-hidden="true">
            {segments.map((s) => (
              <span key={s.id} data-seg={s.id} style={{ flexGrow: Math.max(s.bytes, 0) }} />
            ))}
          </div>
          <ul className="mem-legend">
            {segments.map((s) => (
              <li key={s.id} data-seg={s.id}>
                {s.label} <b className="num">{gb(s.bytes)} GB</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="block">
        <p className="eyebrow">Últimos 60 segundos</p>
        <Chart history={history} />
      </section>

      <div className="mem-grid">
        <section className="card">
          <p className="eyebrow">Otras limpiezas</p>
          <ul className="actions">
            {SECONDARY.map((a) => (
              <li key={a.kind}>
                <div>
                  <h3>{a.title}</h3>
                  <p>{a.note}</p>
                </div>
                <button type="button" className="pill" disabled={busy !== null} onClick={() => purge(a.kind)}>
                  {busy === a.kind ? 'Limpiando…' : 'Limpiar'}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="block-head">
            <p className="eyebrow">Limpieza automática</p>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={state?.autoLimpieza ?? false}
              aria-label="Limpieza automática"
              disabled={!state}
              onClick={() => state && updateRam({ autoLimpieza: !state.autoLimpieza })}
            />
          </div>
          <p className="card-note">
            Limpia la standby sola cuando ocupa mucho <b>y</b> queda poca memoria libre. Como máximo, una vez cada 30
            segundos.
          </p>
          {state && (
            <>
              <ThresholdInput
                label="Limpiar si la standby supera"
                value={state.umbralStandbyMB}
                onCommit={(mb) => updateRam({ umbralStandbyMB: mb, umbralLibreMB: state.umbralLibreMB })}
              />
              <ThresholdInput
                label="y la memoria libre baja de"
                value={state.umbralLibreMB}
                onCommit={(mb) => updateRam({ umbralLibreMB: mb, umbralStandbyMB: state.umbralStandbyMB })}
              />
              <p className="card-note">
                {state.umbralesAutomaticos ? (
                  'Valores calculados para la RAM de este equipo.'
                ) : (
                  <button type="button" className="link" onClick={() => updateRam({ umbralStandbyMB: 0, umbralLibreMB: 0 })}>
                    Volver a los valores recomendados
                  </button>
                )}
              </p>
            </>
          )}
        </section>
      </div>

      <section className="block">
        <p className="eyebrow">Registro</p>
        {state && state.events.length > 0 ? (
          <ul className="log num">
            {state.events.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span>{time(e.at)}</span>
                <span>{ORIGIN_LABEL[e.origin]}</span>
                <span>{KIND_LABEL[e.kind]}</span>
                <b>{e.error ? 'Falló' : `+${size(e.freedBytes)}`}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card-note">Todavía no hay limpiezas en esta sesión.</p>
        )}
      </section>
    </>
  )
}
