import type { HardwareProfile, HardwareRaw, ScanProgress } from '@shared/types'
import { derive, findIssues } from './hardware-rules'
import { runScript } from './ps'

let last: HardwareProfile | null = null
let running: Promise<HardwareProfile> | null = null

/** El script devuelve [null] cuando una sección de lista falla. */
function clean<T>(list: T[] | null | undefined): T[] {
  return (list ?? []).filter((x) => x !== null && x !== undefined)
}

// Lo normal son ~6 s, pero WMI a veces se queda ocupado y una pasada llega a tardar más de un minuto.
const SCAN_TIMEOUT_MS = 120_000

async function runScan(onProgress: (p: ScanProgress) => void): Promise<HardwareRaw> {
  try {
    return await runScript<HardwareRaw>('hardware.ps1', { onProgress, timeoutMs: SCAN_TIMEOUT_MS })
  } catch {
    // Un segundo intento suele entrar rápido cuando WMI ya se liberó.
    onProgress({ progress: 0, step: 'reintentando' })
    return runScript<HardwareRaw>('hardware.ps1', { onProgress, timeoutMs: SCAN_TIMEOUT_MS })
  }
}

async function scan(onProgress: (p: ScanProgress) => void): Promise<HardwareProfile> {
  const raw = await runScan(onProgress)
  raw.gpus = clean(raw.gpus)
  raw.disks = clean(raw.disks)
  raw.displays = clean(raw.displays)
  raw.monitorNames = clean(raw.monitorNames)
  raw.errors = clean(raw.errors)

  const derived = derive(raw)
  last = { ...raw, scannedAt: new Date().toISOString(), derived, issues: findIssues(raw, derived) }
  return last
}

/** Devuelve el último escaneo, o lanza uno. Varios llamadores comparten el mismo escaneo en curso. */
export function getHardware(force: boolean, onProgress: (p: ScanProgress) => void): Promise<HardwareProfile> {
  if (running) return running
  if (last && !force) return Promise.resolve(last)
  running = scan(onProgress).finally(() => (running = null))
  return running
}

export function lastHardware(): HardwareProfile | null {
  return last
}
