/**
 * Verificación del ciclo aplicar → leer → revertir de todo el catálogo (solo desarrollo).
 *
 * Se ejecuta con `npm run verify:tweaks`: arranca Electron con OPTIKAX_VERIFY=1, usa el motor real
 * (applyTweaks / revertTweaks) con un backup.json temporal y compara el sistema antes y después con
 * scripts/verify-tweaks.ps1, que lee el registro por su cuenta, sin pasar por el worker de la app.
 *
 * Este módulo nunca se carga en la app empaquetada (index.ts lo bloquea y electron-builder lo excluye).
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TweakActionResult, TweakId, TweakInfo } from '@shared/types'
import { getHardware } from './hardware'
import { applyTweaks, listTweaks, revertTweaks } from './tweaks'
import { backup } from './tweaks/backup'
import { CATALOG, TWEAKS, type TweakContext } from './tweaks/catalog'
import {
  createRestorePoint,
  power,
  regKey,
  regRead,
  regWrite,
  setMemoryCompression,
  setMouse,
  tweakEnv,
  type RegKind,
  type RegRef,
  type RegValue,
  type RegWrite
} from './tweaks/sys'

// ---------- Fotos del sistema ----------

interface Snapshot {
  registry: Record<string, { exists: boolean; values: Record<string, string> }>
  powerActive: string
  powerSchemes: string[]
  memoryCompression: boolean | null
  liveMouse: string
}

function runVerifyScript<T>(input: unknown): Promise<T> {
  const ps = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const file = join(app.getAppPath(), 'scripts', 'verify-tweaks.ps1')
  return new Promise((resolve, reject) => {
    const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      const line = out.split(/\r?\n/).find((l) => l.startsWith('{"result"'))
      if (!line) return reject(new Error(`verify-tweaks.ps1 falló (código ${code}): ${err.trim()}`))
      resolve((JSON.parse(line) as { result: T }).result)
    })
    child.stdin.end(JSON.stringify(input))
  })
}

const snapshot = (): Promise<Snapshot> => runVerifyScript<Snapshot>({ action: 'snapshot' })

/** Diferencias legibles entre dos fotos; vacío si son idénticas. */
function diff(a: Snapshot, b: Snapshot): string[] {
  const out: string[] = []
  for (const key of new Set([...Object.keys(a.registry), ...Object.keys(b.registry)])) {
    const x = a.registry[key] ?? { exists: false, values: {} }
    const y = b.registry[key] ?? { exists: false, values: {} }
    if (x.exists !== y.exists) out.push(`${key}: clave ${x.exists ? 'existía' : 'no existía'} → ${y.exists ? 'existe' : 'no existe'}`)
    for (const name of new Set([...Object.keys(x.values), ...Object.keys(y.values)])) {
      const before = x.values[name]
      const after = y.values[name]
      if (before !== after) out.push(`${key}\\${name}: ${before ?? '(no existe)'} → ${after ?? '(no existe)'}`)
    }
  }
  if (a.powerActive !== b.powerActive) out.push(`Plan activo: ${a.powerActive} → ${b.powerActive}`)
  const sa = [...a.powerSchemes].sort().join(',')
  const sb = [...b.powerSchemes].sort().join(',')
  if (sa !== sb) {
    const added = b.powerSchemes.filter((s) => !a.powerSchemes.includes(s))
    const removed = a.powerSchemes.filter((s) => !b.powerSchemes.includes(s))
    out.push(`Planes de energía: +[${added.join(', ')}] −[${removed.join(', ')}]`)
  }
  if (a.memoryCompression !== b.memoryCompression) out.push(`Compresión de memoria: ${a.memoryCompression} → ${b.memoryCompression}`)
  if (a.liveMouse !== b.liveMouse) out.push(`Mouse en vivo (umbral1,umbral2,acel): ${a.liveMouse} → ${b.liveMouse}`)
  return out
}

// ---------- Utilidades ----------

async function freshContext(): Promise<TweakContext> {
  const [hw, env, powerState] = await Promise.all([getHardware(false, () => {}), tweakEnv(), power.state()])
  return { hw, env, power: powerState }
}

const info = (list: TweakInfo[], id: TweakId): TweakInfo => list.find((t) => t.id === id)!
const firstError = (r: TweakActionResult): string | null => r.results.find((x) => !x.ok)?.error ?? null

/** Escrituras que dejan cada valor como estaba en `values`. */
function restoreWrites(values: RegValue[]): RegWrite[] {
  return values.map((v) =>
    v.exists && v.value !== null
      ? { path: v.path, name: v.name, kind: v.kind as RegKind, value: v.value }
      : { path: v.path, name: v.name, delete: true }
  )
}

/**
 * Este equipo ya tiene muchos ajustes puestos, y el motor no toca lo que ya está activo.
 * Para ejercitar el ciclo de verdad, se borran temporalmente los valores (el estado de fábrica
 * de Windows, que deja todos los ajustes de registro inactivos) y al final se restauran.
 */
async function forceInactive(ctx: TweakContext, ids: TweakId[]): Promise<() => Promise<void>> {
  const refs = lecturas(ctx, ids)
  const original = await regRead(refs)
  const present = original.filter((v) => v.exists)
  await regWrite(present.map((v) => ({ path: v.path, name: v.name, delete: true as const })))

  // Si el valor de fábrica ya cuenta como activo (p. ej. el Modo de juego), se escribe el contrario.
  const still = (await listTweaks()).filter((t) => ids.includes(t.id) && t.activo && t.motivoNoAplica === null)
  for (const t of still) {
    const targets = TWEAKS.get(t.id)!.lecturas(ctx) as (RegRef & { kind: RegKind; value: unknown })[]
    await regWrite(
      targets
        .filter((x) => x.kind === 'DWord' && typeof x.value === 'number')
        .map((x) => ({ path: x.path, name: x.name, kind: 'DWord' as const, value: x.value === 0 ? 1 : 0 }))
    )
  }

  // Estado de fábrica del mouse también en vivo, para que la foto de partida sea coherente.
  if (original.some((v) => v.path === MOUSE)) await setMouse(6, 10, 1)

  return async () => {
    await regWrite(restoreWrites(original))
    // El registro del mouse no basta: hay que volver a aplicar en vivo el valor original.
    const mouse = original.filter((v) => v.path === MOUSE)
    if (mouse.length > 0) {
      const get = (name: string, fallback: number): number => {
        const v = mouse.find((m) => m.name === name)
        const n = Number.parseInt(String(v?.exists ? v.value : ''), 10)
        return Number.isFinite(n) ? n : fallback
      }
      await setMouse(get('MouseThreshold1', 6), get('MouseThreshold2', 10), get('MouseSpeed', 1))
    }
  }
}

const MOUSE = 'HKCU\\Control Panel\\Mouse'

const lecturas = (ctx: TweakContext, ids: TweakId[]): RegRef[] => ids.flatMap((id) => TWEAKS.get(id)!.lecturas(ctx))

// ---------- Ciclo por ajuste ----------

interface Row {
  id: TweakId
  aplica: string | null
  activoAlInicio: boolean
  modo: string
  aplicaOk: boolean
  leeOk: boolean
  revierteOk: boolean
  identico: boolean
  cambios: string[]
  restos: string[]
  notas: string[]
}

async function cycle(id: TweakId): Promise<Row> {
  const ctx = await freshContext()
  const start = info(await listTweaks(), id)
  const tweak = TWEAKS.get(id)!
  const row: Row = {
    id,
    aplica: start.motivoNoAplica,
    activoAlInicio: start.activo,
    modo: 'motor',
    aplicaOk: false,
    leeOk: false,
    revierteOk: false,
    identico: false,
    cambios: [],
    restos: [],
    notas: []
  }

  const snap0 = await snapshot()
  let restore: (() => Promise<void>) | null = null

  try {
    // Preparar un estado inactivo cuando el ajuste ya estaba puesto.
    if (start.activo && tweak.lecturas(ctx).length > 0) {
      restore = await forceInactive(ctx, [id])
      row.modo = 'motor (estado de fábrica simulado)'
    } else if (id === 'memory_compression_off' && ctx.env.memoryCompression === false) {
      await setMemoryCompression(true)
      restore = async () => {
        await setMemoryCompression(false)
      }
      row.modo = 'directo (compresión activada temporalmente)'
    }

    const base = await snapshot()

    if (start.motivoNoAplica === null) {
      const applied = await applyTweaks([id])
      row.aplicaOk = applied.results[0]?.ok === true
      if (!row.aplicaOk) row.notas.push(`aplicar: ${firstError(applied)}`)
      const after = info(applied.tweaks, id)
      row.leeOk = after.activo && after.revertible
      const snap1 = await snapshot()
      row.cambios = diff(base, snap1)

      const reverted = await revertTweaks([id])
      row.revierteOk = reverted.results[0]?.ok === true && !info(reverted.tweaks, id).revertible
      if (!row.revierteOk) row.notas.push(`revertir: ${firstError(reverted)}`)
    } else {
      // No aplica a este equipo: el motor lo rechaza, así que se prueba la lógica del ajuste directamente.
      if (!row.modo.startsWith('directo')) row.modo = 'directo (no aplica a este equipo)'
      const ctxBase = await freshContext()
      const data = await tweak.respaldar(ctxBase)
      await tweak.aplicar(ctxBase, data)
      row.aplicaOk = true
      const ctxAfter = await freshContext()
      const reg = new Map((await regRead(tweak.lecturas(ctxAfter))).map((v) => [regKey(v), v]))
      row.leeOk = tweak.activo(ctxAfter, reg, data)
      row.cambios = diff(base, await snapshot())
      await tweak.revertir(data)
      row.revierteOk = true
    }

    row.restos = diff(base, await snapshot())
  } catch (err) {
    row.notas.push(`excepción: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    if (restore) await restore()
  }

  const final = diff(snap0, await snapshot())
  row.identico = row.restos.length === 0 && final.length === 0
  if (final.length > 0) row.notas.push(`tras restaurar quedó distinto: ${final.join(' | ')}`)
  return row
}

// ---------- Casos borde ----------

interface Edge {
  caso: string
  ok: boolean
  detalle: string[]
}

const DX_PREFS = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const DX_VALUE = { path: DX_PREFS, name: 'DirectXUserGlobalSettings' }

async function edgeWindowed(preset: string | null): Promise<Edge> {
  const caso = `windowed_optimizations con valor previo ${preset === null ? '(no existe)' : JSON.stringify(preset)}`
  const detalle: string[] = []
  const snap0 = await snapshot()
  const [orig] = await regRead([DX_VALUE])
  try {
    if (preset !== null) await regWrite([{ ...DX_VALUE, kind: 'String', value: preset }])
    const r = await applyTweaks(['windowed_optimizations'])
    const [applied] = await regRead([DX_VALUE])
    const value = String(applied.value ?? '')
    detalle.push(`aplicado: ${JSON.stringify(value)}`)
    const keepsOthers = (preset ?? '')
      .split(';')
      .filter((p) => p && !/^SwapEffectUpgradeEnable=/i.test(p))
      .every((p) => value.includes(p))
    const okApply = firstError(r) === null && /(^|;)SwapEffectUpgradeEnable=1;/.test(value) && keepsOthers
    if (!keepsOthers) detalle.push('ERROR: se perdió parte del valor previo')

    await revertTweaks(['windowed_optimizations'])
    const [reverted] = await regRead([DX_VALUE])
    const okRevert = preset === null ? !reverted.exists : reverted.value === preset
    detalle.push(`revertido: ${reverted.exists ? JSON.stringify(reverted.value) : '(no existe)'}`)
    return { caso, ok: okApply && okRevert, detalle }
  } finally {
    // Volver al estado original del equipo (la clave no existía: se borra si queda vacía).
    const writes = restoreWrites([orig])
    if (!orig.keyExists) writes.push({ path: DX_PREFS, name: '', deleteKeyIfEmpty: true })
    await regWrite(writes)
    const rest = diff(snap0, await snapshot())
    if (rest.length > 0) detalle.push(`ERROR al limpiar: ${rest.join(' | ')}`)
  }
}

async function edgePowerRepeated(): Promise<Edge> {
  const detalle: string[] = []
  const snap0 = await snapshot()
  let ok = true
  for (let i = 1; i <= 3; i++) {
    const r = await applyTweaks(['power_ultimate'])
    const during = await snapshot()
    const added = during.powerSchemes.filter((s) => !snap0.powerSchemes.includes(s))
    detalle.push(`ciclo ${i}: activo ${during.powerActive}, planes nuevos ${added.length}`)
    if (firstError(r) || added.length > 1) ok = false
    await revertTweaks(['power_ultimate'])
  }
  const rest = diff(snap0, await snapshot())
  if (rest.length > 0) {
    ok = false
    detalle.push(`restos: ${rest.join(' | ')}`)
  } else detalle.push('tras 3 ciclos: plan activo y lista de planes idénticos al original')
  return { caso: 'power_ultimate: 3 ciclos seguidos sin planes huérfanos', ok, detalle }
}

async function edgeBackupNotOverwritten(): Promise<Edge> {
  const id: TweakId = 'win32_priority_sep'
  const ref = { path: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl', name: 'Win32PrioritySeparation' }
  const detalle: string[] = []
  const snap0 = await snapshot()
  const ctx = await freshContext()
  const restore = info(await listTweaks(), id).activo ? await forceInactive(ctx, [id]) : null
  let ok = false
  try {
    const [original] = await regRead([ref])
    await applyTweaks([id])
    const first = JSON.stringify(backup.get(id))
    // Algo externo (Windows, otra app) cambia el valor; Optikax lo vuelve a aplicar.
    await regWrite([{ ...ref, kind: 'DWord', value: 0x18 }])
    await applyTweaks([id])
    const second = JSON.stringify(backup.get(id))
    const same = first === second
    detalle.push(same ? 'el segundo aplicar conservó el respaldo original' : 'ERROR: el respaldo cambió')
    await revertTweaks([id])
    const [after] = await regRead([ref])
    const back = after.exists === original.exists && after.value === original.value
    detalle.push(`al revertir: ${after.exists ? after.value : '(no existe)'} (original ${original.exists ? original.value : '(no existe)'})`)
    ok = same && back
  } finally {
    if (restore) await restore()
    const rest = diff(snap0, await snapshot())
    if (rest.length > 0) {
      ok = false
      detalle.push(`ERROR al limpiar: ${rest.join(' | ')}`)
    }
  }
  return { caso: 'backup.json no se sobrescribe en un segundo aplicar', ok, detalle }
}

async function edgeRevertAll(): Promise<Edge> {
  const detalle: string[] = []
  const snap0 = await snapshot()
  const ctx = await freshContext()
  const start = await listTweaks()
  const ids = start.filter((t) => t.motivoNoAplica === null).map((t) => t.id)
  const restore = await forceInactive(ctx, ids)
  let ok = false
  try {
    const base = await snapshot()
    const applied = await applyTweaks(ids)
    const failed = applied.results.filter((r) => !r.ok)
    detalle.push(`aplicados juntos: ${ids.length - failed.length}/${ids.length}`)
    for (const f of failed) detalle.push(`ERROR ${f.id}: ${f.error}`)
    const reverted = await revertTweaks()
    detalle.push(`Revertir todo: ${reverted.results.filter((r) => r.ok).length} revertidos, respaldos pendientes ${backup.ids().length}`)
    const rest = diff(base, await snapshot())
    for (const r of rest) detalle.push(`resto: ${r}`)
    ok = failed.length === 0 && backup.ids().length === 0 && rest.length === 0
  } finally {
    await restore()
    const rest = diff(snap0, await snapshot())
    if (rest.length > 0) {
      ok = false
      detalle.push(`ERROR al limpiar: ${rest.join(' | ')}`)
    }
  }
  return { caso: 'Revertir todo con todos los ajustes aplicados a la vez', ok, detalle }
}

async function edgeNagleScope(row: Row | undefined): Promise<Edge> {
  const ctx = await freshContext()
  const guid = ctx.env.nic?.guid.toLowerCase() ?? '(sin tarjeta)'
  const touched = (row?.cambios ?? []).filter((c) => c.includes('Tcpip'))
  const ok = touched.length > 0 && touched.every((c) => c.toLowerCase().includes(guid))
  return {
    caso: 'nagle_off solo toca la interfaz activa',
    ok,
    detalle: [`interfaz activa: ${ctx.env.nic?.name ?? '-'} ${guid}`, ...touched]
  }
}

async function edgeRestorePoint(): Promise<Edge> {
  const r = await createRestorePoint()
  return {
    caso: 'Punto de restauración (camino "ya hay uno reciente")',
    ok: r.status === 'reciente' || r.status === 'creado',
    detalle: [
      `estado: ${r.status}`,
      `último: ${r.latest ? `#${r.latest.sequence} "${r.latest.description}" ${r.latest.createdAt ?? ''}` : '-'}`,
      'Con Protección del sistema apagada no se ejecutó: habría que apagarla, y eso es un ajuste de seguridad. ' +
        'Revisado en código: Checkpoint-Computer lanza, el script devuelve "no_disponible" y applyTweaks sigue.'
    ]
  }
}

// ---------- Informe ----------

const mark = (b: boolean): string => (b ? 'sí' : '**NO**')

function report(rows: Row[], edges: Edge[], ctx: TweakContext): string {
  const hw = ctx.hw
  const lines = [
    '# Verificación del ciclo aplicar → leer → revertir',
    '',
    `Generado por \`npm run verify:tweaks\` el ${new Date().toLocaleString('es')}.`,
    '',
    `**Equipo:** ${hw.cpu?.name ?? '-'} · ${hw.derived.gpu?.name ?? '-'} · ` +
      `${Math.round((hw.derived.ram?.totalBytes ?? 0) / 2 ** 30)} GB RAM · Windows build ${hw.os?.build ?? '-'} · ` +
      `${hw.isLaptop ? 'laptop' : 'escritorio'}`,
    '',
    '**Método:**',
    '- El motor real de la app (`applyTweaks` / `revertTweaks`) aplica y revierte cada ajuste, con un `backup.json` temporal.',
    '- `scripts/verify-tweaks.ps1` toma una foto del sistema antes y después, leyendo el registro por su cuenta: todos los valores de cada clave tocada, el plan de energía activo y la lista de planes, la compresión de memoria y la configuración del mouse en vivo.',
    '- **Idéntico** significa que la foto tras revertir coincide valor por valor (tipo, dato y existencia) con la foto de partida.',
    '- Si un ajuste ya estaba activo, se borran temporalmente sus valores (estado de fábrica de Windows) para poder ejercitar el ciclo, y al final se restaura el valor original del equipo.',
    '',
    '## Por ajuste',
    '',
    '| ID | Aplica | Lee activo | Revierte | Idéntico | Modo | Notas |',
    '|---|---|---|---|---|---|---|'
  ]
  for (const r of rows) {
    const notas = [...(r.aplica ? [`No aplica aquí: ${r.aplica}`] : []), ...r.notas].join(' · ') || '—'
    lines.push(`| \`${r.id}\` | ${mark(r.aplicaOk)} | ${mark(r.leeOk)} | ${mark(r.revierteOk)} | ${mark(r.identico)} | ${r.modo} | ${notas} |`)
  }
  lines.push('', '## Casos borde', '', '| Caso | Resultado | Detalle |', '|---|---|---|')
  for (const e of edges) lines.push(`| ${e.caso} | ${e.ok ? 'OK' : '**FALLA**'} | ${e.detalle.join('<br>')} |`)
  lines.push('', '## Qué cambia cada ajuste', '')
  for (const r of rows) {
    lines.push(`**\`${r.id}\`**`, '')
    if (r.cambios.length === 0) lines.push('- (sin cambios visibles)')
    for (const c of r.cambios) lines.push(`- ${c.replace(/\|/g, '\\|')}`)
    lines.push('')
  }
  return lines.join('\n')
}

export async function runVerification(): Promise<number> {
  mkdirSync(app.getPath('userData'), { recursive: true })
  rmSync(backup.path(), { force: true })
  const log = (msg: string): void => console.log(`[verify] ${msg}`)

  log('escaneando hardware…')
  const ctx = await freshContext()
  // OPTIKAX_VERIFY_ONLY=id1,id2 repite solo esos ciclos (sin casos borde ni informe).
  const only = (process.env['OPTIKAX_VERIFY_ONLY'] ?? '').split(',').filter(Boolean)
  const rows: Row[] = []
  for (const t of CATALOG.filter((t) => only.length === 0 || only.includes(t.id))) {
    log(`ciclo ${t.id}`)
    const row = await cycle(t.id)
    rows.push(row)
    log(`  aplica=${row.aplicaOk} lee=${row.leeOk} revierte=${row.revierteOk} idéntico=${row.identico} ${row.notas.join(' | ')}`)
    for (const c of row.cambios) log(`    cambio: ${c}`)
    for (const c of row.restos) log(`    resto: ${c}`)
  }
  if (only.length > 0) return rows.every((r) => r.identico) ? 0 : 1

  const edges: Edge[] = []
  const edgeCases: [string, () => Promise<Edge>][] = [
    ['windowed sin valor', () => edgeWindowed(null)],
    ['windowed vacío', () => edgeWindowed('')],
    ['windowed con otros', () => edgeWindowed('VRROptimizeEnable=0;')],
    ['windowed con SwapEffect=0', () => edgeWindowed('SwapEffectUpgradeEnable=0;VRROptimizeEnable=1;')],
    ['power x3', edgePowerRepeated],
    ['backup', edgeBackupNotOverwritten],
    ['revertir todo', edgeRevertAll],
    ['nagle', () => edgeNagleScope(rows.find((r) => r.id === 'nagle_off'))],
    ['punto de restauración', edgeRestorePoint]
  ]
  for (const [name, run] of edgeCases) {
    log(`caso borde: ${name}`)
    try {
      edges.push(await run())
    } catch (err) {
      edges.push({ caso: name, ok: false, detalle: [`excepción: ${err instanceof Error ? err.message : String(err)}`] })
    }
    log(`  ${edges.at(-1)!.ok ? 'OK' : 'FALLA'} ${edges.at(-1)!.detalle.join(' | ')}`)
  }

  const md = report(rows, edges, ctx)
  writeFileSync(join(app.getAppPath(), 'docs', 'VERIFICACION_AJUSTES.md'), md)
  const allOk = rows.every((r) => r.aplicaOk && r.leeOk && r.revierteOk && r.identico) && edges.every((e) => e.ok)
  log(allOk ? 'TODO OK' : 'HAY FALLOS: revisa docs/VERIFICACION_AJUSTES.md')
  return allOk ? 0 : 1
}
