import type { HardwareProfile, TweakCategory, TweakId, TweakRestart } from '@shared/types'
import {
  power,
  regKey,
  regRead,
  regWrite,
  setMemoryCompression,
  setMouse,
  type PowerState,
  type RegKind,
  type RegRef,
  type RegValue,
  type RegWrite,
  type TweakEnv
} from './sys'

/**
 * Catálogo de ajustes: la lista blanca de lo único que Optikax puede cambiar.
 * Ninguno toca servicios ni seguridad, y todos guardan el valor original para revertir.
 */

export interface TweakContext {
  hw: HardwareProfile
  env: TweakEnv
  power: PowerState
}

export interface Tweak {
  id: TweakId
  titulo: string
  descripcion: string
  categoria: TweakCategory
  riesgo: 'bajo' | 'medio'
  reinicio: TweakRestart
  /** Motivo por el que no aplica a este equipo, o null si aplica. */
  motivoNoAplica(ctx: TweakContext): string | null
  /** Valores del registro que hacen falta para saber si está activo (se leen en lote). */
  lecturas(ctx: TweakContext): RegRef[]
  activo(ctx: TweakContext, reg: Map<string, RegValue>, respaldo: unknown): boolean
  /** Lee el estado original. Se guarda en disco ANTES de escribir nada. */
  respaldar(ctx: TweakContext): Promise<unknown>
  aplicar(ctx: TweakContext, respaldo: unknown): Promise<void>
  revertir(respaldo: unknown): Promise<void>
}

type Meta = Pick<Tweak, 'id' | 'titulo' | 'descripcion' | 'categoria' | 'riesgo' | 'reinicio'> & {
  motivoNoAplica?: Tweak['motivoNoAplica']
}

// ---------- Ajustes de registro ----------

interface RegTarget extends RegRef {
  kind: RegKind
  /** Valor a escribir; una función lo calcula a partir del valor actual (p. ej. para combinar cadenas). */
  value: number | string | ((actual: number | string | null) => number | string)
  /** Valor que Windows asume cuando la entrada no existe. */
  porDefecto?: number | string
  /** Criterio propio de "está activo", cuando no basta con comparar el valor. */
  coincide?: (actual: number | string | null) => boolean
}

interface RegBackup {
  valores: RegValue[]
  /** Claves que no existían y que la app creó: se borran al revertir si quedan vacías. */
  clavesCreadas: string[]
}

const KNOWN_KINDS: readonly string[] = ['DWord', 'String', 'ExpandString']

function isActive(target: RegTarget, actual: RegValue | undefined): boolean {
  const value = actual?.exists ? actual.value : (target.porDefecto ?? null)
  if (target.coincide) return target.coincide(value)
  return value === target.value
}

function regTweak(
  meta: Meta,
  targets: RegTarget[] | ((ctx: TweakContext) => RegTarget[]),
  trasCambio?: () => Promise<void>
): Tweak {
  const resolve = (ctx: TweakContext): RegTarget[] => (typeof targets === 'function' ? targets(ctx) : targets)

  return {
    ...meta,
    motivoNoAplica: meta.motivoNoAplica ?? (() => null),
    lecturas: resolve,
    activo(ctx, reg) {
      const list = resolve(ctx)
      return list.length > 0 && list.every((t) => isActive(t, reg.get(regKey(t))))
    },
    async respaldar(ctx): Promise<RegBackup> {
      const valores = await regRead(resolve(ctx))
      const raro = valores.find((v) => v.exists && !KNOWN_KINDS.includes(v.kind ?? ''))
      if (raro) throw new Error(`${raro.path}\\${raro.name} tiene un tipo inesperado (${raro.kind}); no se toca.`)
      return { valores, clavesCreadas: [...new Set(valores.filter((v) => !v.keyExists).map((v) => v.path))] }
    },
    async aplicar(ctx, respaldo) {
      const original = new Map((respaldo as RegBackup).valores.map((v) => [regKey(v), v]))
      // Se parte del valor que hay ahora, no del respaldo, por si cambió desde la primera vez.
      const actuales = new Map((await regRead(resolve(ctx))).map((v) => [regKey(v), v]))
      const writes: RegWrite[] = resolve(ctx).map((t) => {
        const actual = actuales.get(regKey(t)) ?? original.get(regKey(t))
        const value = typeof t.value === 'function' ? t.value(actual?.exists ? actual.value : null) : t.value
        return { path: t.path, name: t.name, kind: t.kind, value }
      })
      await regWrite(writes)
      await trasCambio?.()
    },
    async revertir(respaldo) {
      const b = respaldo as RegBackup
      const writes: RegWrite[] = b.valores.map((v) =>
        v.exists && v.value !== null
          ? { path: v.path, name: v.name, kind: v.kind as RegKind, value: v.value }
          : { path: v.path, name: v.name, delete: true }
      )
      for (const path of b.clavesCreadas) writes.push({ path, name: '', deleteKeyIfEmpty: true })
      await regWrite(writes)
      await trasCambio?.()
    }
  }
}

const dword = (path: string, name: string, value: number, porDefecto?: number): RegTarget => ({
  path,
  name,
  kind: 'DWord',
  value,
  porDefecto
})
const str = (path: string, name: string, value: string, porDefecto?: string): RegTarget => ({
  path,
  name,
  kind: 'String',
  value,
  porDefecto
})

// ---------- Rutas ----------

const GAME_BAR = 'HKCU\\Software\\Microsoft\\GameBar'
const GAME_CONFIG = 'HKCU\\System\\GameConfigStore'
const GAME_DVR = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR'
const GRAPHICS = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers'
const SYSTEM_PROFILE = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile'
const MMCSS_GAMES = `${SYSTEM_PROFILE}\\Tasks\\Games`
const PRIORITY_CONTROL = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl'
const DX_PREFS = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const MOUSE = 'HKCU\\Control Panel\\Mouse'
const PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'
const POWER_THROTTLING = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling'
const TCPIP_INTERFACES = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces'

const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61'
const HIGH_PERFORMANCE = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e'

const GB = 2 ** 30
const soloEscritorio = (ctx: TweakContext): string | null =>
  ctx.hw.isLaptop ? 'Solo para equipos de escritorio: en una laptop gasta batería y sube la temperatura.' : null

/** HAGS necesita Windows 10 2004 o posterior y una GPU con soporte en el driver. */
function hagsUnsupported(ctx: TweakContext): string | null {
  if ((ctx.hw.os?.build ?? 0) < 19041) return 'Necesita Windows 10 versión 2004 o posterior.'
  const gpu = ctx.hw.derived.gpu
  if (!gpu) return 'No se detectó una GPU dedicada.'
  const ok =
    (gpu.vendor === 'nvidia' && /RTX|GTX\s*1[06]\d{2}/i.test(gpu.name)) ||
    (gpu.vendor === 'amd' && /RX\s*[5-9]\d{3}/i.test(gpu.name)) ||
    (gpu.vendor === 'intel' && /Arc/i.test(gpu.name))
  return ok ? null : `La ${gpu.name} no admite programación de GPU por hardware.`
}

/** Añade o reemplaza una clave en una cadena "A=1;B=2;". */
function mergeSetting(actual: number | string | null, key: string, value: string): string {
  const parts = (typeof actual === 'string' ? actual : '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.toLowerCase().startsWith(`${key.toLowerCase()}=`))
  return [...parts, `${key}=${value}`].join(';') + ';'
}

async function applyMouseFromRegistry(): Promise<void> {
  const [speed, t1, t2] = await regRead(
    ['MouseSpeed', 'MouseThreshold1', 'MouseThreshold2'].map((name) => ({ path: MOUSE, name }))
  )
  const n = (v: RegValue, fallback: number): number => {
    const parsed = Number.parseInt(String(v.value ?? ''), 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  // Valores de fábrica de Windows: umbrales 6 y 10, aceleración 1.
  await setMouse(n(t1, 6), n(t2, 10), n(speed, 1))
}

// ---------- Ajustes que no son de registro ----------

interface PowerBackup {
  previous: string
  activated: string
  /** Plan duplicado por la app (se borra al revertir), o null si ya existía. */
  created: string | null
}

const powerUltimate: Tweak = {
  id: 'power_ultimate',
  titulo: 'Plan de energía Máximo rendimiento',
  descripcion: 'Evita que Windows baje la frecuencia de la CPU o duerma núcleos mientras juegas.',
  categoria: 'energia',
  riesgo: 'bajo',
  reinicio: 'no',
  motivoNoAplica: () => null,
  lecturas: () => [],
  activo: (ctx, _reg, respaldo) =>
    ctx.power.active === ULTIMATE || ctx.power.active === (respaldo as PowerBackup | undefined)?.activated,
  async respaldar(ctx): Promise<PowerBackup> {
    return { previous: ctx.power.active, activated: ULTIMATE, created: null }
  },
  async aplicar(ctx, respaldo) {
    const b = respaldo as PowerBackup
    if (ctx.power.schemes.includes(ULTIMATE)) {
      await power.setActive(ULTIMATE)
      return
    }
    try {
      // En muchas ediciones el plan viene oculto: hay que duplicarlo para poder usarlo.
      b.created = await power.duplicate(ULTIMATE)
      b.activated = b.created
    } catch {
      if (!ctx.power.schemes.includes(HIGH_PERFORMANCE)) throw new Error('Este equipo no ofrece planes de alto rendimiento.')
      b.activated = HIGH_PERFORMANCE
    }
    await power.setActive(b.activated)
  },
  async revertir(respaldo) {
    const b = respaldo as PowerBackup
    const { schemes } = await power.state()
    await power.setActive(schemes.includes(b.previous) ? b.previous : BALANCED)
    if (b.created && schemes.includes(b.created)) await power.delete(b.created)
  }
}

const memoryCompressionOff: Tweak = {
  id: 'memory_compression_off',
  titulo: 'Desactivar la compresión de memoria',
  descripcion: 'Con RAM de sobra, ahorra el trabajo de CPU que Windows dedica a comprimir memoria.',
  categoria: 'memoria',
  riesgo: 'medio',
  reinicio: 'reinicio',
  motivoNoAplica(ctx) {
    const total = ctx.hw.derived.ram?.totalBytes ?? 0
    if (total < 31 * GB) return 'Solo conviene con 32 GB de RAM o más; con menos, la compresión ayuda.'
    if (ctx.env.memoryCompression === null) return 'No se pudo leer el estado de la compresión de memoria.'
    return null
  },
  lecturas: () => [],
  activo: (ctx) => ctx.env.memoryCompression === false,
  respaldar: async (ctx) => ({ wasEnabled: ctx.env.memoryCompression === true }),
  async aplicar() {
    await setMemoryCompression(false)
  },
  async revertir(respaldo) {
    if ((respaldo as { wasEnabled: boolean }).wasEnabled) await setMemoryCompression(true)
  }
}

// ---------- Catálogo ----------

export const CATALOG: Tweak[] = [
  powerUltimate,

  regTweak(
    {
      id: 'game_mode_on',
      titulo: 'Activar el Modo de juego de Windows',
      descripcion: 'Windows da prioridad al juego y pausa Windows Update y sus avisos mientras juegas.',
      categoria: 'juego',
      riesgo: 'bajo',
      reinicio: 'no'
    },
    [dword(GAME_BAR, 'AutoGameModeEnabled', 1, 1), dword(GAME_BAR, 'AllowAutoGameMode', 1, 1)]
  ),

  regTweak(
    {
      id: 'game_dvr_off',
      titulo: 'Apagar la grabación en segundo plano',
      descripcion: 'Desactiva Game DVR, que graba la partida todo el tiempo y consume GPU y disco.',
      categoria: 'juego',
      riesgo: 'bajo',
      reinicio: 'sesion'
    },
    [dword(GAME_CONFIG, 'GameDVR_Enabled', 0, 1), dword(GAME_DVR, 'AppCaptureEnabled', 0, 1)]
  ),

  regTweak(
    {
      id: 'hags_on',
      titulo: 'Programación de GPU acelerada por hardware',
      descripcion: 'La GPU gestiona su propia cola de trabajo. Reduce latencia y es requisito de DLSS Frame Generation.',
      categoria: 'gpu',
      riesgo: 'bajo',
      reinicio: 'reinicio',
      motivoNoAplica: hagsUnsupported
    },
    // Sin porDefecto: si la entrada no existe, el estado lo decide el driver y no se puede asumir.
    [dword(GRAPHICS, 'HwSchMode', 2)]
  ),

  regTweak(
    {
      id: 'mmcss_games',
      titulo: 'Prioridad multimedia para juegos',
      descripcion: 'El planificador multimedia de Windows reserva menos CPU para tareas de fondo y da más prioridad a los juegos.',
      categoria: 'cpu',
      riesgo: 'bajo',
      reinicio: 'reinicio'
    },
    [
      {
        // Porcentaje de CPU reservado a tareas de fondo. Si ya está en 10 o menos, se respeta.
        path: SYSTEM_PROFILE,
        name: 'SystemResponsiveness',
        kind: 'DWord',
        value: (actual) => (typeof actual === 'number' && actual <= 10 ? actual : 10),
        porDefecto: 20,
        coincide: (actual) => typeof actual === 'number' && actual <= 10
      },
      dword(MMCSS_GAMES, 'GPU Priority', 8),
      dword(MMCSS_GAMES, 'Priority', 6),
      str(MMCSS_GAMES, 'Scheduling Category', 'High'),
      str(MMCSS_GAMES, 'SFIO Priority', 'High')
    ]
  ),

  regTweak(
    {
      id: 'win32_priority_sep',
      titulo: 'Más tiempo de CPU para la ventana activa',
      descripcion: 'Ajusta el reparto de CPU para que el programa en primer plano (el juego) reciba turnos más largos.',
      categoria: 'cpu',
      riesgo: 'bajo',
      reinicio: 'reinicio'
    },
    [dword(PRIORITY_CONTROL, 'Win32PrioritySeparation', 0x26, 2)]
  ),

  regTweak(
    {
      id: 'windowed_optimizations',
      titulo: 'Optimizaciones para juegos en ventana',
      descripcion: 'En Windows 11, los juegos en ventana o sin bordes usan el modo de presentación moderno, con menos latencia.',
      categoria: 'gpu',
      riesgo: 'bajo',
      reinicio: 'no',
      motivoNoAplica: (ctx) => ((ctx.hw.os?.build ?? 0) < 22000 ? 'Solo existe en Windows 11.' : null)
    },
    [
      {
        path: DX_PREFS,
        name: 'DirectXUserGlobalSettings',
        kind: 'String',
        value: (actual) => mergeSetting(actual, 'SwapEffectUpgradeEnable', '1'),
        coincide: (actual) => typeof actual === 'string' && /(^|;)\s*SwapEffectUpgradeEnable=1\s*(;|$)/i.test(actual)
      }
    ]
  ),

  regTweak(
    {
      id: 'mouse_accel_off',
      titulo: 'Quitar la aceleración del mouse',
      descripcion: 'El cursor se mueve siempre lo mismo por cada centímetro de mouse, sin importar la velocidad. Mejora la puntería.',
      categoria: 'entrada',
      riesgo: 'bajo',
      reinicio: 'no'
    },
    [str(MOUSE, 'MouseSpeed', '0', '1'), str(MOUSE, 'MouseThreshold1', '0', '6'), str(MOUSE, 'MouseThreshold2', '0', '10')],
    applyMouseFromRegistry
  ),

  regTweak(
    {
      id: 'transparency_off',
      titulo: 'Quitar las transparencias de Windows',
      descripcion: 'Elimina el efecto de vidrio en la barra de tareas y los menús. Libera un poco de GPU.',
      categoria: 'visual',
      riesgo: 'bajo',
      reinicio: 'no'
    },
    [dword(PERSONALIZE, 'EnableTransparency', 0, 1)]
  ),

  regTweak(
    {
      id: 'power_throttling_off',
      titulo: 'Desactivar la limitación de energía',
      descripcion: 'Impide que Windows frene procesos en segundo plano para ahorrar energía (Power Throttling).',
      categoria: 'energia',
      riesgo: 'bajo',
      reinicio: 'reinicio',
      motivoNoAplica: soloEscritorio
    },
    [dword(POWER_THROTTLING, 'PowerThrottlingOff', 1, 0)]
  ),

  regTweak(
    {
      id: 'network_throttling_off',
      titulo: 'Quitar el límite de red multimedia',
      descripcion: 'Windows limita los paquetes de red cuando hay audio o video sonando. Su efecto en juegos se discute.',
      categoria: 'red',
      riesgo: 'medio',
      reinicio: 'reinicio'
    },
    [dword(SYSTEM_PROFILE, 'NetworkThrottlingIndex', 0xffffffff, 10)]
  ),

  regTweak(
    {
      id: 'nagle_off',
      titulo: 'Desactivar el algoritmo de Nagle',
      descripcion: 'Envía los paquetes pequeños sin esperar a agruparlos. Solo ayuda en algunos juegos que usan TCP.',
      categoria: 'red',
      riesgo: 'medio',
      reinicio: 'reinicio',
      motivoNoAplica: (ctx) => (ctx.env.nic ? null : 'No se encontró una tarjeta de red con conexión a internet.')
    },
    (ctx) => {
      if (!ctx.env.nic) return []
      const path = `${TCPIP_INTERFACES}\\${ctx.env.nic.guid}`
      return [dword(path, 'TcpAckFrequency', 1), dword(path, 'TCPNoDelay', 1)]
    }
  ),

  memoryCompressionOff
]

export const TWEAKS = new Map<TweakId, Tweak>(CATALOG.map((t) => [t.id, t]))
