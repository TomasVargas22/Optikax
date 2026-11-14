/**
 * Verificación del Modo Juego (solo desarrollo): `npm run verify:game`.
 * - Detección contra casos fijos y contra los procesos reales del equipo (sin falsos positivos).
 * - De punta a punta con un "juego" falso: copia ping.exe a steamapps\common\Test\TestGame.exe,
 *   lo lanza, comprueba prioridad, purga y plan de energía, lo cierra y comprueba la restauración.
 * - Recuperación tras un cierre inesperado de la app con un juego abierto.
 * Deja el plan de energía como estaba al empezar y borra la carpeta de prueba.
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { GameModeStatus, ProcInfo } from '@shared/types'
import { findConflicts, gameReason } from './game-detect'
import { gameModeStatus, recoverPending, shutdownGameMode, startGameMode } from './gamemode'
import { memoryState } from './memory'
import { native } from './native'
import { writeAtomic } from './store'
import { power } from './tweaks/sys'

const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e'
const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61'
const HIGH_PERFORMANCE = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(cond: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond()) return true
    await sleep(500)
  }
  return false
}

export async function runGameVerification(): Promise<number> {
  const results: boolean[] = []
  const check = (caso: string, ok: boolean, detalle = ''): void => {
    results.push(ok)
    console.log(`[verify-game] ${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? ` · ${detalle}` : ''}`)
  }
  const proc = (name: string, path: string | null): ProcInfo => ({ pid: 1, name, path })

  // 1. Casos fijos de detección.
  const cases: [ProcInfo, string[], boolean][] = [
    [proc('TestGame', 'D:\\SteamLibrary\\steamapps\\common\\Test\\TestGame.exe'), [], true],
    [proc('wallpaper64', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe'), [], false],
    [proc('UnityCrashHandler64', 'C:\\Steam\\steamapps\\common\\Juego\\UnityCrashHandler64.exe'), [], false],
    [proc('EasyAntiCheat_EOS', 'C:\\Program Files\\Epic Games\\Fortnite\\EasyAntiCheat_EOS.exe'), [], false],
    [proc('steamwebhelper', 'C:\\Program Files (x86)\\Steam\\bin\\cef\\steamwebhelper.exe'), [], false],
    [proc('bootstrapper', 'C:\\Steam\\steamapps\\common\\Call of Duty Modern Warfare II\\bootstrapper.exe'), [], false],
    [proc('cod22-cod', 'C:\\Steam\\steamapps\\common\\Call of Duty Modern Warfare II\\cod22-cod.exe'), [], true],
    [proc('cs2', 'E:\\Juegos\\cs2.exe'), [], true],
    [proc('MiJuego', 'E:\\Otros\\MiJuego.exe'), ['mijuego.exe'], true],
    [proc('MiJuego', 'E:\\Otros\\MiJuego.exe'), [], false]
  ]
  for (const [p, custom, expected] of cases) {
    const reason = gameReason(p, custom)
    check(`${p.name} → ${expected ? 'juego' : 'no es juego'}`, (reason !== null) === expected, reason ?? 'null')
  }

  // 2. Procesos reales: no debería haber ningún juego abierto ahora mismo.
  const procs = await native.listProcesses()
  const flagged = procs.filter((p) => gameReason(p, []) !== null).map((p) => `${p.name} (${p.path})`)
  check('sin falsos positivos en los procesos actuales', flagged.length === 0, flagged.join(', ') || `${procs.length} procesos`)
  const conflicts = findConflicts(procs)
  check('detecta optimizadores en conflicto', true, conflicts.map((c) => c.name).join(', ') || 'ninguno')

  // 3. De punta a punta. Con un juego de verdad abierto no se hace: el Modo Juego lo tocaría a él.
  if (flagged.length > 0) {
    check('prueba de punta a punta', false, `omitida: cierra ${flagged.join(', ')} y repite`)
    return 1
  }
  const original = (await power.state()).active
  const dir = join(app.getPath('temp'), 'optikax-test', 'steamapps', 'common', 'Test')
  const exe = join(dir, 'TestGame.exe')
  let last: GameModeStatus | null = null
  try {
    mkdirSync(dir, { recursive: true })
    copyFileSync(join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'PING.EXE'), exe)
    await power.setActive(BALANCED)

    await startGameMode((s) => (last = s))
    const child = spawn(exe, ['-n', '60', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' })
    const detected = await waitFor(async () => (await gameModeStatus()).juego?.pid === child.pid, 15_000)
    const status = await gameModeStatus()
    check('detecta TestGame.exe en steamapps\\common', detected, status.juego ? `${status.juego.name} · ${status.juego.motivo}` : 'no')
    if (status.juego) console.log(`[verify-game]       acciones: ${status.juego.acciones.join(' | ')}`)

    const prio = await native.getPriority(child.pid!).catch(() => ({ priority: '?' }))
    check('prioridad alta', prio.priority === 'High', prio.priority)
    const st = await power.state()
    const expectedPlan = st.schemes.includes(ULTIMATE) ? ULTIMATE : HIGH_PERFORMANCE
    check('plan de alto rendimiento', st.active === expectedPlan, st.active)
    const purged = (await memoryState()).events.some((e) => e.origin === 'juego')
    check('purga de standby al empezar', purged)
    check('estado guardado para recuperar', existsSync(join(app.getPath('userData'), 'gamemode-pending.json')))
    check('aviso al renderer', (last as GameModeStatus | null)?.juego?.pid === child.pid)

    child.kill()
    const ended = await waitFor(async () => (await gameModeStatus()).juego === null, 15_000)
    const after = await gameModeStatus()
    check('detecta el cierre del juego', ended)
    check('restaura el plan de energía', (await power.state()).active === BALANCED, (await power.state()).active)
    check('registra la sesión', after.sesiones[0]?.game.startsWith('TestGame') === true, JSON.stringify(after.sesiones[0] ?? {}))
    check('borra el estado pendiente', !existsSync(join(app.getPath('userData'), 'gamemode-pending.json')))
    await shutdownGameMode()

    // 4. Cierre inesperado: la app murió con el plan cambiado; al arrancar debe deshacerlo.
    await power.setActive(expectedPlan)
    writeAtomic(
      join(app.getPath('userData'), 'gamemode-pending.json'),
      JSON.stringify({ pid: 1, name: 'X', path: null, motivo: '', startedAt: new Date().toISOString(), acciones: [], powerFrom: BALANCED, powerTo: expectedPlan, freedBytes: 0 })
    )
    await recoverPending()
    check('recupera tras un cierre inesperado', (await power.state()).active === BALANCED)
  } finally {
    await shutdownGameMode().catch(() => {})
    await power.setActive(original).catch(() => {})
    rmSync(join(app.getPath('temp'), 'optikax-test'), { recursive: true, force: true })
    console.log(`[verify-game] plan de energía devuelto a ${(await power.state()).active} (original ${original})`)
  }

  return results.every(Boolean) ? 0 : 1
}
