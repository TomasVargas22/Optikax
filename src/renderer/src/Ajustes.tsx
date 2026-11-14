import { useState } from 'react'
import type { Effects3D, Settings } from '@shared/types'
import { errorMessage } from './errors'

type Status = { kind: 'ok' | 'error'; text: string } | null

const EFFECTS: { value: Effects3D; label: string; note: string }[] = [
  { value: 'auto', label: 'Auto', note: 'Se pausan con la ventana oculta, sin foco o durante un juego, y se quitan con movimiento reducido.' },
  { value: 'siempre', label: 'Siempre', note: 'Igual que Auto, pero también con movimiento reducido activado en Windows.' },
  { value: 'nunca', label: 'Nunca', note: 'Imágenes fijas en lugar de 3D. Cero uso de GPU.' }
]

interface Props {
  settings: Settings | null
  onSettings: (s: Settings) => void
  onOpenGameMode: () => void
  onOpenMemory: () => void
}

export function Ajustes({ settings, onSettings, onOpenGameMode, onOpenMemory }: Props) {
  const [status, setStatus] = useState<Status>(null)

  const save = (patch: Partial<Settings>): void => {
    setStatus(null)
    window.optikax.settings
      .update(patch)
      .then(onSettings)
      .catch((e: unknown) => setStatus({ kind: 'error', text: errorMessage(e) }))
  }

  const exportBackup = (): void => {
    setStatus(null)
    window.optikax.backup
      .export()
      .then((path) => path && setStatus({ kind: 'ok', text: `Respaldo guardado en ${path}` }))
      .catch((e: unknown) => setStatus({ kind: 'error', text: errorMessage(e) }))
  }

  const effects = settings?.efectos3d ?? 'auto'

  return (
    <div className="settings">
      <section className="setting">
        <div className="setting-head">
          <div>
            <h2>Efectos 3D</h2>
            <p>{EFFECTS.find((e) => e.value === effects)?.note}</p>
          </div>
        </div>
        <div className="segmented" role="group" aria-label="Efectos 3D">
          {EFFECTS.map((e) => (
            <button
              key={e.value}
              type="button"
              aria-pressed={effects === e.value}
              disabled={!settings}
              onClick={() => save({ efectos3d: e.value })}
            >
              {e.label}
            </button>
          ))}
        </div>
      </section>

      <section className="setting">
        <div className="setting-head">
          <div>
            <h2>Iniciar con Windows</h2>
            <p>Arranca en la bandeja al iniciar sesión, para que el Modo Juego funcione sin abrir la app.</p>
          </div>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={settings?.iniciarConWindows ?? false}
            aria-label="Iniciar con Windows"
            disabled={!settings}
            onClick={() => settings && save({ iniciarConWindows: !settings.iniciarConWindows })}
          />
        </div>
      </section>

      <section className="setting">
        <div className="setting-head">
          <div>
            <h2>Memoria y Modo Juego</h2>
            <p>
              Limpieza automática: {settings?.ram.autoLimpieza ? 'activada' : 'desactivada'}. Modo Juego:{' '}
              {settings?.modoJuego.activo ? 'activado' : 'desactivado'}, {settings?.modoJuego.juegosPersonalizados.length ?? 0} juegos
              agregados a mano.
            </p>
          </div>
        </div>
        <div className="setting-actions">
          <button type="button" className="pill" onClick={onOpenMemory}>
            Umbrales de memoria
          </button>
          <button type="button" className="pill" onClick={onOpenGameMode}>
            Juegos personalizados
          </button>
        </div>
      </section>

      <section className="setting">
        <div className="setting-head">
          <div>
            <h2>Respaldo</h2>
            <p>Copia de los valores originales que Optikax guardó antes de cambiar nada. Sirve para restaurar a mano.</p>
          </div>
          <button type="button" className="pill" onClick={exportBackup}>
            Exportar respaldo
          </button>
        </div>
      </section>

      <div aria-live="polite">{status && <p className="notice" data-kind={status.kind}>{status.text}</p>}</div>
    </div>
  )
}
