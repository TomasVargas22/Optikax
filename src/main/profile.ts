import type {
  ComponentSummary,
  EquipmentProfile,
  HardwareIssue,
  HardwareProfile,
  ProfileComponent,
  ProfileRecommendation,
  StorageInfo,
  TweakId,
  TweakInfo
} from '@shared/types'

/**
 * Motor de recomendaciones por componente. Puro: sin Electron ni red.
 * La investigación se hizo al desarrollar (docs/INVESTIGACION_EQUIPO.md) y queda aquí como reglas
 * generales (fabricante, generación, ranuras, tipo de disco, frecuencias) con su fuente.
 * Los problemas que ya detecta hardware-rules.ts se integran aquí para no mostrarlos dos veces.
 */

const GB = 2 ** 30
const gb = (bytes: number): string => `${Math.round(bytes / GB)} GB`

const SRC = {
  intelArk: 'https://www.intel.com/content/www/us/en/products/sku/191792/x/specifications.html',
  dualChannel: 'https://www.techspot.com/article/3066-single-stick-vs-dual-channel-ram/',
  gsync: 'https://www.blurbusters.com/gsync/gsync101-input-lag-tests-and-settings/14/',
  pcieX8: 'https://www.profesionalreview.com/2023/07/11/rtx-4060-rendimiento-pcie-3-0-vs-pcie-4-0/amp/',
  asusRebar: 'https://overclock3d.net/news/cpu_mainboard/asus-brings-resizable-bar-support-to-its-entire-intel-400-series-motherboard-lineup/',
  cpuPower: 'https://forums.tomshardware.com/threads/ive-just-bought-an-i7-9700f-whats-up-with-the-65w-tdp.3687187',
  trim: 'https://learn.microsoft.com/windows-server/administration/windows-commands/fsutil-behavior',
  mixedHz: 'https://learn.microsoft.com/en-us/answers/questions/5775476/mismatched-refresh-rates-issue',
  dramless: 'https://www.tomshardware.com/reviews/patriot-p300-m2-nvme/2',
  hags: 'https://devblogs.microsoft.com/directx/hardware-accelerated-gpu-scheduling/'
} as const

/**
 * Última BIOS publicada por el fabricante (comprobado el 14/11/2026). Sin red no se puede consultar:
 * solo se opina de las placas investigadas.
 */
const LATEST_BIOS: Record<string, { version: string; url: string }> = {
  'PRIME H310M-E R2.0': {
    version: '2209',
    url: 'https://www.asus.com/Motherboards-Components/Motherboards/PRIME/PRIME-H310M-E-R2-0/HelpDesk_BIOS/'
  }
}

/** Ventana de Adaptive-Sync de monitores investigados (texto del fabricante). */
const MONITOR_VRR: Record<string, string> = {
  VA27EHE: 'Adaptive-Sync de 48 a 75 Hz, solo por HDMI'
}

/** GPU con interfaz PCIe x8 o menos: pierden más en placas PCIe 3.0. */
const GPU_NARROW_LINK = /RTX\s*40[56]0|RTX\s*50[56]0|RX\s*66[05]0|RX\s*7600|RX\s*6[45]00/i

/** Velocidad de RAM oficial (MT/s) por CPU, según Intel ARK y AMD. null si no se conoce. */
function officialRamMHz(cpuName: string, vendor: string, gen: number | null): number | null {
  if (vendor === 'intel' && gen !== null) {
    if (gen === 8 || gen === 9) return /i[579]-/i.test(cpuName) ? 2666 : 2400
    if (gen === 10) return /i[79]-/i.test(cpuName) ? 2933 : 2666
    if (gen === 11) return 3200
  }
  if (vendor === 'amd' && gen !== null) {
    if (gen === 2000) return 2933
    if (gen === 3000 || gen === 5000) return 3200
  }
  return null
}

/** Chipset Intel sin overclock de memoria (H/B de las series 100 a 400). */
const isLockedIntelChipset = (board: string): boolean => /\b[HB][1-4]\d0[A-Z]?\b/i.test(board)

/** Generación PCIe del slot de la GPU: Intel hasta 10.ª gen y AMD con A320/B350/X370/B450/X470 → 3.0. */
function platformPcie3(hw: HardwareProfile): boolean {
  const cpu = hw.derived.cpu
  const board = hw.board?.product ?? ''
  if (cpu?.vendor === 'intel' && cpu.generation !== null) return cpu.generation <= 10
  // "B450M", "H310M-E": la letra pegada al chipset rompe \b, por eso (?=M|\b).
  if (cpu?.vendor === 'amd') return /\b(A320|B350|X370|B450|X470)(?=M|\b)/i.test(board)
  return false
}

function shortCpu(name: string): string {
  return name
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\s+CPU\b.*$/i, '')
    .replace(/\s+\d+-Core Processor.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- Problemas existentes → recomendaciones ----------

const ISSUE_COMPONENT: [RegExp, ProfileComponent][] = [
  [/^ram_/, 'ram'],
  [/^gpu_/, 'gpu'],
  [/^display_/, 'pantalla'],
  [/^power_/, 'cpu'],
  [/^system_/, 'almacenamiento']
]

function fromIssue(issue: HardwareIssue): ProfileRecommendation {
  const componente = ISSUE_COMPONENT.find(([re]) => re.test(issue.id))?.[1] ?? 'windows'
  return {
    id: issue.id,
    componente,
    titulo: issue.titulo,
    detalle: issue.detalle,
    impacto: issue.severidad === 'alta' ? 'alto' : issue.severidad === 'media' ? 'medio' : 'bajo',
    tipo: 'manual',
    pasos: [issue.accion],
    hecho: false,
    fuente: null
  }
}

// ---------- Motor ----------

export function buildProfile(hw: HardwareProfile, storage: StorageInfo | null, tweaks: TweakInfo[]): EquipmentProfile {
  const recs: ProfileRecommendation[] = []
  const tweak = new Map(tweaks.map((t) => [t.id, t]))
  const d = hw.derived
  const board = hw.board?.product ?? ''

  /** Recomendación ligada a un ajuste del catálogo: hecha si ya está activo; se omite si no aplica. */
  const auto = (id: TweakId, componente: ProfileComponent, impacto: ProfileRecommendation['impacto'], detalle: string, fuente: string | null): void => {
    const t = tweak.get(id)
    if (!t || t.motivoNoAplica) return
    recs.push({ id: `auto_${id}`, componente, titulo: t.titulo, detalle, impacto, tipo: 'automatico', tweakId: id, hecho: t.activo, fuente })
  }

  // Los problemas detectados entran como recomendaciones; algunos se enriquecen abajo.
  const issues = new Map(hw.issues.map((i) => [i.id, fromIssue(i)]))

  // ----- RAM -----
  const ram = d.ram
  const firstModule = hw.ram?.modules[0]
  if (ram && issues.has('ram_single_channel') && firstModule) {
    const rec = issues.get('ram_single_channel')!
    const part = firstModule.partNumber?.trim()
    rec.detalle =
      `Hay un solo módulo de ${gb(ram.totalBytes)} ${ram.type ?? ''} a ${ram.configuredMHz ?? '?'} MHz en una placa con ${hw.ram?.totalSlots} ranuras. ` +
      'En pruebas a 1080p, un solo módulo baja los FPS mínimos (1 % low) entre un 13 y un 33 % según el juego. Es la mejora con más impacto de este equipo.'
    rec.pasos = [
      `Compra un segundo módulo igual: ${gb(firstModule.capacityBytes)} ${ram.type ?? ''}-${firstModule.speedMHz}` +
        (part ? ` (idealmente el mismo modelo, ${firstModule.manufacturer ?? ''} ${part}).` : '.'),
      'Apaga el equipo, desconéctalo y colócalo en la ranura libre.',
      `Al arrancar, comprueba en Optikax que la RAM marca ${gb(ram.totalBytes * 2)} y 2 módulos.`
    ]
    rec.fuente = SRC.dualChannel
  }
  if (ram && d.cpu && hw.cpu?.name && ram.configuredMHz && !issues.has('ram_xmp_off')) {
    const official = officialRamMHz(hw.cpu.name, d.cpu.vendor, d.cpu.generation)
    if (official && ram.configuredMHz >= official && d.cpu.vendor === 'intel' && isLockedIntelChipset(board)) {
      recs.push({
        id: 'ram_speed_max',
        componente: 'ram',
        titulo: 'La RAM ya va a la velocidad máxima de esta plataforma',
        detalle: `El ${shortCpu(hw.cpu.name)} admite oficialmente DDR4-${official} y la placa (${board}) no permite subirla. Tu memoria ya está a ${ram.configuredMHz} MHz: activar XMP no aportaría nada.`,
        impacto: 'bajo',
        tipo: 'info',
        hecho: true,
        fuente: SRC.intelArk
      })
    }
  }

  // ----- CPU -----
  const cpuName = hw.cpu?.name ?? ''
  if (d.cpu?.vendor === 'intel' && !hw.isLaptop && /i[3579]-\d{4,5}F?\b/i.test(cpuName) && !/\d{4,5}K/i.test(cpuName)) {
    recs.push({
      id: 'cpu_power_limit',
      componente: 'cpu',
      titulo: 'Comprueba si la CPU se frena por potencia o temperatura',
      detalle: `El ${shortCpu(cpuName)} es un modelo de 65 W: con ese límite, el turbo en todos los núcleos puede bajar varios cientos de MHz en juegos exigentes, y el disipador de serie se queda corto.`,
      impacto: 'medio',
      tipo: 'manual',
      pasos: [
        'Instala HWiNFO y abre el modo "Sensors" mientras juegas 10 minutos.',
        'Mira si aparecen "Power Limit Exceeded" o "Thermal Throttling" en Sí, y la temperatura máxima de la CPU.',
        'Si pasa de unos 90 °C o hay throttling térmico, cambia el disipador de serie por uno de torre. Optikax no toca los límites de potencia de la BIOS.'
      ],
      hecho: false,
      fuente: SRC.cpuPower
    })
  }
  auto(
    'power_ultimate',
    'cpu',
    'medio',
    'Evita que Windows baje la frecuencia de la CPU o aparque núcleos entre fotogramas. En escritorio no tiene coste de batería.',
    null
  )

  // ----- GPU -----
  const gpu = d.gpu
  if (gpu?.vendor === 'nvidia' && /RTX\s*40|RTX\s*50/i.test(gpu.name)) {
    auto('hags_on', 'gpu', 'medio', `La ${gpu.name} admite programación por hardware, y es requisito de DLSS Frame Generation.`, SRC.hags)
  }
  if (gpu && GPU_NARROW_LINK.test(gpu.name) && platformPcie3(hw)) {
    recs.push({
      id: 'gpu_pcie3_x8',
      componente: 'gpu',
      titulo: 'La GPU funciona en PCIe 3.0 x8',
      detalle: `La ${gpu.name} usa solo 8 líneas PCIe y esta placa ofrece PCIe 3.0: se estima una pérdida del 5 al 10 %, mayor cuando se llena la VRAM.`,
      impacto: 'medio',
      tipo: 'manual',
      pasos: [
        `No te pases de la VRAM (${gpu.vramBytes ? gb(gpu.vramBytes) : 'la de tu GPU'}): en juegos exigentes usa texturas en Alto en lugar de Ultra.`,
        'Si el juego muestra el uso de VRAM en sus opciones, mantenlo por debajo del máximo.'
      ],
      hecho: false,
      fuente: SRC.pcieX8
    })
  }
  const primary = hw.displays.find((s) => s.primary) ?? hw.displays[0]
  if (gpu && primary && primary.maxHz > 60 && (gpu.vendor === 'nvidia' || gpu.vendor === 'amd')) {
    const monitor = hw.monitorNames.find((m) => Object.keys(MONITOR_VRR).some((k) => m.includes(k)))
    const vrr = monitor ? MONITOR_VRR[Object.keys(MONITOR_VRR).find((k) => monitor.includes(k))!] : null
    const cap = primary.maxHz - 3
    recs.push({
      id: 'gpu_vrr_setup',
      componente: 'gpu',
      titulo: gpu.vendor === 'nvidia' ? 'Activa G-SYNC Compatible con límite de FPS' : 'Activa FreeSync con límite de FPS',
      detalle:
        (vrr
          ? `Tu monitor (${monitor}) tiene ${vrr}. Sincronizar`
          : 'Si tu monitor admite Adaptive-Sync/FreeSync, sincronizar') +
        ` la frecuencia con la GPU elimina el tearing sin el retraso del V-Sync clásico. El límite de ${cap} FPS (3 por debajo de ${primary.maxHz} Hz) evita salir del rango.`,
      impacto: 'alto',
      tipo: 'manual',
      pasos:
        gpu.vendor === 'nvidia'
          ? [
              ...(vrr?.includes('HDMI') ? ['Conecta el monitor por HDMI (su Adaptive-Sync solo funciona por esa entrada).'] : []),
              'Activa Adaptive-Sync/FreeSync en el menú del monitor.',
              'NVIDIA App → Sistema → Pantalla: activa G-SYNC (pantalla completa y ventana).',
              'NVIDIA App → Gráficos → Ajustes globales: Sincronización vertical en "Activado" y en el juego desactivada.',
              `En el mismo sitio, "Velocidad de fotogramas máx." en ${cap} FPS, o activa NVIDIA Reflex en los juegos que lo tengan.`
            ]
          : [
              'Activa FreeSync/Adaptive-Sync en el menú del monitor.',
              'AMD Software → Pantalla: activa AMD FreeSync.',
              `AMD Software → Gráficos: Frame Rate Target Control en ${cap} FPS, o Radeon Anti-Lag en los juegos compatibles.`
            ],
      hecho: false,
      fuente: SRC.gsync
    })
  }

  // ----- Placa -----
  const bios = LATEST_BIOS[board]
  if (bios && hw.board?.biosVersion) {
    const current = hw.board.biosVersion.trim()
    const upToDate = Number(current) >= Number(bios.version)
    recs.push({
      id: 'board_bios',
      componente: 'placa',
      titulo: upToDate ? 'La BIOS está al día' : 'Hay una BIOS más nueva',
      detalle: upToDate
        ? `La ${board} tiene la BIOS ${current}, la última que publica el fabricante.`
        : `La ${board} tiene la BIOS ${current} y hay una ${bios.version} con mejoras de estabilidad y compatibilidad.`,
      impacto: upToDate ? 'bajo' : 'medio',
      tipo: upToDate ? 'info' : 'manual',
      pasos: upToDate ? undefined : [`Descarga la ${bios.version} desde ${bios.url}`, 'Actualízala con EZ Flash desde la propia BIOS, sin apagar el equipo durante el proceso.'],
      hecho: upToDate,
      fuente: bios.url
    })
  }
  if (/ASUS/i.test(hw.board?.manufacturer ?? '') && /\b[HBZ]3\d0(?=M|\b)/i.test(board)) {
    recs.push({
      id: 'board_no_rebar',
      componente: 'placa',
      titulo: 'Resizable BAR no está disponible en esta placa',
      detalle: `ASUS llevó Resizable BAR a sus placas de la serie 400 en adelante, pero no a la serie 300 (${board}). No hay nada que activar: no busques la opción en la BIOS.`,
      impacto: 'bajo',
      tipo: 'info',
      hecho: true,
      fuente: SRC.asusRebar
    })
  }

  // ----- Almacenamiento -----
  if (storage) {
    const hdds = new Set(storage.volumes.filter((v) => v.mediaType === 'HDD').map((v) => v.letter))
    const ssd = storage.volumes
      .filter((v) => v.mediaType === 'SSD')
      .sort((a, b) => (b.busType === 'NVMe' ? 1 : 0) - (a.busType === 'NVMe' ? 1 : 0) || b.freeBytes - a.freeBytes)[0]
    const onHdd = storage.games.filter((g) => hdds.has(g.letter))
    if (onHdd.length > 0 && ssd) {
      const total = onHdd.reduce((s, g) => s + g.sizeBytes, 0)
      const room = ssd.freeBytes - ssd.sizeBytes * 0.2
      recs.push({
        id: 'games_on_hdd',
        componente: 'almacenamiento',
        titulo: `${onHdd.length} juego${onHdd.length > 1 ? 's' : ''} en el disco mecánico`,
        detalle:
          `${onHdd.map((g) => `${g.name} (${gb(g.sizeBytes)})`).join(', ')} están en un HDD: cargas más largas y tirones al cargar zonas. ` +
          (room >= total
            ? `En ${ssd.letter}: hay sitio para moverlos (${gb(ssd.freeBytes)} libres).`
            : `En ${ssd.letter}: quedan ${gb(ssd.freeBytes)}; mueve primero los que juegues más.`),
        impacto: 'alto',
        tipo: 'manual',
        pasos: [
          'Steam: clic derecho en el juego → Propiedades → Archivos instalados → Mover carpeta de instalación.',
          'Epic: desinstala y vuelve a instalar eligiendo la unidad SSD.'
        ],
        hecho: false,
        fuente: null
      })
    } else if (storage.games.length > 0 && ssd && onHdd.length === 0) {
      recs.push({
        id: 'games_on_ssd',
        componente: 'almacenamiento',
        titulo: 'Tus juegos están en el SSD',
        detalle:
          (storage.games.length === 1 ? `Tu juego instalado (${storage.games[0].name}) está` : `Los ${storage.games.length} juegos instalados están`) +
          ` en ${ssd.letter}: (${ssd.model ?? ssd.busType}). Cargan lo más rápido posible en este equipo.`,
        impacto: 'bajo',
        tipo: 'info',
        hecho: true,
        fuente: null
      })
    }
    const sys = storage.volumes.find((v) => v.isSystem)
    if (sys && sys.mediaType === 'SSD' && sys.freeBytes / sys.sizeBytes < 0.2 && !issues.has('system_disk_full')) {
      recs.push({
        id: 'ssd_free_margin',
        componente: 'almacenamiento',
        titulo: 'Deja margen libre en el SSD del sistema',
        detalle: `En ${sys.letter}: queda menos del 20 % libre (${gb(sys.freeBytes)} de ${gb(sys.sizeBytes)}). Los SSD, sobre todo los que no tienen DRAM, escriben más lento cuando están casi llenos.`,
        impacto: 'medio',
        tipo: 'manual',
        pasos: ['Mueve juegos que no uses al otro disco o desinstálalos.', 'Configuración → Sistema → Almacenamiento → Archivos temporales.'],
        hecho: false,
        fuente: SRC.dramless
      })
    }
    if (storage.volumes.some((v) => v.mediaType === 'SSD')) {
      auto('trim_on', 'almacenamiento', storage.trimNtfs === false ? 'alto' : 'bajo', 'Con TRIM, el SSD sabe qué bloques puede limpiar y mantiene su velocidad de escritura.', SRC.trim)
    }
  }

  // ----- Pantallas -----
  const rates = new Set(hw.displays.map((s) => s.hz))
  if (hw.displays.length > 1 && rates.size > 1) {
    recs.push({
      id: 'display_mixed_hz',
      componente: 'pantalla',
      titulo: 'Monitores con frecuencias distintas',
      detalle: `Tienes pantallas a ${[...rates].sort((a, b) => b - a).join(' Hz y ')} Hz. En Windows 11 esa mezcla puede causar tirones en el monitor principal, sobre todo con vídeo o animaciones en el secundario.`,
      impacto: 'medio',
      tipo: 'manual',
      pasos: [
        'Mientras juegas, evita vídeo (YouTube, Twitch) en el segundo monitor.',
        'Desactiva la aceleración por hardware en el navegador y en Discord si notas tirones.',
        `Para comprobar si es la causa, pon los dos monitores a ${Math.min(...rates)} Hz un momento: si desaparecen los tirones, era la mezcla.`
      ],
      hecho: false,
      fuente: SRC.mixedHz
    })
  }

  // ----- Windows: lo que falta del catálogo, sin repetirlo -----
  const pending = tweaks.filter((t) => !t.activo && t.motivoNoAplica === null && t.riesgo === 'bajo')
  const linked = new Set(recs.map((r) => r.tweakId).filter(Boolean))
  const others = pending.filter((t) => !linked.has(t.id))
  if (others.length > 0) {
    recs.push({
      id: 'windows_pending',
      componente: 'windows',
      titulo: `${others.length} ajuste${others.length > 1 ? 's' : ''} de Windows por aplicar`,
      detalle: `${others.map((t) => t.titulo).join(' · ')}. Están en la pantalla Optimizar, con su respaldo para revertir.`,
      impacto: 'medio',
      tipo: 'info',
      hecho: false,
      fuente: null
    })
  }

  recs.push(...issues.values())

  // Pendientes primero, por impacto; a igual impacto, lo que más rinde según las pruebas.
  const order = { alto: 0, medio: 1, bajo: 2 } as const
  const tieBreak = (id: string): number => (id === 'ram_single_channel' ? 0 : id === 'games_on_hdd' ? 1 : 2)
  recs.sort(
    (a, b) => Number(a.hecho) - Number(b.hecho) || order[a.impacto] - order[b.impacto] || tieBreak(a.id) - tieBreak(b.id)
  )

  return { componentes: summaries(hw, storage), recomendaciones: recs }
}

function summaries(hw: HardwareProfile, storage: StorageInfo | null): ComponentSummary[] {
  const d = hw.derived
  const out: ComponentSummary[] = []
  if (hw.cpu?.name) out.push({ componente: 'cpu', resumen: `${shortCpu(hw.cpu.name)} · ${hw.cpu.cores} núcleos / ${hw.cpu.threads} hilos` })
  if (d.gpu) out.push({ componente: 'gpu', resumen: `${d.gpu.name}${d.gpu.vramBytes ? ` · ${gb(d.gpu.vramBytes)}` : ''}` })
  if (d.ram)
    out.push({
      componente: 'ram',
      resumen: `${gb(d.ram.totalBytes)} ${d.ram.type ?? ''} · ${d.ram.configuredMHz ?? '?'} MHz · ${d.ram.modules} de ${hw.ram?.totalSlots ?? '?'} ranuras`
    })
  if (hw.board?.product) out.push({ componente: 'placa', resumen: `${hw.board.product} · BIOS ${hw.board.biosVersion ?? '?'}` })
  if (storage?.volumes.length)
    out.push({
      componente: 'almacenamiento',
      resumen: storage.volumes
        .sort((a, b) => a.letter.localeCompare(b.letter))
        .map((v) => `${v.letter}: ${v.busType === 'NVMe' ? 'NVMe' : v.mediaType} ${gb(v.sizeBytes)} (${gb(v.freeBytes)} libres)`)
        .join(' · ')
    })
  if (hw.displays.length)
    out.push({ componente: 'pantalla', resumen: hw.displays.map((s) => `${s.width}×${s.height} a ${s.hz} Hz`).join(' · ') })
  out.push({ componente: 'windows', resumen: hw.os?.caption?.replace(/^Microsoft\s+/, '') ?? 'Windows' })
  return out
}
