import { useEffect, useState } from 'react'
import { AI_PROVIDER_LABEL, AI_PROVIDERS, type AiProvider, type Effects3D, type Settings } from '@shared/types'
import { errorMessage } from './errors'

type Status = { kind: 'ok' | 'error'; text: string } | null

const EFFECTS: { value: Effects3D; label: string; note: string }[] = [
  { value: 'auto', label: 'Auto', note: 'Se pausan con la ventana oculta, sin foco o durante un juego, y se quitan con movimiento reducido.' },
  { value: 'siempre', label: 'Siempre', note: 'Igual que Auto, pero también con movimiento reducido activado en Windows.' },
  { value: 'nunca', label: 'Nunca', note: 'Imágenes fijas en lugar de 3D. Cero uso de GPU.' }
]

const PROVIDER_INFO: Record<AiProvider, { where: string; placeholder: string }> = {
  anthropic: { where: 'console.anthropic.com', placeholder: 'sk-ant-…' },
  gemini: { where: 'aistudio.google.com', placeholder: 'Clave de Google AI Studio' }
}

function ApiKey({ provider, onProvider, onKeyChange }: { provider: AiProvider; onProvider: (p: AiProvider) => void; onKeyChange: () => void }) {
  const [hasKey, setHasKey] = useState<Record<AiProvider, boolean | null>>({ anthropic: null, gemini: null })
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  useEffect(() => {
    for (const p of AI_PROVIDERS) void window.optikax.apiKey.has(p).then((has) => setHasKey((h) => ({ ...h, [p]: has })))
  }, [])

  const update = (has: boolean): void => {
    setHasKey((h) => ({ ...h, [provider]: has }))
    onKeyChange()
  }
  const current = hasKey[provider]
  const label = AI_PROVIDER_LABEL[provider]

  const run = (task: () => Promise<Status>): void => {
    setBusy(true)
    setStatus(null)
    task()
      .then(setStatus)
      .catch((e: unknown) => setStatus({ kind: 'error', text: errorMessage(e) }))
      .finally(() => setBusy(false))
  }

  const testResult = async (okText: string): Promise<Status> => {
    const r = await window.optikax.apiKey.test(provider)
    return r.ok ? { kind: 'ok', text: okText } : { kind: 'error', text: r.error ?? 'Error' }
  }

  return (
    <section className="setting">
      <div className="setting-head">
        <div>
          <h2>Análisis con IA</h2>
          <p>
            Elige el proveedor y guarda su API key. Se guarda cifrada por Windows en este equipo y solo la usa el proceso principal.
            Consíguela en {PROVIDER_INFO[provider].where}.
          </p>
        </div>
        <span className="setting-state" data-on={current || undefined}>
          {current === null ? '…' : current ? 'Clave guardada' : 'Sin clave'}
        </span>
      </div>
      <div className="segmented" role="group" aria-label="Proveedor de IA">
        {AI_PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={provider === p}
            disabled={busy}
            onClick={() => {
              setStatus(null)
              setDraft('')
              onProvider(p)
            }}
          >
            {AI_PROVIDER_LABEL[p]}
            {hasKey[p] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          run(async () => {
            await window.optikax.apiKey.set(provider, draft)
            setDraft('')
            update(true)
            return testResult('Clave guardada y conexión correcta.')
          })
        }}
      >
        <label htmlFor="api-key" className="sr-only">
          {current ? `Reemplazar la clave de ${label}` : `Pegar la clave de ${label}`}
        </label>
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={current ? 'Pegar una clave nueva para reemplazarla' : PROVIDER_INFO[provider].placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
          {busy ? 'Comprobando…' : 'Guardar'}
        </button>
      </form>
      {current && (
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
                await window.optikax.apiKey.clear(provider)
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
  onKeyChange: () => void
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
      <ApiKey
        provider={settings?.ia.proveedor ?? 'anthropic'}
        onProvider={(proveedor) => save({ ia: { proveedor } })}
        onKeyChange={onKeyChange}
      />

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
