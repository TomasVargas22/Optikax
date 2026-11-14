import { useEffect, useState } from 'react'
import type { AppInfo, GameModeStatus, HardwareProfile, MemStats, TweakInfo } from '@shared/types'
import { Core3D, Wave3D } from './effects'
import type { PageId } from './pages'
import { TuEquipo } from './TuEquipo'

const gb = (bytes: number): number => Math.round(bytes / 2 ** 30)

/** "Intel(R) Core(TM) i7-9700F CPU @ 3.00GHz" → "Intel Core i7-9700F". */
function shortCpu(name: string): string {
  return name
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\s+CPU\b.*$/i, '')
    .replace(/\s+\d+-Core Processor.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const PENALTY = { alta: 18, media: 10, baja: 4 } as const

/**
 * Optikax Score (0–100): 60 % salud del hardware (problemas detectados) y
 * 40 % ajustes de riesgo bajo aplicados de los que corresponden a este equipo.
 */
function optikaxScore(hw: HardwareProfile, tweaks: TweakInfo[] | null): number {
  const hwScore = Math.max(0, 100 - hw.issues.reduce((sum, i) => sum + PENALTY[i.severidad], 0))
  const candidates = (tweaks ?? []).filter((t) => t.motivoNoAplica === null && t.riesgo === 'bajo')
  const tweakScore = candidates.length ? (candidates.filter((t) => t.activo).length / candidates.length) * 100 : 100
  return Math.round(hwScore * 0.6 + tweakScore * 0.4)
}

const ago = (iso: string): string => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`
}

interface Props {
  hw: HardwareProfile | null
  hwError: string | null
  onRescan: () => void
  rescanning: boolean
  mem: MemStats | null
  info: AppInfo | null
  game: GameModeStatus | null
  onNavigate: (page: PageId) => void
}

export function Panel({ hw, hwError, onRescan, rescanning, mem, info, game, onNavigate }: Props) {
  const [tweaks, setTweaks] = useState<TweakInfo[] | null>(null)
  const [pulse, setPulse] = useState(0)

  useEffect(() => {
    window.optikax.tweaks.list().then(setTweaks, () => setTweaks([]))
    // Cada limpieza de memoria hace que el núcleo se disperse y se vuelva a juntar.
    return window.optikax.memory.onEvent((e) => e.freedBytes > 0 && setPulse((n) => n + 1))
  }, [])

  const usage = mem ? (mem.totalBytes - mem.availBytes) / mem.totalBytes : 0.5
  const score = hw ? optikaxScore(hw, tweaks) : null
  const applicable = (tweaks ?? []).filter((t) => t.motivoNoAplica === null)
  const active = applicable.filter((t) => t.activo).length
  const d = hw?.derived

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Optimizador para gaming</p>
          <h1 className="display">
            Detecta <em>ajusta</em>
            <br />
            juega
          </h1>
          <p className="lede">
            Detecta tu hardware, lo ajusta solo con cambios seguros y reversibles, y prepara el equipo cada vez que abres un juego.
          </p>

          {hw && (
            <ul className="hw-chips" aria-label="Tu equipo">
              {hw.cpu?.name && <li>{shortCpu(hw.cpu.name)}</li>}
              {d?.gpu && <li>{d.gpu.name.replace(/^NVIDIA\s+|^AMD\s+/i, '')}</li>}
              {d?.ram && (
                <li className="num">
                  {gb(d.ram.totalBytes)} GB {d.ram.type ?? ''}
                  {d.ram.configuredMHz ? ` · ${d.ram.configuredMHz} MHz` : ''}
                </li>
              )}
              {d?.display && <li className="num">{d.display.hz} Hz</li>}
            </ul>
          )}

          <div className="score">
            <p className="score-figure num" aria-label={`Optikax Score ${score ?? 'calculando'} de 100`}>
              {score ?? '—'}
            </p>
            <p className="score-label">
              <b>Optikax Score</b>
              Salud del hardware y ajustes recomendados aplicados.
            </p>
          </div>
        </div>
        <Core3D usage={usage} pulse={pulse} />
      </section>

      <section className="steps-wrap">
        <Wave3D />
        <ol className="steps">
          <li className="step">
            <span className="step-num num">01</span>
            <h2>Escanear</h2>
            <p>
              {hwError
                ? `No se pudo leer el hardware: ${hwError}`
                : hw
                  ? `${hw.issues.length === 0 ? 'Sin problemas' : `${hw.issues.length} problema${hw.issues.length > 1 ? 's' : ''}`} · ${ago(hw.scannedAt)}`
                  : 'Escaneando…'}
            </p>
            <button type="button" className="pill" disabled={rescanning} onClick={onRescan}>
              {rescanning ? 'Escaneando…' : 'Volver a escanear'}
            </button>
          </li>
          <li className="step">
            <span className="step-num num">02</span>
            <h2>Jugar</h2>
            <p>
              {game?.juego
                ? `Jugando ${game.juego.name}`
                : game?.activo
                  ? `Modo Juego vigilando · ${game.sesiones.length} sesion${game.sesiones.length === 1 ? '' : 'es'}`
                  : 'Modo Juego apagado'}
            </p>
            <button type="button" className="pill" onClick={() => onNavigate('juego')}>
              Ver Modo Juego
            </button>
          </li>
          <li className="step" data-primary="">
            <span className="step-num num">03</span>
            <h2>Aplicar</h2>
            <p>{tweaks ? `${active} de ${applicable.length} ajustes activos` : 'Leyendo ajustes…'}</p>
            <button type="button" className="btn-primary" onClick={() => onNavigate('optimizar')}>
              Ver ajustes
            </button>
          </li>
        </ol>
      </section>

      {/* Los problemas detectados forman parte de las recomendaciones por componente. */}
      {hw && <TuEquipo key={hw.scannedAt} />}

      <ul className="guarantees">
        <li>Sin tocar servicios</li>
        <li>Todo reversible</li>
        <li>Punto de restauración</li>
        <li>100 % offline</li>
        {info && !info.elevado && <li data-warn="">Sin permisos de administrador</li>}
      </ul>
    </>
  )
}
