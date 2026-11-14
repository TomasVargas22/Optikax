/**
 * Capturas y medición de GPU (solo desarrollo): `npm run capture`.
 * Abre la app real, recorre las pantallas guardando una captura de cada una en docs/capturas/
 * y mide el uso de GPU de Electron con la ventana visible y minimizada.
 * Nunca se carga en la app empaquetada (index.ts lo bloquea y electron-builder lo excluye).
 */
import { app, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/types'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Datos de la captura en una carpeta temporal (no toca los del usuario): efectos 3D en "Siempre"
 * para ver el 3D aunque Windows tenga el movimiento reducido.
 */
export function seedCapture(): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ efectos3d: 'siempre' }))
}

/** Uso medio de GPU (%) de todos los procesos de Electron durante `seconds` segundos. */
function measureGpu(seconds: number): Promise<number> {
  const script = `
    $ids = (Get-Process electron -ErrorAction SilentlyContinue).Id
    $samples = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples ${seconds}).CounterSamples
    $byTime = $samples | Where-Object { $n = $_.InstanceName; $ids | Where-Object { $n -like "pid_$($_)_*" } } | Group-Object Timestamp
    $totals = $byTime | ForEach-Object { ($_.Group | Measure-Object CookedValue -Sum).Sum }
    if ($totals) { [math]::Round((($totals | Measure-Object -Average).Average), 2) } else { 0 }
  `
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true }, (_err, out) =>
      resolve(Number.parseFloat(String(out).trim().replace(',', '.')) || 0)
    )
  })
}

async function click(win: BrowserWindow, label: string): Promise<void> {
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.nav button, .titlebar-end button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`
  )
}

export async function runCapture(win: BrowserWindow): Promise<void> {
  const dir = join(app.getAppPath(), 'docs', 'capturas')
  mkdirSync(dir, { recursive: true })
  const log: string[] = []
  const say = (msg: string): void => {
    console.log(`[capture] ${msg}`)
    log.push(msg)
  }

  // Windows no deja que una app se ponga delante sola: "siempre encima" un instante le da el foco.
  win.webContents.setBackgroundThrottling(false)
  win.show()
  win.setAlwaysOnTop(true)
  win.focus()
  win.webContents.focus()
  setTimeout(() => win.setAlwaysOnTop(false), 1500)
  // Loader: se espera a que termine el escaneo de hardware.
  await sleep(1200)
  await win.webContents.capturePage().then((img) => writeFileSync(join(dir, '00-loader.png'), img.toPNG()))
  for (let i = 0; i < 120; i++) {
    const done = await win.webContents.executeJavaScript(`!document.querySelector('.loader')`)
    if (done) break
    await sleep(500)
  }
  await sleep(1500)

  say(
    `estado ventana: ${await win.webContents.executeJavaScript(`document.querySelector('.shell').dataset.window`)} · ` +
      `movimiento reducido: ${await win.webContents.executeJavaScript(`matchMedia('(prefers-reduced-motion: reduce)').matches`)} · ` +
      `canvas 3D: ${await win.webContents.executeJavaScript(`document.querySelectorAll('canvas').length`)}`
  )

  const pages: [string, string][] = [
    ['Panel', '01-panel'],
    ['Optimizar', '02-optimizar'],
    ['Memoria', '03-memoria'],
    ['Modo Juego', '04-modo-juego'],
    ['Ajustes', '05-ajustes']
  ]
  for (const [label, file] of pages) {
    await click(win, label)
    await sleep(1800)
    const img = await win.webContents.capturePage()
    writeFileSync(join(dir, `${file}.png`), img.toPNG())
    say(`captura ${file}.png`)
  }

  // Panel desplazado hasta los pasos 01/02/03 sobre la ola.
  await click(win, 'Panel')
  await sleep(1200)
  await win.webContents.executeJavaScript(`document.querySelector('.page').scrollTo(0, 520)`)
  await sleep(1200)
  writeFileSync(join(dir, '01b-panel-pasos.png'), (await win.webContents.capturePage()).toPNG())
  // Sección "Tu equipo": se espera a que termine el análisis de discos.
  for (let i = 0; i < 40; i++) {
    if (await win.webContents.executeJavaScript(`!!document.querySelector('.equipo-grid')`)) break
    await sleep(500)
  }
  await win.webContents.executeJavaScript(`document.querySelector('.equipo')?.scrollIntoView({ block: 'start' })`)
  await sleep(1200)
  writeFileSync(join(dir, '01c-tu-equipo.png'), (await win.webContents.capturePage()).toPNG())
  await win.webContents.executeJavaScript(`document.querySelector('.page').scrollBy(0, 700)`)
  await sleep(800)
  writeFileSync(join(dir, '01d-tu-equipo-2.png'), (await win.webContents.capturePage()).toPNG())
  await win.webContents.executeJavaScript(`document.querySelector('.page').scrollTo(0, 0)`)

  // GPU: Panel con el 3D activo, y después con la ventana minimizada.
  // Windows no da el foco a una ventana abierta por script mientras usas otra app: se simula el
  // evento de "visible y con foco" que enviaría el proceso principal. Al minimizar llega el real.
  win.webContents.send(IPC.windowState, 'visible')
  await sleep(1500)
  const state = await win.webContents.executeJavaScript(
    `(() => { const s = document.querySelector('.shell').dataset; return s.window + (s.game ? ' · con juego abierto' : '') })()`
  )
  const visible = await measureGpu(8)
  say(`GPU con el Panel visible (estado ${state}): ${visible}%`)
  win.minimize()
  await sleep(1500)
  const minimized = await measureGpu(8)
  say(`GPU con la ventana minimizada: ${minimized}%`)

  writeFileSync(join(dir, 'medicion.txt'), log.join('\n') + '\n')
}
