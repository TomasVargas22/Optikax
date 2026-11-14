import { Component, createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Cuándo hay 3D y cuándo se mueve.
 * - enabled: "Siempre", o "Auto" sin movimiento reducido. "Nunca" pone una imagen estática.
 * - active: además, ventana visible y con foco, y sin juego abierto. Si no, cero fotogramas.
 */
export interface EffectsState {
  enabled: boolean
  active: boolean
}

export const EffectsContext = createContext<EffectsState>({ enabled: false, active: false })

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = (): void => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

const LazyCore = lazy(() => import('./three/Scenes').then((m) => ({ default: m.CoreScene })))
const LazyWave = lazy(() => import('./three/Scenes').then((m) => ({ default: m.WaveScene })))

/** Si WebGL falla (driver, GPU bloqueada), se queda la versión estática. */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function Core3D({ usage, pulse }: { usage: number; pulse: number }) {
  const { enabled, active } = useContext(EffectsContext)
  const still = <div className="core-static" aria-hidden="true" />
  if (!enabled) return still
  return (
    <div className="core-3d" aria-hidden="true">
      <Fallback fallback={still}>
        <Suspense fallback={still}>
          <LazyCore usage={usage} pulse={pulse} active={active} />
        </Suspense>
      </Fallback>
    </div>
  )
}

export function Wave3D() {
  const { enabled, active } = useContext(EffectsContext)
  const still = <div className="wave-static" aria-hidden="true" />
  if (!enabled) return still
  return (
    <div className="wave-3d" aria-hidden="true">
      <Fallback fallback={still}>
        <Suspense fallback={still}>
          <LazyWave active={active} />
        </Suspense>
      </Fallback>
    </div>
  )
}
