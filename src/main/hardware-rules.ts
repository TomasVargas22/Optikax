import type {
  GpuVendor,
  HardwareDerived,
  HardwareIssue,
  HardwareRaw,
  IssueSeverity
} from '@shared/types'

/** Reglas locales (sin IA): datos derivados y problemas evidentes del hardware. */

const GB = 2 ** 30
const BALANCED_PLAN = '381b4222-f694-41f0-9685-ff5bb260df2e'
const VIRTUAL_GPU = /basic|virtual|parsec|remote|idd|displaylink|meta |citrix|vmware|hyper-v/i

/** Velocidades comerciales de DDR4/DDR5 para reconocerlas dentro de un número de parte. */
const KNOWN_SPEEDS = [
  2133, 2400, 2666, 2800, 2933, 3000, 3200, 3333, 3466, 3600, 3733, 3800, 4000, 4133, 4266, 4400,
  4800, 5200, 5600, 6000, 6200, 6400, 6600, 6800, 7200, 7600, 8000
]

function deriveCpu(raw: HardwareRaw): HardwareDerived['cpu'] {
  const name = raw.cpu?.name
  if (!name) return null
  const x3d = /X3D/i.test(name)

  if (/intel/i.test(name)) {
    let generation: number | null = null
    const core = /i[3579]-(\d{4,5})/i.exec(name)
    const ultra = /Ultra\s+\d\s+(\d)\d{2}/i.exec(name)
    if (core) generation = Number(core[1].length === 5 ? core[1].slice(0, 2) : core[1][0])
    else if (ultra) generation = Number(ultra[1])
    const hybrid = ultra !== null || (generation !== null && generation >= 12)
    return { vendor: 'intel', generation, hybrid, x3d: false }
  }
  if (/amd|ryzen/i.test(name)) {
    const ryzen = /Ryzen\s+(?:\w+\s+)?\d\s+(?:PRO\s+)?(\d)\d{3}/i.exec(name)
    return { vendor: 'amd', generation: ryzen ? Number(ryzen[1]) * 1000 : null, hybrid: false, x3d }
  }
  return { vendor: 'otro', generation: null, hybrid: false, x3d }
}

function gpuVendor(name: string): GpuVendor {
  if (/nvidia|geforce|rtx|gtx/i.test(name)) return 'nvidia'
  if (/amd|radeon/i.test(name)) return 'amd'
  if (/intel|arc/i.test(name)) return 'intel'
  return 'otro'
}

function deriveGpu(raw: HardwareRaw): HardwareDerived['gpu'] {
  const real = raw.gpus.filter((g) => g?.name && !VIRTUAL_GPU.test(g.name))
  if (real.length === 0) return null
  const best = real.reduce((a, b) => ((b.vramBytes ?? 0) > (a.vramBytes ?? 0) ? b : a))
  return {
    name: best.name!,
    vendor: gpuVendor(best.name!),
    vramBytes: best.vramBytes,
    driverDate: best.driverDate
  }
}

/** Velocidad nominal que sugiere el número de parte (p. ej. CMK16GX4M2B3200C16 → 3200). */
export function ratedSpeedFromPart(part: string | null, type: 'DDR3' | 'DDR4' | 'DDR5' | null): number | null {
  if (!part) return null
  const p = part.toUpperCase()
  const short = /^KF[345](\d{2})C/.exec(p) ?? /^BL\d+G(\d{2})C/.exec(p)
  if (short) return Number(short[1]) * 100

  const plausible = (mhz: number): boolean =>
    type === 'DDR5' ? mhz >= 4000 : type === 'DDR4' ? mhz <= 5333 : true
  const found = KNOWN_SPEEDS.filter((s) => plausible(s) && p.includes(String(s)))
  return found.length ? Math.max(...found) : null
}

function deriveRam(raw: HardwareRaw): HardwareDerived['ram'] {
  const modules = raw.ram?.modules ?? []
  if (modules.length === 0) return null
  const smbios = modules[0].smbiosType
  const type = smbios === 34 ? 'DDR5' : smbios === 26 ? 'DDR4' : smbios === 24 ? 'DDR3' : null
  const configured = Math.min(...modules.map((m) => m.configuredMHz).filter((v) => v > 0))
  const rated = Math.max(
    ...modules.map((m) => Math.max(m.speedMHz || 0, ratedSpeedFromPart(m.partNumber, type) ?? 0))
  )
  return {
    totalBytes: modules.reduce((sum, m) => sum + m.capacityBytes, 0),
    type,
    configuredMHz: Number.isFinite(configured) ? configured : null,
    ratedMHz: rated > 0 ? rated : null,
    modules: modules.length
  }
}

function deriveSystemDisk(raw: HardwareRaw): HardwareDerived['systemDisk'] {
  const disk = raw.disks.find((d) => d?.isSystem)
  if (!disk) return null
  const kind =
    disk.busType === 'NVMe' ? 'NVMe' : disk.mediaType === 'SSD' ? 'SSD' : disk.mediaType === 'HDD' ? 'HDD' : 'otro'
  return { name: disk.name, kind }
}

export function derive(raw: HardwareRaw): HardwareDerived {
  const display = raw.displays.find((d) => d?.primary) ?? raw.displays[0] ?? null
  return {
    cpu: deriveCpu(raw),
    gpu: deriveGpu(raw),
    ram: deriveRam(raw),
    systemDisk: deriveSystemDisk(raw),
    display: display && { width: display.width, height: display.height, hz: display.hz, maxHz: display.maxHz }
  }
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { alta: 0, media: 1, baja: 2 }

export function findIssues(raw: HardwareRaw, d: HardwareDerived, now = new Date()): HardwareIssue[] {
  const issues: HardwareIssue[] = []
  const gb = (bytes: number): string => `${Math.round(bytes / GB)} GB`

  if (d.ram) {
    const slots = raw.ram?.totalSlots ?? 0
    if (d.ram.modules === 1 && slots >= 2) {
      issues.push({
        id: 'ram_single_channel',
        severidad: 'alta',
        titulo: 'La RAM trabaja en un solo canal',
        detalle: `Hay un único módulo de ${gb(d.ram.totalBytes)} en una placa con ${slots} ranuras. En doble canal la memoria rinde bastante más, sobre todo en los FPS mínimos.`,
        accion: 'Agrega un segundo módulo igual (misma capacidad y velocidad) en la otra ranura.'
      })
    }
    if (d.ram.ratedMHz && d.ram.configuredMHz && d.ram.ratedMHz - d.ram.configuredMHz >= 200) {
      issues.push({
        id: 'ram_xmp_off',
        severidad: 'alta',
        titulo: 'La RAM corre por debajo de su velocidad',
        detalle: `Está a ${d.ram.configuredMHz} MHz y el módulo parece ser de ${d.ram.ratedMHz} MHz. Suele pasar cuando el perfil XMP/EXPO está apagado.`,
        accion: 'Entra a la BIOS y activa el perfil XMP (Intel) o EXPO/DOCP (AMD).'
      })
    }
    if (d.ram.totalBytes < 15 * GB) {
      issues.push({
        id: 'ram_low',
        severidad: 'media',
        titulo: 'Poca memoria para juegos actuales',
        detalle: `El equipo tiene ${gb(d.ram.totalBytes)}. Muchos juegos recientes piden 16 GB.`,
        accion: 'Considera ampliar a 16 GB o más. Mientras tanto, la limpieza automática de RAM ayuda.'
      })
    }
  }

  for (const [i, s] of raw.displays.entries()) {
    if (!s || s.maxHz - s.hz < 5) continue
    issues.push({
      id: `display_low_hz_${i}`,
      severidad: 'alta',
      titulo: 'El monitor no está a su máxima frecuencia',
      detalle: `La pantalla de ${s.width}×${s.height} está a ${s.hz} Hz y admite ${s.maxHz} Hz.`,
      accion: `En Configuración → Pantalla → Pantalla avanzada, elige ${s.maxHz} Hz.`
    })
  }

  if (d.gpu?.driverDate) {
    const days = (now.getTime() - new Date(d.gpu.driverDate).getTime()) / 86_400_000
    if (days > 180) {
      issues.push({
        id: 'gpu_driver_old',
        severidad: 'media',
        titulo: 'El driver de la GPU está desactualizado',
        detalle: `El driver de la ${d.gpu.name} es del ${d.gpu.driverDate} (hace ${Math.round(days / 30)} meses).`,
        accion: 'Descarga el driver más reciente desde la web del fabricante de la GPU.'
      })
    }
  }

  if (!raw.isLaptop && raw.power?.guid === BALANCED_PLAN) {
    issues.push({
      id: 'power_balanced',
      severidad: 'media',
      titulo: 'Plan de energía Equilibrado',
      detalle: 'En un equipo de escritorio, el plan Equilibrado puede frenar la CPU al jugar.',
      accion: 'Activa el plan de Máximo rendimiento desde la pantalla Optimizar.'
    })
  }

  if (d.systemDisk?.kind === 'HDD') {
    issues.push({
      id: 'system_on_hdd',
      severidad: 'media',
      titulo: 'Windows está en un disco mecánico',
      detalle: `El sistema arranca desde ${d.systemDisk.name ?? 'un HDD'}. Los tiempos de carga serán largos.`,
      accion: 'Mueve Windows y los juegos a un SSD.'
    })
  }

  const vol = raw.systemVolume
  if (vol && vol.sizeBytes > 0 && (vol.freeBytes < 20 * GB || vol.freeBytes / vol.sizeBytes < 0.1)) {
    issues.push({
      id: 'system_disk_full',
      severidad: 'media',
      titulo: 'Queda poco espacio en el disco del sistema',
      detalle: `En ${vol.letter} quedan ${gb(vol.freeBytes)} libres de ${gb(vol.sizeBytes)}.`,
      accion: 'Libera espacio: con el disco casi lleno, Windows y los SSD rinden peor.'
    })
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severidad] - SEVERITY_ORDER[b.severidad])
}
