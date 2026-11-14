/**
 * Verificación del motor de recomendaciones (solo desarrollo): `npm run verify:perfil`.
 * - Con el equipo real: deben salir las recomendaciones investigadas para esta PC.
 * - Con 3 equipos de ejemplo distintos: las reglas son generales y no dan consejos absurdos.
 * Solo lee: no cambia nada del sistema.
 */
import type { HardwareProfile, HardwareRaw, StorageInfo, TweakInfo } from '@shared/types'
import { getHardware } from './hardware'
import { derive, findIssues } from './hardware-rules'
import { buildProfile } from './profile'
import { getStorage } from './storage'
import { listTweaks } from './tweaks'

const GB = 2 ** 30

function profileFrom(raw: HardwareRaw): HardwareProfile {
  const derived = derive(raw)
  return { ...raw, scannedAt: new Date().toISOString(), derived, issues: findIssues(raw, derived) }
}

function base(): HardwareRaw {
  return {
    cpu: null,
    gpus: [],
    ram: null,
    board: null,
    disks: [],
    systemVolume: null,
    displays: [],
    monitorNames: [],
    os: { caption: 'Microsoft Windows 11 Pro', version: '10.0.26100', build: 26100, ubr: 1, displayVersion: '24H2' },
    isLaptop: false,
    power: null,
    errors: []
  }
}

const mod = (gbs: number, mhz: number, part: string, slot: string): NonNullable<HardwareRaw['ram']>['modules'][number] => ({
  capacityBytes: gbs * GB,
  speedMHz: mhz,
  configuredMHz: mhz,
  manufacturer: 'Kingston',
  partNumber: part,
  slot,
  smbiosType: mhz > 4000 ? 34 : 26
})

/** Ryzen 7 7800X3D + DDR5 en doble canal + RX 7800 XT en B650, un monitor de 165 Hz. */
function ryzen(): { hw: HardwareProfile; storage: StorageInfo } {
  const raw = base()
  raw.cpu = { name: 'AMD Ryzen 7 7800X3D 8-Core Processor', manufacturer: 'AuthenticAMD', cores: 8, threads: 16, maxMHz: 4200 }
  raw.gpus = [{ name: 'AMD Radeon RX 7800 XT', driverVersion: '32.0', driverDate: '2026-10-20', vramBytes: 16 * GB, pnpId: null }]
  raw.ram = { totalSlots: 4, modules: [mod(16, 6000, 'KF560C30', 'A2'), mod(16, 6000, 'KF560C30', 'B2')] }
  raw.board = { manufacturer: 'Gigabyte', product: 'B650 AORUS ELITE AX', biosVersion: 'F30', biosDate: '2026-05-01' }
  raw.disks = [{ name: 'Samsung 990 PRO 2TB', mediaType: 'SSD', busType: 'NVMe', sizeBytes: 2000 * GB, isSystem: true }]
  raw.systemVolume = { letter: 'C', sizeBytes: 2000 * GB, freeBytes: 1200 * GB }
  raw.displays = [{ adapter: 'AMD Radeon RX 7800 XT', width: 2560, height: 1440, hz: 165, maxHz: 165, primary: true }]
  raw.monitorNames = ['LG 27GP850']
  return {
    hw: profileFrom(raw),
    storage: {
      volumes: [{ letter: 'C', label: '', fileSystem: 'NTFS', sizeBytes: 2000 * GB, freeBytes: 1200 * GB, mediaType: 'SSD', busType: 'NVMe', model: 'Samsung 990 PRO', isSystem: true }],
      games: [{ name: 'Cyberpunk 2077', store: 'Steam', path: 'C:\\Steam\\steamapps\\common\\Cyberpunk 2077', sizeBytes: 70 * GB, letter: 'C' }],
      trimNtfs: true
    }
  }
}

/** Laptop i7-12700H + RTX 4060 Laptop, un solo módulo de 2 ranuras, pantalla de 144 Hz. */
function laptop(): { hw: HardwareProfile; storage: StorageInfo } {
  const raw = base()
  raw.isLaptop = true
  raw.cpu = { name: '12th Gen Intel(R) Core(TM) i7-12700H', manufacturer: 'GenuineIntel', cores: 14, threads: 20, maxMHz: 2300 }
  raw.gpus = [{ name: 'NVIDIA GeForce RTX 4060 Laptop GPU', driverVersion: '32.0', driverDate: '2026-09-01', vramBytes: 8 * GB, pnpId: null }]
  raw.ram = { totalSlots: 2, modules: [mod(16, 4800, 'M425R2GA3BB0', 'DIMM A')] }
  raw.board = { manufacturer: 'LENOVO', product: 'LNVNB161216', biosVersion: 'KWCN38WW', biosDate: '2026-03-01' }
  raw.disks = [{ name: 'WD PC SN740', mediaType: 'SSD', busType: 'NVMe', sizeBytes: 512 * GB, isSystem: true }]
  raw.systemVolume = { letter: 'C', sizeBytes: 512 * GB, freeBytes: 60 * GB }
  raw.displays = [{ adapter: 'NVIDIA GeForce RTX 4060 Laptop GPU', width: 1920, height: 1200, hz: 144, maxHz: 144, primary: true }]
  return {
    hw: profileFrom(raw),
    storage: {
      volumes: [{ letter: 'C', label: '', fileSystem: 'NTFS', sizeBytes: 512 * GB, freeBytes: 60 * GB, mediaType: 'SSD', busType: 'NVMe', model: 'WD PC SN740', isSystem: true }],
      games: [],
      trimNtfs: false
    }
  }
}

/** PC antiguo: Windows y juegos en un HDD, SSD SATA de datos, monitor de 60 Hz, i5-8400 en B360. */
function oldHdd(): { hw: HardwareProfile; storage: StorageInfo } {
  const raw = base()
  raw.cpu = { name: 'Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz', manufacturer: 'GenuineIntel', cores: 6, threads: 6, maxMHz: 2800 }
  raw.gpus = [{ name: 'NVIDIA GeForce GTX 1060 6GB', driverVersion: '31.0', driverDate: '2025-01-10', vramBytes: 6 * GB, pnpId: null }]
  raw.ram = { totalSlots: 4, modules: [mod(8, 2666, 'KHX2666C16', 'A1'), mod(8, 2666, 'KHX2666C16', 'B1')] }
  raw.board = { manufacturer: 'MSI', product: 'B360M PRO-VDH', biosVersion: '7B24v18', biosDate: '2020-01-01' }
  raw.disks = [
    { name: 'WDC WD10EZEX', mediaType: 'HDD', busType: 'SATA', sizeBytes: 1000 * GB, isSystem: true },
    { name: 'Crucial MX500', mediaType: 'SSD', busType: 'SATA', sizeBytes: 500 * GB, isSystem: false }
  ]
  raw.systemVolume = { letter: 'C', sizeBytes: 1000 * GB, freeBytes: 300 * GB }
  raw.displays = [{ adapter: 'NVIDIA GeForce GTX 1060 6GB', width: 1920, height: 1080, hz: 60, maxHz: 60, primary: true }]
  return {
    hw: profileFrom(raw),
    storage: {
      volumes: [
        { letter: 'C', label: '', fileSystem: 'NTFS', sizeBytes: 1000 * GB, freeBytes: 300 * GB, mediaType: 'HDD', busType: 'SATA', model: 'WDC WD10EZEX', isSystem: true },
        { letter: 'E', label: 'SSD', fileSystem: 'NTFS', sizeBytes: 500 * GB, freeBytes: 400 * GB, mediaType: 'SSD', busType: 'SATA', model: 'Crucial MX500', isSystem: false }
      ],
      games: [{ name: 'Counter-Strike 2', store: 'Steam', path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive', sizeBytes: 35 * GB, letter: 'C' }],
      trimNtfs: true
    }
  }
}

/** Catálogo de ejemplo: todos aplican salvo la compresión; ninguno activo. */
function sampleTweaks(real: TweakInfo[], isLaptop: boolean): TweakInfo[] {
  return real.map((t) => ({
    ...t,
    activo: false,
    revertible: false,
    motivoNoAplica: t.id === 'memory_compression_off' || (isLaptop && t.id === 'power_throttling_off') ? 'no aplica' : null
  }))
}

export async function runProfileVerification(): Promise<number> {
  const results: boolean[] = []
  const check = (caso: string, ok: boolean, detalle = ''): void => {
    results.push(ok)
    console.log(`[verify-perfil] ${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? ` · ${detalle}` : ''}`)
  }

  // 1. Equipo real.
  const [hw, storage, tweaks] = await Promise.all([getHardware(true, () => {}), getStorage(true), listTweaks()])
  const real = buildProfile(hw, storage, tweaks)
  const ids = new Set(real.recomendaciones.map((r) => r.id))
  console.log('[verify-perfil] --- este equipo ---')
  for (const c of real.componentes) console.log(`[verify-perfil]   ${c.componente}: ${c.resumen}`)
  for (const r of real.recomendaciones)
    console.log(`[verify-perfil]   [${r.impacto}${r.hecho ? ', hecho' : ''}] ${r.componente} · ${r.tipo} · ${r.titulo}`)
  const expectIds = ['ram_single_channel', 'ram_speed_max', 'cpu_power_limit', 'gpu_pcie3_x8', 'gpu_vrr_setup', 'board_bios', 'board_no_rebar', 'display_mixed_hz', 'games_on_ssd', 'auto_trim_on', 'auto_hags_on']
  for (const id of expectIds) check(`este equipo → ${id}`, ids.has(id))
  const dual = real.recomendaciones.find((r) => r.id === 'ram_single_channel')
  check('el doble canal es lo primero y propone el mismo módulo', real.recomendaciones[0]?.id === 'ram_single_channel' && /PSD416G26662/.test(dual?.pasos?.join(' ') ?? ''))
  check('la BIOS 2209 figura como al día', real.recomendaciones.find((r) => r.id === 'board_bios')?.hecho === true)
  check('el límite de FPS es 72 a 75 Hz', /72 FPS/.test(real.recomendaciones.find((r) => r.id === 'gpu_vrr_setup')?.pasos?.join(' ') ?? ''))
  check('sin duplicados', ids.size === real.recomendaciones.length)

  // 2. Ryzen + Radeon + DDR5.
  const r = ryzen()
  const rp = buildProfile(r.hw, r.storage, sampleTweaks(tweaks, false))
  const rIds = new Set(rp.recomendaciones.map((x) => x.id))
  check('Ryzen DDR5: sin aviso de un solo canal ni de velocidad de RAM', !rIds.has('ram_single_channel') && !rIds.has('ram_speed_max'))
  check('Ryzen: sin PCIe 3.0, BIOS ni Resizable BAR de ASUS', !rIds.has('gpu_pcie3_x8') && !rIds.has('board_bios') && !rIds.has('board_no_rebar'))
  check('Ryzen: FreeSync con límite 162 FPS', /FreeSync/.test(rp.recomendaciones.find((x) => x.id === 'gpu_vrr_setup')?.titulo ?? '') && /162 FPS/.test(rp.recomendaciones.find((x) => x.id === 'gpu_vrr_setup')?.pasos?.join(' ') ?? ''))
  check('Ryzen: sin consejo de límite de potencia Intel ni HAGS de NVIDIA', !rIds.has('cpu_power_limit') && !rIds.has('auto_hags_on'))

  // 3. Laptop.
  const l = laptop()
  const lp = buildProfile(l.hw, l.storage, sampleTweaks(tweaks, true))
  const lIds = new Set(lp.recomendaciones.map((x) => x.id))
  check('Laptop: aviso de un solo canal', lIds.has('ram_single_channel'))
  check('Laptop: sin consejo de disipador de escritorio', !lIds.has('cpu_power_limit'))
  check('Laptop: TRIM apagado → recomendación automática de impacto alto', lp.recomendaciones.find((x) => x.id === 'auto_trim_on')?.impacto === 'alto')
  check('Laptop: sin PCIe 3.0 (12.ª gen es PCIe 4.0)', !lIds.has('gpu_pcie3_x8'))

  // 4. PC con HDD.
  const o = oldHdd()
  const op = buildProfile(o.hw, o.storage, sampleTweaks(tweaks, false))
  const oIds = new Set(op.recomendaciones.map((x) => x.id))
  check('HDD: juegos en el disco mecánico, con sitio en el SSD', oIds.has('games_on_hdd') && /hay sitio/.test(op.recomendaciones.find((x) => x.id === 'games_on_hdd')?.detalle ?? ''))
  check('HDD: Windows en disco mecánico (problema existente integrado)', oIds.has('system_on_hdd'))
  check('HDD: driver viejo integrado como recomendación de GPU', op.recomendaciones.find((x) => x.id === 'gpu_driver_old')?.componente === 'gpu')
  check('HDD: 60 Hz → sin G-SYNC ni límite de FPS', !oIds.has('gpu_vrr_setup'))
  check('HDD: RAM a 2666 en i5-8400 + B360 → ya al máximo', oIds.has('ram_speed_max'))

  return results.every(Boolean) ? 0 : 1
}
