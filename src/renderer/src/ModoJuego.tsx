import { useEffect, useState } from 'react'
import type { GameModeStatus, Settings } from '@shared/types'
import { errorMessage } from './errors'

const mb = (bytes: number): number => Math.round(bytes / 2 ** 20)

function duration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min` : `${sec} s`
}

const timeText = (iso: string): string => new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })

/** Pantalla Modo Juego: funcional; el diseño final llega en la fase de interfaz. */
export function ModoJuego({ status }: { status: GameModeStatus | null }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.optikax.settings.get().then(setSettings)
  }, [])

  const save = (patch: Partial<Settings['modoJuego']>): void => {
    if (!settings) return
    setError(null)
    window.optikax.settings
      .update({ modoJuego: { ...settings.modoJuego, ...patch } })
      .then(setSettings)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const custom = settings?.modoJuego.juegosPersonalizados ?? []
  const add = (): void => {
    const name = draft.trim().replace(/^.*[\\/]/, '')
    if (!name) return
    const exe = /\.exe$/i.test(name) ? name : `${name}.exe`
    if (!custom.some((c) => c.toLowerCase() === exe.toLowerCase())) save({ juegosPersonalizados: [...custom, exe] })
    setDraft('')
  }

  const activo = settings?.modoJuego.activo ?? status?.activo ?? false
  const juego = status?.juego

  return (
    <>
      <section className="block">
        <div className="game-toggle">
          <button
            type="button"
            role="switch"
            aria-checked={activo}
            aria-labelledby="game-toggle-label"
            className="switch switch-lg"
            disabled={!settings}
            onClick={() => save({ activo: !activo })}
          />
          <div>
            <p id="game-toggle-label" className="game-toggle-title">
              Modo Juego {activo ? 'activado' : 'apagado'}
            </p>
            <p className="eyebrow">{activo ? 'Vigilando cada 3 s' : 'No detecta juegos'}</p>
          </div>
        </div>
        <p className="lede">Sigue funcionando con la ventana cerrada: Optikax se queda en la bandeja del sistema.</p>
        {error && <p className="notice" data-kind="error">{error}</p>}
        {status?.conflictos.map((c) => (
          <p key={c.name} className="notice" data-kind="error">
            <b>{c.name} está en ejecución.</b> {c.motivo} Pueden pisarse: si notas cambios raros, usa solo uno de los dos.
          </p>
        ))}
      </section>

      <section className="block" aria-live="polite">
        <p className="eyebrow">Ahora</p>
        {juego ? (
          <div className="notice" data-kind="ok">
            <p>
              <b>Jugando {juego.name}</b> · desde {timeText(juego.startedAt)} · {juego.motivo}
            </p>
            {juego.acciones.map((a) => (
              <p key={a}>✓ {a}</p>
            ))}
          </div>
        ) : (
          <p className="lede">{activo ? 'No hay ningún juego abierto.' : 'Activa el Modo Juego para que detecte tus juegos.'}</p>
        )}
      </section>

      <section className="block">
        <p className="eyebrow">Juegos agregados a mano</p>
        <p className="lede">
          Se detectan solos los juegos de Steam, Epic, Riot, Xbox, GOG, EA y Ubisoft. Agrega aquí los que estén en otra carpeta.
        </p>
        <form
          className="key-form"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <label htmlFor="custom-game" className="eyebrow">
            Ejecutable
          </label>
          <input id="custom-game" placeholder="mijuego.exe" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="pill" disabled={!draft.trim() || !settings}>
            Agregar
          </button>
        </form>
        {custom.length > 0 && (
          <ul className="sources">
            {custom.map((c) => (
              <li key={c}>
                {c}{' '}
                <button type="button" className="link" onClick={() => save({ juegosPersonalizados: custom.filter((x) => x !== c) })}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <p className="eyebrow">Historial</p>
        {status && status.sesiones.length > 0 ? (
          <ul className="tweaks">
            {status.sesiones.slice(0, 12).map((s) => (
              <li key={s.startedAt} className="tweak">
                <span className="tweak-tags">
                  <span>{timeText(s.startedAt)}</span>
                  <span>{duration(s.durationSec)}</span>
                </span>
                <h3>{s.game}</h3>
                <p>
                  <span className="num">{mb(s.freedBytes)}</span> MB liberados
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lede">Todavía no hay sesiones.</p>
        )}
      </section>
    </>
  )
}
