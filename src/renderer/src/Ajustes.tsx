import { useEffect, useState } from 'react'
import { errorMessage } from './errors'

/** Pantalla Ajustes: por ahora solo la API key; el resto de opciones llega en la fase de interfaz. */
export function Ajustes({ onKeyChange }: { onKeyChange: (has: boolean) => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    void window.optikax.apiKey.has().then(setHasKey)
  }, [])

  const update = (has: boolean): void => {
    setHasKey(has)
    onKeyChange(has)
  }

  const save = (): void => {
    setBusy(true)
    setStatus(null)
    window.optikax.apiKey
      .set(draft)
      .then(() => {
        setDraft('')
        update(true)
        return window.optikax.apiKey.test()
      })
      .then((r) =>
        setStatus(r.ok ? { kind: 'ok', text: 'Clave guardada y conexión correcta.' } : { kind: 'error', text: r.error ?? 'Error' })
      )
      .catch((e: unknown) => setStatus({ kind: 'error', text: errorMessage(e) }))
      .finally(() => setBusy(false))
  }

  const test = (): void => {
    setBusy(true)
    setStatus(null)
    window.optikax.apiKey
      .test()
      .then((r) => setStatus(r.ok ? { kind: 'ok', text: 'Conexión correcta.' } : { kind: 'error', text: r.error ?? 'Error' }))
      .finally(() => setBusy(false))
  }

  const clear = (): void => {
    void window.optikax.apiKey.clear().then(() => {
      update(false)
      setStatus({ kind: 'ok', text: 'Clave borrada.' })
    })
  }

  return (
    <section className="block">
      <div className="block-head">
        <p className="eyebrow">API key de Anthropic · {hasKey === null ? '…' : hasKey ? 'guardada' : 'sin configurar'}</p>
        <div className="toolbar">
          {hasKey && (
            <>
              <button type="button" className="pill" disabled={busy} onClick={test}>
                Probar conexión
              </button>
              <button type="button" className="pill" disabled={busy} onClick={clear}>
                Borrar
              </button>
            </>
          )}
        </div>
      </div>
      <p className="lede">
        Se guarda cifrada con Windows en este equipo y solo la usa el proceso principal para el análisis con IA. Consíguela en
        console.anthropic.com.
      </p>
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) save()
        }}
      >
        <label htmlFor="api-key" className="eyebrow">
          {hasKey ? 'Reemplazar clave' : 'Pegar clave'}
        </label>
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
          {busy ? 'Comprobando…' : 'Guardar'}
        </button>
      </form>
      <div aria-live="polite">{status && <p className="notice" data-kind={status.kind}>{status.text}</p>}</div>
    </section>
  )
}
