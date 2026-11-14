import { useEffect, useState } from 'react'
import type { ScanProgress } from '@shared/types'

const STEP_TEXT: Record<string, string> = {
  cpu: 'detectando procesador',
  gpu: 'detectando tarjeta gráfica',
  ram: 'leyendo memoria',
  placa: 'leyendo placa y BIOS',
  discos: 'revisando discos',
  pantallas: 'midiendo pantallas',
  sistema: 'leyendo Windows',
  listo: 'listo',
  reintentando: 'Windows tarda en responder, reintentando'
}

/**
 * Pantalla de arranque: el contador refleja el progreso real del escaneo de hardware.
 * Al llegar a 100 se desvanece y deja paso a la app.
 */
export function Loader({ progress, done }: { progress: ScanProgress | null; done: boolean }) {
  const target = done ? 100 : (progress?.progress ?? 0)
  const [shown, setShown] = useState(0)
  const [gone, setGone] = useState(false)

  // El número sube hacia el progreso real sin saltos bruscos.
  useEffect(() => {
    if (shown >= target) return
    const id = setTimeout(() => setShown((n) => Math.min(target, n + Math.max(1, Math.ceil((target - n) / 6)))), 24)
    return () => clearTimeout(id)
  }, [shown, target])

  useEffect(() => {
    if (!done || shown < 100) return
    const id = setTimeout(() => setGone(true), 450)
    return () => clearTimeout(id)
  }, [done, shown])

  if (gone) return null
  return (
    <div className="loader" data-leaving={done && shown >= 100 ? '' : undefined} role="status" aria-live="polite">
      <p className="loader-status">{done ? 'listo' : `${STEP_TEXT[progress?.step ?? ''] ?? 'iniciando'}…`}</p>
      <div className="loader-mark" aria-hidden="true">
        O<i>.</i>
        <span className="loader-spark">✳</span>
      </div>
      <p className="loader-count num" aria-label={`Cargando ${shown} por ciento`}>
        {shown}
      </p>
    </div>
  )
}
