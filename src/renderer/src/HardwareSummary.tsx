import { useEffect, useState } from 'react'
import { errorMessage } from './errors'
import type { HardwareProfile, ScanProgress } from '@shared/types'

const STEP_LABEL: Record<string, string> = {
  cpu: 'procesador',
  gpu: 'tarjeta gráfica',
  ram: 'memoria',
  placa: 'placa madre',
  discos: 'discos',
  pantallas: 'pantallas',
  sistema: 'sistema',
  listo: 'listo'
}

const gb = (bytes: number): number => Math.round(bytes / 2 ** 30)

/** Quita el ruido comercial: "Intel(R) Core(TM) i7-9700F CPU @ 3.00GHz" → "Intel Core i7-9700F". */
function shortCpu(name: string): string {
  return name
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\s+CPU\b.*$/i, '')
    .replace(/\s+\d+-Core Processor.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Vista provisional del hardware y sus problemas; el diseño final llega en la fase 8. */
export function HardwareSummary() {
  const [hw, setHw] = useState<HardwareProfile | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const scan = (force: boolean): void => {
    setScanning(true)
    setError(null)
    window.optikax.hardware
      .scan(force)
      .then(setHw, (e: unknown) => setError(errorMessage(e)))
      .finally(() => {
        setScanning(false)
        setProgress(null)
      })
  }

  useEffect(() => {
    const off = window.optikax.hardware.onProgress(setProgress)
    scan(false)
    return off
  }, [])

  if (error) {
    return (
      <section className="block">
        <p className="eyebrow">Hardware</p>
        <p className="lede">No se pudo leer el hardware: {error}</p>
        <button type="button" className="pill" onClick={() => scan(true)}>
          Reintentar
        </button>
      </section>
    )
  }

  if (!hw) {
    return (
      <section className="block" aria-live="polite">
        <p className="eyebrow">
          Escaneando {progress ? STEP_LABEL[progress.step] ?? progress.step : 'hardware'}…{' '}
          <span className="num">{progress?.progress ?? 0}%</span>
        </p>
      </section>
    )
  }

  const { cpu, gpu, ram, display, systemDisk } = hw.derived
  return (
    <>
      <section className="block">
        <div className="block-head">
          <p className="eyebrow">Tu equipo</p>
          <button type="button" className="pill" disabled={scanning} onClick={() => scan(true)}>
            {scanning ? `Escaneando… ${progress?.progress ?? 0}%` : 'Volver a escanear'}
          </button>
        </div>
        <div className="status">
          {hw.cpu?.name && (
            <span className="chip">
              CPU <b>{shortCpu(hw.cpu.name)}</b>
              <span className="num">
                {hw.cpu.cores}N/{hw.cpu.threads}H
                {cpu?.generation ? ` · gen ${cpu.generation}` : ''}
              </span>
            </span>
          )}
          {gpu && (
            <span className="chip">
              GPU <b>{gpu.name}</b>
              {gpu.vramBytes && <span className="num">{gb(gpu.vramBytes)} GB</span>}
            </span>
          )}
          {ram && (
            <span className="chip">
              RAM <b className="num">{gb(ram.totalBytes)} GB</b>
              <span className="num">
                {[ram.type, ram.configuredMHz && `${ram.configuredMHz} MHz`, `${ram.modules} módulo${ram.modules > 1 ? 's' : ''}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          )}
          {display && (
            <span className="chip">
              Pantalla{' '}
              <b className="num">
                {display.width}×{display.height}
              </b>
              <span className="num">{display.hz} Hz</span>
            </span>
          )}
          {systemDisk && (
            <span className="chip">
              Sistema en <b>{systemDisk.kind}</b>
            </span>
          )}
          {hw.board?.product && (
            <span className="chip">
              Placa <b>{hw.board.product}</b>
            </span>
          )}
          {hw.os?.caption && (
            <span className="chip">
              <b>{hw.os.caption.replace(/^Microsoft\s+/, '')}</b>
              <span>{hw.os.displayVersion}</span>
            </span>
          )}
          <span className="chip">
            <b>{hw.isLaptop ? 'Laptop' : 'Escritorio'}</b>
            {hw.power?.name && <span>{hw.power.name}</span>}
          </span>
        </div>
      </section>

      <section className="block">
        <p className="eyebrow">
          {hw.issues.length === 0
            ? 'Sin problemas detectados'
            : `${hw.issues.length} problema${hw.issues.length > 1 ? 's' : ''} detectado${hw.issues.length > 1 ? 's' : ''}`}
        </p>
        <ul className="issues">
          {hw.issues.map((issue) => (
            <li key={issue.id} className="issue" data-severity={issue.severidad}>
              <span className="issue-tag">Prioridad {issue.severidad}</span>
              <h3>{issue.titulo}</h3>
              <p>{issue.detalle}</p>
              <p className="issue-action">{issue.accion}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
