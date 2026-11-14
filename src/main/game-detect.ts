import type { GameConflict, GameInfo, ProcInfo } from '@shared/types'

/** Carpetas donde las tiendas instalan los juegos. */
const STORE_FOLDERS: [string, string][] = [
  ['\\steamapps\\common\\', 'Steam'],
  ['\\epic games\\', 'Epic Games'],
  ['\\riot games\\', 'Riot Games'],
  ['\\xboxgames\\', 'Xbox'],
  ['\\gog galaxy\\games\\', 'GOG'],
  ['\\ea games\\', 'EA'],
  ['\\ubisoft game launcher\\games\\', 'Ubisoft']
]

/** Juegos conocidos por nombre de proceso (sin .exe, en minúsculas), por si están en otra carpeta. */
const KNOWN_GAMES = new Set([
  'cs2',
  'csgo',
  'valorant-win64-shipping',
  'fortniteclient-win64-shipping',
  'r5apex',
  'r5apex_dx12',
  'overwatch',
  'cod',
  'modernwarfare',
  'blackops6',
  'leagueoflegends',
  'league of legends',
  'dota2',
  'rocketleague',
  'gta5',
  'gta5_enhanced',
  'rdr2',
  'minecraft.windows',
  'eldenring',
  'cyberpunk2077',
  'pubg',
  'tslgame',
  'rainbowsix',
  'rainbowsix_vulkan',
  'destiny2',
  'warframe.x64',
  'marvel-win64-shipping',
  'deltaforceclient-win64-shipping',
  'thefinals'
])

/**
 * Procesos que viven en carpetas de juegos pero no son juegos: launchers, ayudantes,
 * anti-cheats, instaladores y apps de Steam que no son juegos (Wallpaper Engine).
 */
const EXCLUDED_NAMES = new Set([
  'steam',
  'steamwebhelper',
  'steamservice',
  'steamerrorreporter',
  'epicgameslauncher',
  'epicwebhelper',
  'riotclientservices',
  'riotclientux',
  'riotclientuxrender',
  'riotclientcrashhandler',
  'galaxyclient',
  'eadesktop',
  'eabackgroundservice',
  'upc',
  'ubisoftconnect',
  'easyanticheat',
  'easyanticheat_eos',
  'beservice',
  'beservice_x64',
  'vgc',
  'vgtray',
  'wallpaper32',
  'wallpaper64',
  'wallpaperui',
  'webwallpaper32',
  'ui32',
  'crashreportclient',
  'bootstrapper',
  'vc_redist.x64',
  'vc_redist.x86',
  'dxsetup',
  'dxwebsetup'
])
const EXCLUDED_PATTERNS = [/crash/i, /setup/i, /install/i, /redist/i, /launcher/i, /updater/i, /helper/i, /anticheat/i, /overlay/i, /^unins/i]
/**
 * Carpetas que no son de juegos: herramientas de Steam y el propio lanzador de Epic
 * (su overlay EOSOverlayRenderer vive en "Epic Games\Launcher" y se colaba como juego).
 */
const EXCLUDED_FOLDERS = ['\\steamworks shared\\', '\\wallpaper_engine\\', '\\steamvr\\', '\\_commonredist\\', '\\epic games\\launcher\\']

const baseName = (name: string): string => name.toLowerCase().replace(/\.exe$/, '')

function excluded(p: ProcInfo): boolean {
  const name = baseName(p.name)
  if (EXCLUDED_NAMES.has(name) || EXCLUDED_PATTERNS.some((re) => re.test(name))) return true
  const path = (p.path ?? '').toLowerCase()
  return EXCLUDED_FOLDERS.some((f) => path.includes(f))
}

/** Devuelve el motivo si el proceso es un juego, o null. */
export function gameReason(p: ProcInfo, custom: string[]): string | null {
  const name = baseName(p.name)
  // Lo agregado a mano gana siempre, incluso sobre las exclusiones.
  if (custom.some((c) => baseName(c) === name)) return 'Agregado a mano'
  if (excluded(p)) return null
  if (KNOWN_GAMES.has(name)) return 'Juego conocido'
  const path = (p.path ?? '').toLowerCase()
  const store = STORE_FOLDERS.find(([folder]) => path.includes(folder))
  return store ? `Instalado con ${store[1]}` : null
}

/** Elige el juego: el de primer plano si es uno de ellos; si no, el primero encontrado. */
export function pickGame(procs: ProcInfo[], custom: string[], foregroundPid: number | null): GameInfo | null {
  const games: GameInfo[] = []
  for (const p of procs) {
    const motivo = gameReason(p, custom)
    if (motivo) games.push({ pid: p.pid, name: p.name, path: p.path, motivo })
  }
  return games.find((g) => g.pid === foregroundPid) ?? games[0] ?? null
}

/** Optimizadores que también cambian prioridades, planes de energía o memoria. */
const KNOWN_OPTIMIZERS: Record<string, string> = {
  krnlgame: 'El modo juego de KernelOS cambia el plan de energía por su cuenta.',
  processlasso: 'Process Lasso gestiona prioridades y planes de energía.',
  processgovernor: 'Process Lasso gestiona prioridades y planes de energía.',
  islc: 'Intelligent Standby List Cleaner también purga la memoria standby.',
  razercortex: 'Razer Cortex cambia prioridades y limpia memoria al jugar.',
  wisegamebooster: 'Wise Game Booster cierra procesos y cambia ajustes al jugar.',
  gamefire: 'Game Fire cambia prioridades y servicios al jugar.',
  hone: 'Hone aplica ajustes de sistema y de energía.'
}

export function findConflicts(procs: ProcInfo[]): GameConflict[] {
  const seen = new Set<string>()
  const out: GameConflict[] = []
  for (const p of procs) {
    const name = baseName(p.name)
    const motivo = KNOWN_OPTIMIZERS[name]
    if (motivo && !seen.has(name)) {
      seen.add(name)
      out.push({ name: p.name.endsWith('.exe') ? p.name : `${p.name}.exe`, motivo })
    }
  }
  return out
}
