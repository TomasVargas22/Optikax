import { useEffect, useState } from 'react'
import type { Effects3D, Settings } from '@shared/types'
import { errorMessage } from './errors'

type Status = { kind: 'ok' | 'error'; text: string } | null

const EFFECTS: { value: Effects3D; label: string; note: string }[] = [
  { value: 'auto', label: 'Auto', note: 'Se pausan con la ventana oculta, sin foco o durante un juego, y se quitan con movimiento reducido.' },
  { value: 'siempre', label: 'Siempre', note: 'Igual que Auto, pero también con movimiento reducido activado en Windows.' },
  { value: 'nunca', label: 'Nunca', note: 'Imágenes fijas en lugar de 3D. Cero uso de GPU.' }
]

function ApiKey({ onKeyChange }: { onKeyChange: (has: boolean) => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  useEffect(() => {
    void window.optikax.apiKey.has().then(setHasKey)
  }, [])

  const update = (has: boolean): void => {
    setHasKey(has)
    onKeyChange(has)
  }

  const run = (task: () => Promise<Status>): void => {
    setBusy(true)
    setStatus(null)
    task()
      .then(setStatus)
      .catch((e: unknown) => setStatus({ kind: 'error', text: errorMessage(e) }))
      .finally(() => setBusy(false))
  }

  const testResult = async (okText: string): Promise<Status> => {
    const r = await window.optikax.apiKey.test()
    return r.ok ? { kind: 'ok', text: okText } : { kind: 'error', text: r.error ?? 'Error' }
  }

  return (
    <section className="setting">
      <div className="setting-head">
        <div>
          <h2>API key de Anthropic</h2>
          <p>
            Para el análisis con IA. Se guarda cifrada por Windows en este equipo y solo la usa el proceso principal. Consíguela en
            console.anthropic.com.
          </p>
        </div>
        <span className="setting-state" data-on={hasKey || undefined}>
          {hasKey === null ? '…' : hasKey ? 'Guardada' : 'Sin configurar'}
        </span>
      </div>
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          run(async () => {
            await window.optikax.apiKey.set(draft)
            setDraft('')
            update(true)
            return testResult('Clave guardada y conexión correcta.')
          })
        }}
      >
        <label htmlFor="api-key" className="sr-only">
          {hasKey ? 'Reemplazar clave' : 'Pegar clave'}
        </label>
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={hasKey ? 'Pegar una clave nueva para reemplazarla' : 'sk-ant-…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
          {busy ? 'Comprobando…' : 'Guardar'}
        </button>
      </form>
      {hasKey && (
        <div className="setting-actions">
          <button type="button" className="pill" disabled={busy} onClick={() => run(() => testResult('Conexión correcta.'))}>
            Probar conexión
          </button>
          <button
            type="button"
            className="pill"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await window.optikax.apiKey.clear()
                update(false)
                return { kind: 'ok', text: 'Clave borrada.' }
              })
            }
          >
            Borrar clave
          </button>
        </div>
      )}
      <div aria-live="polite">{status && <p className="notice" data-kind={status.kind}>{status.text}</p>}</div>
    </section>
  )
}

interface Props {
  settings: Settings | null
  onSettings: (s: Settings) => void
  onKeyChange: (has: boolean) => void
  onOpenGameMode: () => void
  onOpenMemory: () => void
}

export function Ajustes({ settings, onSettings, onKeyChange, onOpenGameMode, onOpenMemory }: Props) {
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
      <ApiKey onKeyChange={onKeyChange} />

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
