import type { MemStats, PriorityLevel, ProcInfo, PurgeKind, PurgeResult } from '@shared/types'
import { worker } from './ps'

/** Llamadas tipadas al código nativo del worker (resources/scripts/worker.ps1). */
export const native = {
  memStats: () => worker.request<MemStats>('memStats'),
  /** Vaciar los working sets de todos los procesos puede tardar varios segundos. */
  purge: (kind: PurgeKind) => worker.request<PurgeResult>('purge', { kind }, 30_000),
  listProcesses: () => worker.request<ProcInfo[]>('listProcesses'),
  getPriority: (pid: number) =>
    worker.request<{ pid: number; priority: string }>('getPriority', { pid }),
  setPriority: (pid: number, level: PriorityLevel) =>
    worker.request<{ pid: number; priority: string }>('setPriority', { pid, level }),
  foregroundPid: () => worker.request<number | null>('foregroundPid')
}
