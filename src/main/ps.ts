import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const POWERSHELL = join(
  process.env['SystemRoot'] ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']

export function scriptPath(name: string): string {
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'scripts')
    : join(app.getAppPath(), 'resources', 'scripts')
  return join(dir, name)
}

export interface ScriptProgress {
  progress: number
  step: string
}

export interface RunScriptOptions {
  input?: unknown
  timeoutMs?: number
  onProgress?: (p: ScriptProgress) => void
}

/**
 * Ejecuta un script de una sola pasada. El script recibe `input` como JSON por stdin
 * y escribe líneas JSON por stdout: `{"progress":N,"step":"..."}` mientras trabaja
 * y `{"result":...}` al terminar.
 */
export function runScript<T>(name: string, opts: RunScriptOptions = {}): Promise<T> {
  const { input = {}, timeoutMs = 60_000, onProgress } = opts
  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL, [...PS_ARGS, scriptPath(name)], { windowsHide: true })
    let result: { value: T } | null = null
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${name} no respondió en ${Math.round(timeoutMs / 1000)} s.`))
    }, timeoutMs)

    createInterface({ input: child.stdout }).on('line', (line) => {
      let msg: unknown
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (typeof msg !== 'object' || msg === null) return
      if ('result' in msg) result = { value: msg.result as T }
      else if ('progress' in msg) onProgress?.(msg as ScriptProgress)
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-2000)))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (result) resolve(result.value)
      else reject(new Error(`${name} no devolvió un resultado (código ${code}). ${stderr.trim()}`.trim()))
    })
    child.stdin.end(JSON.stringify(input))
  })
}

interface Pending {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

type WorkerLine =
  | { ready: true; privileges: Record<string, boolean> }
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: string }

const READY_TIMEOUT_MS = 30_000
const MAX_BACKOFF_MS = 30_000

/**
 * Proceso de PowerShell de larga vida que compila el código nativo una sola vez.
 * Arranca en la primera petición y, si muere, se reinicia con espera creciente.
 */
class PsWorker {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private failures = 0
  private lastFailure = 0
  private stopped = false
  privileges: Record<string, boolean> = {}

  async request<T>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    if (this.stopped) throw new Error('El worker está detenido.')
    await this.ensureStarted()
    const child = this.child
    if (!child) throw new Error('El worker nativo no está disponible.')

    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`El worker no respondió a "${cmd}" en ${Math.round(timeoutMs / 1000)} s.`))
        // Atiende en serie: si se colgó en una petición, las siguientes tampoco saldrían.
        child.kill()
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (d: unknown) => void, reject, timer })
      child.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
    })
  }

  stop(): void {
    this.stopped = true
    this.child?.stdin.end()
    this.child?.kill()
  }

  private ensureStarted(): Promise<void> {
    if (this.child && !this.starting) return Promise.resolve()
    this.starting ??= this.start().finally(() => (this.starting = null))
    return this.starting
  }

  private async start(): Promise<void> {
    if (this.failures > 0) {
      const backoff = Math.min(MAX_BACKOFF_MS, 500 * 2 ** (this.failures - 1))
      const wait = this.lastFailure + backoff - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    }
    if (this.stopped) throw new Error('El worker está detenido.')

    const child = spawn(POWERSHELL, [...PS_ARGS, scriptPath('worker.ps1')], { windowsHide: true })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-2000)))

    await new Promise<void>((resolve, reject) => {
      const readyTimer = setTimeout(() => {
        child.kill()
        reject(new Error('El worker nativo tardó demasiado en arrancar.'))
      }, READY_TIMEOUT_MS)

      const onDown = (reason: string): void => {
        clearTimeout(readyTimer)
        if (this.child === child) this.child = null
        this.failures++
        this.lastFailure = Date.now()
        const err = new Error(`El worker nativo se cerró (${reason}). ${stderr.trim()}`.trim())
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(err)
        }
        this.pending.clear()
        reject(err)
      }
      child.once('error', (e) => onDown(e.message))
      child.once('exit', (code) => onDown(`código ${code}`))

      createInterface({ input: child.stdout }).on('line', (line) => {
        let msg: WorkerLine
        try {
          msg = JSON.parse(line) as WorkerLine
        } catch {
          return // ruido que no es del protocolo
        }
        if ('ready' in msg) {
          clearTimeout(readyTimer)
          this.child = child
          this.privileges = msg.privileges
          this.failures = 0
          resolve()
          return
        }
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.data)
        else p.reject(new Error(msg.error))
      })
    })
  }
}

export const worker = new PsWorker()
