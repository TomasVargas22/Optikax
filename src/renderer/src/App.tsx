import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, GameModeStatus, HardwareProfile, MemStats, ScanProgress, Settings, WindowState } from '@shared/types'
import { Ajustes } from './Ajustes'
import { Analisis } from './Analisis'
import { EffectsContext, useReducedMotion } from './effects'
import { errorMessage } from './errors'
import { Loader } from './Loader'
import { Memoria } from './Memoria'
import { ModoJuego } from './ModoJuego'
import { Optimizar } from './Optimizar'
import { PAGES, type PageId } from './pages'
import { Panel } from './Panel'

export function App() {
  const [pageId, setPageId] = useState<PageId>('panel')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [windowState, setWindowState] = useState<WindowState>('visible')
  const [mem, setMem] = useState<MemStats | null>(null)
  const [game, setGame] = useState<GameModeStatus | null>(null)
  const [hw, setHw] = useState<HardwareProfile | null>(null)
  const [hwError, setHwError] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [scanning, setScanning] = useState(true)
  const reduced = useReducedMotion()

  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0]
  const mainPages = PAGES.filter((p) => p.id !== 'ajustes')

  // El escaneo de hardware arranca con la app: el loader muestra su progreso real.
  const runScan = useCallback((force: boolean) => {
    setScanning(true)
    setHwError(null)
    window.optikax.hardware
      .scan(force)
      .then(setHw, (e: unknown) => setHwError(errorMessage(e)))
      .finally(() => setScanning(false))
  }, [])

  useEffect(() => {
    const offScan = window.optikax.hardware.onProgress(setScan)
    runScan(false)
    void window.optikax.app.info().then(setInfo)
    void window.optikax.settings.get().then(setSettings)
    void window.optikax.apiKey.has().then(setHasKey)
    void window.optikax.gameMode.status().then(setGame)
    const offGame = window.optikax.gameMode.onChange(setGame)
    const offWindow = window.optikax.app.onWindowState(setWindowState)
    return () => {
      offScan()
      offGame()
      offWindow()
    }
  }, [runScan])

  // Con un juego abierto la app se queda quieta: sin animaciones, 3D ni sondeos de la interfaz.
  const playing = game?.juego != null
  const mode = settings?.efectos3d ?? 'auto'
  const effects = {
    enabled: mode === 'siempre' || (mode === 'auto' && !reduced),
    active: windowState === 'visible' && !playing
  }

  // Memoria en vivo para el núcleo del Panel; se detiene cuando no se ve.
  const watchMemory = pageId === 'panel' && windowState !== 'oculta' && !playing
  useEffect(() => {
    if (!watchMemory) return
    let alive = true
    const read = (): void => {
      window.optikax.memory.stats().then(
        (m) => alive && setMem(m),
        () => {}
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

  const loaded = hw !== null || hwError !== null

  return (
    <EffectsContext.Provider value={effects}>
      <div className="shell" data-theme={page.theme} data-window={windowState} data-game={playing || undefined}>
        <header className="titlebar">
          <div className="brand">
            O<i>.</i>
          </div>
          <nav className="nav" aria-label="Principal">
            {mainPages.map((p) => (
              <button key={p.id} type="button" aria-current={p.id === pageId ? 'page' : undefined} onClick={() => setPageId(p.id)}>
                {p.label}
                {p.id === 'juego' && playing && <span className="nav-dot" aria-label="(jugando)" />}
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

        <main className="page" key={page.id} data-page={page.id}>
          {page.id === 'panel' ? (
            <Panel
              hw={hw}
              hwError={hwError}
              onRescan={() => runScan(true)}
              rescanning={scanning && loaded}
              mem={mem}
              info={info}
              hasKey={hasKey}
              onNavigate={setPageId}
            />
          ) : page.id === 'memoria' ? (
            <Memoria visible={windowState !== 'oculta' && !playing} />
          ) : (
            <>
              <p className="eyebrow">{page.eyebrow}</p>
              <h1 className="display">{page.title}</h1>
              <p className="lede">{page.lede}</p>
            </>
          )}

          {page.id === 'optimizar' && <Optimizar />}
          {page.id === 'ia' && <Analisis onOpenSettings={() => setPageId('ajustes')} />}
          {page.id === 'juego' && <ModoJuego status={game} />}
          {page.id === 'ajustes' && (
            <Ajustes
              settings={settings}
              onSettings={setSettings}
              onKeyChange={setHasKey}
              onOpenGameMode={() => setPageId('juego')}
              onOpenMemory={() => setPageId('memoria')}
            />
          )}
        </main>

        <Loader progress={scan} done={loaded} />
      </div>
    </EffectsContext.Provider>
  )
}
