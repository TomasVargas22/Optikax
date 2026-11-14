/** Tipos compartidos entre el proceso principal, el preload y el renderer. */

export type Effects3D = 'auto' | 'siempre' | 'nunca'

export interface Settings {
  /** Efectos 3D (three.js): auto los pausa según el estado de la ventana y del juego. */
  efectos3d: Effects3D
  iniciarConWindows: boolean
  ram: {
    autoLimpieza: boolean
    /** 0 = automático: se calcula según la RAM total del equipo. */
    umbralStandbyMB: number
    /** 0 = automático. */
    umbralLibreMB: number
  }
  modoJuego: {
    activo: boolean
    /** Nombres de ejecutables agregados a mano por el usuario (p. ej. "mijuego.exe"). */
    juegosPersonalizados: string[]
  }
}

export const DEFAULT_SETTINGS: Settings = {
  efectos3d: 'auto',
  iniciarConWindows: false,
  ram: { autoLimpieza: false, umbralStandbyMB: 0, umbralLibreMB: 0 },
  modoJuego: { activo: true, juegosPersonalizados: [] }
}

export interface AppInfo {
  version: string
  /** true si el proceso corre con permisos de administrador. */
  elevado: boolean
  empaquetado: boolean
}

export type WindowState = 'visible' | 'oculta' | 'sin-foco'

export type TitleBarTheme = 'oscuro' | 'claro'

export interface MemStats {
  totalBytes: number
  /** Disponible = standby + libre. */
  availBytes: number
  loadPercent: number
  standbyBytes: number
  /** Páginas libres y en cero: memoria lista para usarse sin coste. */
  freeBytes: number
  modifiedBytes: number
  /** false si no hubo privilegio para leer las listas del kernel (datos aproximados). */
  detailed: boolean
  standbyByPriority: number[]
}

export type PurgeKind = 'standby' | 'standbyLow' | 'workingSets' | 'modified'

export interface PurgeResult {
  kind: PurgeKind
  before: MemStats
  after: MemStats
}

export type PurgeOrigin = 'manual' | 'auto' | 'juego'

export interface MemoryEvent {
  at: string
  kind: PurgeKind
  origin: PurgeOrigin
  /** Memoria recuperada por la limpieza (0 si no había nada que liberar). */
  freedBytes: number
  /** Solo en limpiezas fallidas. */
  error?: string
}

export interface MemoryState {
  autoLimpieza: boolean
  /** Umbrales efectivos: la automática limpia si standby ≥ umbralStandbyMB y libre < umbralLibreMB. */
  umbralStandbyMB: number
  umbralLibreMB: number
  /** true si los umbrales salen de la RAM total y no de un valor puesto a mano. */
  umbralesAutomaticos: boolean
  /** Más recientes primero. */
  events: MemoryEvent[]
}

export interface ProcInfo {
  pid: number
  name: string
  /** null en procesos protegidos del sistema. */
  path: string | null
}

export type PriorityLevel = 'High' | 'AboveNormal' | 'Normal' | 'BelowNormal'

// ---------- Hardware ----------

/** Lo que devuelve resources/scripts/hardware.ps1. Una sección es null si falló su lectura. */
export interface HardwareRaw {
  cpu: { name: string | null; manufacturer: string | null; cores: number; threads: number; maxMHz: number } | null
  gpus: {
    name: string | null
    driverVersion: string | null
    driverDate: string | null
    vramBytes: number | null
    pnpId: string | null
  }[]
  ram: {
    totalSlots: number
    modules: {
      capacityBytes: number
      speedMHz: number
      configuredMHz: number
      manufacturer: string | null
      partNumber: string | null
      slot: string | null
      smbiosType: number
    }[]
  } | null
  board: {
    manufacturer: string | null
    product: string | null
    biosVersion: string | null
    biosDate: string | null
  } | null
  disks: { name: string | null; mediaType: string; busType: string; sizeBytes: number; isSystem: boolean }[]
  systemVolume: { letter: string; sizeBytes: number; freeBytes: number } | null
  displays: { adapter: string; width: number; height: number; hz: number; maxHz: number; primary: boolean }[]
  monitorNames: string[]
  os: {
    caption: string | null
    version: string | null
    build: number
    ubr: number
    displayVersion: string | null
  } | null
  isLaptop: boolean
  power: { guid: string; name: string | null } | null
  errors: string[]
}

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'otro'

export interface HardwareDerived {
  cpu: {
    vendor: 'intel' | 'amd' | 'otro'
    /** Generación de Intel Core (9, 12, 14…) o serie de Ryzen (5000, 7000…). */
    generation: number | null
    /** Núcleos de rendimiento y de eficiencia (Intel 12.ª gen o posterior). */
    hybrid: boolean
    x3d: boolean
  } | null
  /** La GPU dedicada principal (la de más VRAM, sin adaptadores virtuales). */
  gpu: { name: string; vendor: GpuVendor; vramBytes: number | null; driverDate: string | null } | null
  ram: {
    totalBytes: number
    type: 'DDR3' | 'DDR4' | 'DDR5' | null
    configuredMHz: number | null
    /** Velocidad nominal estimada (SMBIOS o número de parte). */
    ratedMHz: number | null
    modules: number
  } | null
  systemDisk: { name: string | null; kind: 'NVMe' | 'SSD' | 'HDD' | 'otro' } | null
  display: { width: number; height: number; hz: number; maxHz: number } | null
}

export type IssueSeverity = 'alta' | 'media' | 'baja'

export interface HardwareIssue {
  id: string
  severidad: IssueSeverity
  titulo: string
  detalle: string
  /** Qué hacer para resolverlo. */
  accion: string
}

export interface HardwareProfile extends HardwareRaw {
  scannedAt: string
  derived: HardwareDerived
  issues: HardwareIssue[]
}

export interface ScanProgress {
  progress: number
  step: string
}

// ---------- Ajustes de gaming ----------

/** Lista blanca: los únicos ajustes que la app (y la IA) pueden aplicar. */
export const TWEAK_IDS = [
  'power_ultimate',
  'game_mode_on',
  'game_dvr_off',
  'hags_on',
  'mmcss_games',
  'win32_priority_sep',
  'windowed_optimizations',
  'mouse_accel_off',
  'transparency_off',
  'power_throttling_off',
  'network_throttling_off',
  'nagle_off',
  'memory_compression_off'
] as const

export type TweakId = (typeof TWEAK_IDS)[number]
export type TweakCategory = 'energia' | 'juego' | 'gpu' | 'cpu' | 'entrada' | 'red' | 'visual' | 'memoria'
/** Qué hace falta para que el cambio surta efecto. */
export type TweakRestart = 'no' | 'sesion' | 'reinicio'

export interface TweakInfo {
  id: TweakId
  titulo: string
  descripcion: string
  categoria: TweakCategory
  riesgo: 'bajo' | 'medio'
  /** Aviso corto que se muestra en la tarjeta (p. ej. por qué es de riesgo medio). */
  nota: string | null
  reinicio: TweakRestart
  /** null si el ajuste aplica a este equipo; si no, el motivo. */
  motivoNoAplica: string | null
  activo: boolean
  /** true si Optikax lo aplicó y guarda el valor original para revertirlo. */
  revertible: boolean
  aplicadoEn: string | null
}

/** Recomendación de la IA para un ajuste (fase de análisis). */
export interface TweakRecommendation {
  id: TweakId
  aplicar: boolean
  motivo: string
}

/**
 * Ajustes que entran en "Aplicar recomendados", en orden del catálogo.
 * - Solo los que aplican a este equipo y aún no están activos.
 * - Riesgo bajo: siempre, salvo que la IA diga explícitamente que no.
 * - Riesgo medio: solo si la IA lo recomienda con un motivo concreto.
 */
export function recommendedTweaks(tweaks: TweakInfo[], ia: TweakRecommendation[] | null = null): TweakId[] {
  const byId = new Map((ia ?? []).map((r) => [r.id, r]))
  return tweaks
    .filter((t) => !t.activo && t.motivoNoAplica === null)
    .filter((t) => {
      const rec = byId.get(t.id)
      if (t.riesgo === 'bajo') return rec?.aplicar !== false
      return rec?.aplicar === true && rec.motivo.trim().length > 0
    })
    .map((t) => t.id)
}

// ---------- Modo Juego ----------

export interface GameInfo {
  pid: number
  name: string
  path: string | null
  /** Por qué se considera un juego (carpeta de la tienda, lista conocida o agregado a mano). */
  motivo: string
}

export interface ActiveGame extends GameInfo {
  startedAt: string
  /** Lo que hizo Optikax al detectarlo, en texto para la interfaz. */
  acciones: string[]
}

export interface GameSession {
  game: string
  startedAt: string
  endedAt: string
  durationSec: number
  freedBytes: number
  acciones: string[]
}

/** Otro programa en ejecución que también toca prioridades, planes de energía o memoria. */
export interface GameConflict {
  name: string
  motivo: string
}

export interface GameModeStatus {
  activo: boolean
  juego: ActiveGame | null
  sesiones: GameSession[]
  conflictos: GameConflict[]
}

// ---------- Análisis con IA ----------

export const AI_PROFILES = ['entrada', 'media', 'alta', 'entusiasta'] as const
export type AiProfile = (typeof AI_PROFILES)[number]

export const MANUAL_CATEGORIES = ['bios', 'drivers', 'panel_gpu', 'juego', 'hardware', 'windows'] as const
export type ManualCategory = (typeof MANUAL_CATEGORIES)[number]

export interface AiManual {
  titulo: string
  detalle: string
  categoria: ManualCategory
  impacto: 'alto' | 'medio' | 'bajo'
}

/** Lo que devuelve el paso de estructuración; los IDs ya vienen filtrados contra el catálogo. */
export interface AiRecommendation {
  resumen: string
  perfil: AiProfile
  ajustes: TweakRecommendation[]
  manuales: AiManual[]
  ram: { autoLimpieza: boolean; umbralStandbyMB: number; umbralLibreMB: number }
  advertencias: string[]
}

export interface AiSource {
  url: string
  title: string
}

export interface AiAnalysis {
  createdAt: string
  /** Modelo que respondió (puede ser el de respaldo si el principal declinó). */
  model: string
  recomendacion: AiRecommendation
  /** Sacadas de los resultados de búsqueda, no del texto del modelo. */
  fuentes: AiSource[]
  busquedas: string[]
  /** Estimación con los precios de Claude Opus 5.5. */
  costoUSD: number
  /** IDs que el modelo propuso y no están en el catálogo (se descartaron). */
  descartados: string[]
}

export type AiProgress =
  | { kind: 'fase'; fase: 'investigando' | 'estructurando'; text: string }
  | { kind: 'busqueda'; query: string }
  | { kind: 'fuente'; source: AiSource }

export interface AiKeyTest {
  ok: boolean
  error: string | null
}

export interface RestorePointInfo {
  /** omitido: ya se creó uno desde Optikax en las últimas 24 h. */
  status: 'creado' | 'reciente' | 'no_disponible' | 'omitido'
  detail: string | null
}

export interface TweakActionResult {
  restorePoint: RestorePointInfo | null
  results: { id: TweakId; ok: boolean; error: string | null }[]
  tweaks: TweakInfo[]
}

/** API expuesta por el preload en `window.optikax`. */
export interface OptikaxApi {
  app: {
    info(): Promise<AppInfo>
    setTitleBarTheme(theme: TitleBarTheme): Promise<void>
    onWindowState(cb: (state: WindowState) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: DeepPartial<Settings>): Promise<Settings>
  }
  hardware: {
    /** Devuelve el último escaneo; escanea si aún no hay uno o si `force` es true. */
    scan(force?: boolean): Promise<HardwareProfile>
    onProgress(cb: (p: ScanProgress) => void): () => void
  }
  tweaks: {
    list(): Promise<TweakInfo[]>
    apply(ids: TweakId[]): Promise<TweakActionResult>
    /** Sin ids revierte todo lo que Optikax aplicó. */
    revert(ids?: TweakId[]): Promise<TweakActionResult>
  }
  memory: {
    stats(): Promise<MemStats>
    purge(kind: PurgeKind): Promise<MemoryEvent>
    state(): Promise<MemoryState>
    /** Llega con cada limpieza, manual o automática. */
    onEvent(cb: (e: MemoryEvent) => void): () => void
  }
  apiKey: {
    /** Nunca devuelve la clave: solo si hay una guardada. */
    has(): Promise<boolean>
    set(key: string): Promise<void>
    clear(): Promise<void>
    /** Comprueba la clave guardada contra la API (sin coste: no genera tokens). */
    test(): Promise<AiKeyTest>
  }
  gameMode: {
    status(): Promise<GameModeStatus>
    /** Llega al detectar un juego, al cerrarlo y al cambiar los ajustes del modo. */
    onChange(cb: (s: GameModeStatus) => void): () => void
  }
  ai: {
    /** Último análisis guardado en disco, o null. */
    last(): Promise<AiAnalysis | null>
    analyze(): Promise<AiAnalysis>
    cancel(): Promise<void>
    onProgress(cb: (p: AiProgress) => void): () => void
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/** Canales IPC: una sola fuente de verdad para main y preload. */
export const IPC = {
  appInfo: 'app:info',
  titleBarTheme: 'app:titlebar-theme',
  windowState: 'app:window-state',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  hardwareScan: 'hardware:scan',
  hardwareProgress: 'hardware:progress',
  tweaksList: 'tweaks:list',
  tweaksApply: 'tweaks:apply',
  tweaksRevert: 'tweaks:revert',
  memoryStats: 'memory:stats',
  memoryPurge: 'memory:purge',
  memoryState: 'memory:state',
  memoryEvent: 'memory:event',
  apiKeyHas: 'apikey:has',
  apiKeySet: 'apikey:set',
  apiKeyClear: 'apikey:clear',
  apiKeyTest: 'apikey:test',
  aiLast: 'ai:last',
  aiAnalyze: 'ai:analyze',
  aiCancel: 'ai:cancel',
  aiProgress: 'ai:progress',
  gameModeStatus: 'gamemode:status',
  gameModeChange: 'gamemode:change'
} as const
