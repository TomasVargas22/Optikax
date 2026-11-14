import { useEffect, useState } from 'react'
import type { AppInfo, MemStats, Settings, WindowState } from '@shared/types'

const gb = (bytes: number): string => (bytes / 2 ** 30).toFixed(1)
import { Ajustes } from './Ajustes'
import { Analisis } from './Analisis'
import { errorMessage } from './errors'
import { HardwareSummary } from './HardwareSummary'
import { Memoria } from './Memoria'
import { Optimizar } from './Optimizar'
import { PAGES, type PageId } from './pages'

export function App() {
  const [pageId, setPageId] = useState<PageId>('panel')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [windowState, setWindowState] = useState<WindowState>('visible')
  const [mem, setMem] = useState<MemStats | null>(null)
  const [memError, setMemError] = useState<string | null>(null)

  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0]
  const mainPages = PAGES.filter((p) => p.id !== 'ajustes')

  useEffect(() => {
    void window.optikax.app.info().then(setInfo)
    void window.optikax.settings.get().then(setSettings)
    void window.optikax.apiKey.has().then(setHasKey)
    return window.optikax.app.onWindowState(setWindowState)
  }, [])

  // Lectura de memoria en vivo; se detiene cuando la ventana no se ve.
  const watchMemory = pageId === 'panel' && windowState !== 'oculta'
  useEffect(() => {
    if (!watchMemory) return
    let alive = true
    const read = (): void => {
      window.optikax.memory.stats().then(
        (m) => alive && (setMem(m), setMemError(null)),
        (e: unknown) => alive && setMemError(errorMessage(e))
      )
    }
    read()
    const timer = setInterval(read, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [watchMemory])

  // Los botones nativos de la ventana siguen el tema de la pantalla.
  useEffect(() => {
    void window.optikax.app.setTitleBarTheme(page.theme)
  }, [page.theme])

  return (
    <div className="shell" data-theme={page.theme} data-window={windowState}>
      <header className="titlebar">
        <div className="brand">
          O<i>.</i>
        </div>
        <nav className="nav" aria-label="Principal">
          {mainPages.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === pageId ? 'page' : undefined}
              onClick={() => setPageId(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="titlebar-end">
          <button
            type="button"
            className="pill"
            aria-current={pageId === 'ajustes' ? 'page' : undefined}
            onClick={() => setPageId('ajustes')}
          >
            Ajustes
          </button>
        </div>
      </header>

      <main className="page" key={page.id}>
        {page.id === 'memoria' ? (
          <Memoria visible={windowState !== 'oculta'} />
        ) : (
          <>
            <p className="eyebrow">{page.eyebrow}</p>
            <h1 className="display">{page.title}</h1>
            <p className="lede">{page.lede}</p>
          </>
        )}

        {page.id === 'panel' && <HardwareSummary />}
        {page.id === 'optimizar' && <Optimizar />}
        {page.id === 'ia' && <Analisis onOpenSettings={() => setPageId('ajustes')} />}
        {page.id === 'ajustes' && <Ajustes onKeyChange={setHasKey} />}

        {page.id === 'panel' && (
          <div className="status">
            <span className="chip">
              <span className="dot" data-state={info ? (info.elevado ? 'ok' : 'warn') : undefined} />
              Permisos <b>{info ? (info.elevado ? 'Administrador' : 'Limitados') : '…'}</b>
            </span>
            <span className="chip">
              <span className="dot" data-state={hasKey ? 'ok' : undefined} />
              API key <b>{hasKey === null ? '…' : hasKey ? 'Guardada' : 'Sin configurar'}</b>
            </span>
            <span className="chip" title={memError ?? undefined}>
              <span className="dot" data-state={memError ? 'warn' : mem ? 'ok' : undefined} />
              RAM{' '}
              {memError ? (
                <b>Sin lectura</b>
              ) : mem ? (
                <>
                  <b className="num">{gb(mem.totalBytes - mem.availBytes)}</b> en uso ·{' '}
                  <b className="num">{gb(mem.standbyBytes)}</b> standby ·{' '}
                  <b className="num">{gb(mem.freeBytes)}</b> libre ·{' '}
                  <b className="num">{gb(mem.totalBytes)}</b> GB
                </>
              ) : (
                <b>…</b>
              )}
            </span>
            <span className="chip">
              Efectos 3D <b>{settings?.efectos3d ?? '…'}</b>
            </span>
            <span className="chip">
              Versión <b className="num">{info?.version ?? '…'}</b>
            </span>
          </div>
        )}
      </main>
    </div>
  )
}
