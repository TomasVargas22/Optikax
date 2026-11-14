# PROMPT MAESTRO — OPTIKAX

> Pega este prompt completo en una sesión de Claude Code abierta en `C:\Users\Administrator\Documents\Optikax`.
> Construye la app por fases y verifica cada una antes de seguir.

---

## 0. ROL Y OBJETIVO

Eres un ingeniero senior de Windows/Electron y design engineer. Vas a construir **Optikax**: una app de escritorio para Windows 10/11 que optimiza el PC **100% para gaming** con cuatro pilares:

1. **Detecta** el hardware exacto del equipo.
2. **Investiga** con IA (Claude + búsqueda web) qué recomiendan los foros (Reddit, Tom's Hardware, Guru3D, Blur Busters, LTT, foros de NVIDIA y AMD) para *esos* componentes, y deduce la MEJOR configuración.
3. **Aplica** solo ajustes seguros y reversibles. **Nunca** deshabilita servicios ni la seguridad del sistema.
4. **Libera RAM** (standby list y working sets) a mano o automáticamente, y activa un **Modo Juego automático** cuando detecta un juego.

La interfaz debe sentirse como un producto premium de galería, no como el típico "optimizador" lleno de medidores RGB. Toma como referencia el shot de Dribbble *Brody — Digital Audio E-Commerce Landing Page Animation* (Korsa); el análisis está en la sección 6.

---

## 1. REGLAS NO NEGOCIABLES

- **Prohibido** deshabilitar o modificar servicios de Windows (`sc config`, `Set-Service`, `Stop-Service`). Eso incluye SysMain, Windows Update, Defender, Firewall, Search, Print Spooler y cualquier otro.
- **Prohibido** tocar la seguridad: Defender, UAC, SmartScreen, VBS/HVCI (Memory Integrity), mitigaciones de Spectre/Meltdown, DEP, Firewall o telemetría por políticas.
- **Prohibido** prioridad `Realtime` en procesos, borrar archivos del sistema, "debloat" de apps UWP o editar `bcdedit`.
- **Lista blanca:** la IA solo puede recomendar IDs del catálogo de ajustes (sección 4.3). Jamás ejecutes comandos o claves de registro que genere el modelo.
- **Reversibilidad total:**
  - antes del primer cambio, crea un punto de restauración (si System Protection está activo; si no, avisa y continúa);
  - guarda los valores originales en `%APPDATA%\Optikax\backup.json` solo la primera vez, para no pisar el original;
  - incluye un botón **Revertir todo**;
  - si un valor no existía antes, al revertir se **elimina**.
- La app corre **elevada** (`requestedExecutionLevel: requireAdministrator`).
- La API key de Anthropic se guarda cifrada con `safeStorage` de Electron. Nunca va en texto plano ni en logs.
- Si un ajuste requiere reinicio o cerrar sesión, se marca en la interfaz y se avisa al aplicar.

---

## 2. STACK Y ESTADO ACTUAL

**Ya existe en el repo:**
- `package.json` con la configuración de electron-builder: NSIS, `requireAdministrator` y `extraResources: resources/scripts`.
- Dependencias instaladas:
  - `@anthropic-ai/sdk@1.8.0`
  - `zod@4`
  - `electron@45`
  - `electron-vite@6`
  - `vite@8`
  - `@vitejs/plugin-react@6`
  - `react@19`
  - `typescript@7`
  - `electron-builder`
- La descarga del binario de Electron pudo quedar incompleta. Verifica que exista `node_modules/electron/dist/electron.exe`; si no, ejecuta `node node_modules/electron/install.js`.

**Por agregar:**
- `three`, `@react-three/fiber`, `@react-three/drei`
- `framer-motion` (o `motion`)
- Fuentes locales con `@fontsource-variable/inter-tight` y `@fontsource/instrument-serif`, para que la app funcione **sin internet**.

**Estructura (electron-vite):**
```
electron.vite.config.ts        # main/preload/renderer; usar build.externalizeDeps (externalizeDepsPlugin está deprecado)
resources/scripts/             # .ps1 (hardware.ps1, tweaks.ps1, worker.ps1)
src/main/                      # index.ts, ipc.ts, hardware.ts, memory.ts, tweaks/, ai.ts, gamemode.ts, store.ts, ps.ts
src/preload/index.ts           # contextBridge → window.optikax (API tipada)
src/renderer/                  # React: pages/, components/, three/, styles/
src/shared/types.ts            # tipos compartidos main↔renderer
```

**Seguridad de Electron:**
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` en el preload cuando sea posible.
- Toda la comunicación con el proceso principal pasa por `ipcMain.handle`.
- Ventana con `titleBarStyle: 'hidden'` + `titleBarOverlay` en colores de la marca, mínimo 1180×760.

**Rutas de scripts:**
```ts
const scripts = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(app.getAppPath(), 'resources', 'scripts')
```

---

## 3. CAPA DE SISTEMA (PowerShell + C# vía Add-Type)

### 3.1 `ps.ts`, el ejecutor
- `runScript(file, argsJson)`: lanza `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <ps1>`, pasa los argumentos como JSON por stdin y lee un único JSON por stdout. Fuerza `[Console]::OutputEncoding = UTF8`.
- **Worker persistente** (`worker.ps1`):
  - es un solo proceso de larga vida que compila **una vez** una clase C# `OptikaxNative` con `Add-Type`;
  - protocolo de una línea JSON por petición: `{"id":1,"cmd":"memStats","args":{}}` → `{"id":1,"ok":true,"data":{...}}`;
  - si el worker muere, se reinicia con backoff;
  - cada petición tiene timeout.

### 3.2 `OptikaxNative` (C#)
- **Privilegios:** `AdjustTokenPrivileges` para `SeProfileSingleProcessPrivilege` y `SeIncreaseQuotaPrivilege`.
- **`MemStats()`:**
  - `GlobalMemoryStatusEx` para el total, lo disponible y la carga;
  - `NtQuerySystemInformation(SystemMemoryListInformation = 0x50)` para Zero, Free, Modified y el standby por prioridad (`PageCountByPriority[8]`), multiplicando por el tamaño de página;
  - fallback a `PerformanceCounter` (`Memory\Standby Cache *`).
- **`NtSetSystemInformation(0x50, cmd)`:**
  - `MemoryEmptyWorkingSets = 2`
  - `MemoryFlushModifiedList = 3`
  - `MemoryPurgeStandbyList = 4`
  - `MemoryPurgeLowPriorityStandbyList = 5`
- **`ListProcesses()`:** PID, nombre y ruta vía `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageName`, ignorando los procesos protegidos.
- **`SetPriority(pid, "High"|"AboveNormal"|"Normal")`.** Nunca Realtime.
- **`GetForegroundPid()`**, para confirmar que el juego está en primer plano.

### 3.3 `hardware.ps1` → JSON `HardwareProfile`

| Componente | Qué leer |
|---|---|
| **CPU** | `Win32_Processor`: nombre, fabricante, núcleos, hilos, MaxClockSpeed. Deduce la generación y la arquitectura: Intel (gen, P/E-cores) o AMD Zen (serie, X3D). |
| **GPU** | `Win32_VideoController`: nombre, driver y fecha, resolución y Hz actuales. La VRAM real sale del registro `HardwareInformation.qwMemorySize`, porque `AdapterRAM` no sirve con más de 4 GB. |
| **RAM** | `Win32_PhysicalMemory`: capacidad por módulo, `Speed` contra `ConfiguredClockSpeed` (para detectar XMP/EXPO apagado), PartNumber y número de slots ocupados (posible single channel). |
| **Placa y BIOS** | `Win32_BaseBoard` y `Win32_BIOS` (versión y fecha). |
| **Discos** | `Get-PhysicalDisk`: MediaType y BusType (NVMe/SSD/HDD), tamaño. |
| **Sistema** | Versión y build de Windows, laptop o escritorio (`Win32_SystemEnclosure.ChassisTypes` + batería), plan de energía activo (`powercfg /getactivescheme`), estado de Resizable BAR si se puede leer. |
| **Monitores** | `WmiMonitorID` + Hz. |

---

## 4. MÓDULOS FUNCIONALES

### 4.1 Detección de hardware
- Corre al iniciar, **sincronizada con el loader**: el contador 0→100 refleja el progreso real del escaneo.
- Detecta **problemas** con reglas locales, sin IA. Cada uno lleva severidad:
  - RAM por debajo de su velocidad nominal → "Activa XMP/EXPO";
  - un solo módulo → single channel;
  - driver de GPU con más de 6 meses;
  - plan de energía Equilibrado en un escritorio;
  - Hz del monitor por debajo del máximo soportado;
  - poco espacio libre en el disco del sistema.

### 4.2 Liberador de RAM
- **Acciones:**
  - Limpiar standby (recomendada);
  - Limpiar standby de baja prioridad;
  - Vaciar working sets (con aviso: "puede causar micro-cargas al volver a apps abiertas");
  - Vaciar la lista Modified.
- **Indicador en vivo** cada 1 s, que solo corre mientras la pantalla es visible: Usada / Standby / Libre / Modified, más el historial de los últimos 60 s.
- **Limpieza automática** al estilo ISLC: si `standby ≥ X MB` **y** `libre < Y MB`, purga la standby. Tiene intervalo mínimo entre limpiezas y registro de eventos.
  - Los valores por defecto dependen de la RAM total: con 16 GB, X = 1024 e Y = 2048.
  - La IA puede sugerir otros umbrales.
- Muestra "**+N MB liberados**" después de cada limpieza, con su animación (sección 6).

### 4.3 Catálogo de ajustes seguros (lista blanca)
Cada ajuste es un objeto declarativo con:
- `id`, `titulo`, `descripcion`, `categoria` (energia | gpu | cpu | entrada | red | visual | memoria);
- `riesgo` (bajo | medio), `requiereReinicio`, `soloEscritorio`;
- `condiciones(hw)`: devuelve si aplica y por qué no, si no aplica;
- `leer()`, `aplicar()`, `revertir()`.

Los ajustes de registro se definen como operaciones `{hive, path, name, type, value}` y se aplican **en lote** con un solo script (`tweaks.ps1`), que devuelve los valores anteriores para el respaldo.

| ID | Qué hace | Detalles |
|---|---|---|
| `power_ultimate` | Duplica y activa el plan Máximo rendimiento (`e9a42b02-d5df-448d-aa00-03f14749eb61`), o Alto rendimiento si no se puede. Desactiva la suspensión selectiva de USB en ese plan. | Respalda el GUID anterior. En laptop muestra una advertencia por batería y temperatura. |
| `game_mode_on` | `HKCU\Software\Microsoft\GameBar` → `AutoGameModeEnabled=1`, `AllowAutoGameMode=1`. | |
| `game_dvr_off` | `HKCU\System\GameConfigStore` → `GameDVR_Enabled=0`; `HKCU\...\GameDVR` → `AppCaptureEnabled=0`. | |
| `hags_on` | `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers` → `HwSchMode=2`. | Solo con GPU compatible (NVIDIA GTX 10xx o superior, AMD RX 5000 o superior, Intel Arc). Requiere reinicio. |
| `mmcss_games` | `...\Multimedia\SystemProfile` → `SystemResponsiveness=10`. En `Tasks\Games`: `GPU Priority=8`, `Priority=6`, `Scheduling Category=High`, `SFIO Priority=High`. | |
| `win32_priority_sep` | `HKLM\...\PriorityControl` → `Win32PrioritySeparation=0x26`. | |
| `windowed_optimizations` | Win11: en `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` → `DirectXUserGlobalSettings`, añade `SwapEffectUpgradeEnable=1;`. | Combina con el valor existente; no lo pises. |
| `mouse_accel_off` | `HKCU\Control Panel\Mouse` → `MouseSpeed=0`, `MouseThreshold1=0`, `MouseThreshold2=0`. | Aplícalo en vivo con `SystemParametersInfo(SPI_SETMOUSE)`. |
| `transparency_off` | `HKCU\...\Themes\Personalize` → `EnableTransparency=0`. | |
| `power_throttling_off` | `HKLM\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling` → `PowerThrottlingOff=1`. | Solo escritorio. |
| `network_throttling_off` | `NetworkThrottlingIndex=0xFFFFFFFF`. | Riesgo medio: su efecto se discute. |
| `nagle_off` | `TcpAckFrequency=1`, `TCPNoDelay=1` en la interfaz de red activa (por GUID). | Riesgo medio. Solo ayuda en algunos juegos. |
| `memory_compression_off` | `Disable-MMAgent -MemoryCompression`; se revierte con `Enable-MMAgent`. | Solo con 32 GB o más. |

**Interfaz del catálogo:**
- cada ajuste muestra su estado real (Activo / Inactivo / No aplica, con el motivo) y si la IA lo recomienda (badge lima + motivo);
- se puede aplicar por selección, **Aplicar recomendados** o **Revertir todo**.

### 4.4 Análisis con IA (`ai.ts`)
Usa `@anthropic-ai/sdk` desde el proceso principal; nunca en el renderer.

**Paso 1 · Investigación**
```ts
const stream = client.beta.messages.stream({
  model: 'claude-opus-5-5',
  max_tokens: 64000,
  thinking: { type: 'adaptive' },
  output_config: { effort: 'high' },
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }],
  system: SYSTEM_PROMPT,   // estable → cacheable
  messages: [{ role: 'user', content: JSON.stringify({ hardware, estadoAjustes, catalogo }) }],
})
```
- Escucha `contentBlock`: cada bloque `server_tool_use` envía un evento de progreso al renderer con la consulta que se está buscando (`"Buscando: RTX 4070 HAGS reddit"`).
- Si `stop_reason === 'pause_turn'`, añade el turno del asistente y vuelve a enviar sin un mensaje nuevo del usuario.
- Si `stop_reason === 'refusal'`, muestra un error amable.
- Las fuentes se sacan de los bloques `web_search_tool_result` (url y título), sin depender del texto del modelo.

**Paso 2 · Estructurar**
`client.messages.parse` con `output_config.format: zodOutputFormat(RecomendacionSchema)` y `effort: 'low'`. Toma el informe del paso 1 y lo convierte en:
```ts
{
  resumen: string,
  perfil: 'entrada' | 'media' | 'alta' | 'entusiasta',
  ajustes: { id: CatalogId, aplicar: boolean, motivo: string }[],   // z.enum de IDs del catálogo
  manuales: { titulo, detalle, categoria: 'bios'|'drivers'|'panel_gpu'|'juego'|'hardware'|'windows', impacto: 'alto'|'medio'|'bajo' }[],
  ram: { autoLimpieza: boolean, umbralStandbyMB: number, umbralLibreMB: number },
  advertencias: string[]
}
```
Descarta en código cualquier ID que no exista en el catálogo.

**System prompt (resumen):**
- Eres un experto en tuning de PC para gaming. Investiga en foros reales cuál es la configuración óptima para el hardware exacto que recibes.
- Prioriza el consenso y las pruebas medibles sobre los mitos.
- **Solo** puedes recomendar IDs del catálogo dado.
- Todo lo demás (XMP/EXPO, ReBAR, drivers limpios con DDU, NVIDIA Reflex o Anti-Lag, límite de FPS, G-Sync o FreeSync, ajustes del panel de la GPU, plan de BIOS) va en `manuales`.
- Nunca sugieras deshabilitar servicios, Defender, VBS o mitigaciones.
- Responde en español.

**Además:**
- Caché del último análisis en disco, con su fecha.
- Botón "Re-analizar".
- Coste estimado visible: "≈ $0.10–0.40 por análisis".

### 4.5 Modo Juego automático (`gamemode.ts`)
- **Sondeo** cada 3 s con `ListProcesses()` del worker. Es un juego si:
  - su ruta contiene `\steamapps\common\`, `\Epic Games\`, `\Riot Games\`, `\XboxGames\`, `\GOG Galaxy\Games\`, `\EA Games\` o `\Ubisoft Game Launcher\games\`;
  - o está en la lista de juegos conocidos (cs2, valorant, fortnite, r5apex, overwatch, cod, etc.);
  - o el usuario lo agregó a mano.
- **Exclusiones:** launchers, crash handlers, anti-cheats (`EasyAntiCheat`, `BEService`, `vgc`), `UnityCrashHandler*` y `*Setup*`.
- **Al detectar un juego:**
  1. prioridad `High`;
  2. purga de standby;
  3. cambio al plan Máximo rendimiento si no está activo;
  4. limpieza automática en modo agresivo;
  5. **pausa toda la escena three.js** y las animaciones de la app.
- **Al cerrarlo:** se restaura todo a como estaba.
- Opcional: notificación nativa discreta. Registro de sesiones: juego, duración y RAM liberada.
- La app vive en la bandeja del sistema y el Modo Juego sigue funcionando con la ventana cerrada.

### 4.6 Ajustes y persistencia
- `store.ts`: JSON en `app.getPath('userData')`.
- Opciones:
  - API key (cifrada) con un botón "Probar conexión";
  - efectos 3D (Auto / Siempre / Nunca);
  - iniciar con Windows;
  - umbrales de RAM;
  - lista de juegos personalizados;
  - exportar el respaldo.

---

## 5. PANTALLAS

Navegación con una **barra en forma de pastilla centrada arriba**, como el shot: Panel · Optimizar · Memoria · Análisis IA · Modo Juego, con Ajustes a la derecha.

1. **Loader:** pantalla negra con la marca mínima `O.` y un asterisco/destello. El contador grande va abajo a la derecha, en serif itálica, de 0 a 100 al ritmo del escaneo real. Arriba a la izquierda, una línea de estado en mono pequeño ("detectando GPU…").
2. **Panel** (oscuro, inmersivo):
   - **Hero:** titular gigante en mayúsculas mezclado con serif itálica, al estilo `DETECTA /ajusta/ JUEGA`. Detrás, el **núcleo 3D** de three.js (sección 6.4).
   - Debajo, una línea de "chips" con el hardware (CPU · GPU · RAM · Hz).
   - Un cluster tipo "Trusted by 10,000+" convertido en el **Optikax Score** (0–100) del sistema.
   - **Tres tarjetas numeradas** `01 Escanear · 02 Analizar · 03 Aplicar`, de vidrio translúcido sobre la ola de partículas, con el estado de cada paso y su CTA.
   - Bloque de problemas detectados.
3. **Optimizar** (sección **clara editorial**, contraste narrativo):
   - titular serif "Ajustes pensados para *tu* hardware";
   - grid de tarjetas tipo producto, con el ícono o la ilustración monocromática del ajuste y un badge lima `+` arriba a la derecha para seleccionarlo;
   - al pasar el mouse, el cursor se convierte en un círculo lima que dice "Ver" o "Aplicar";
   - barra de acción inferior fija con el número de ajustes seleccionados.
4. **Memoria** (oscuro):
   - número gigante tabular con la RAM libre;
   - barras segmentadas Usada / Standby / Libre;
   - gráfico de 60 s;
   - botones de purga;
   - controles de limpieza automática;
   - registro de eventos.
5. **Análisis IA:**
   - **Durante el análisis:** feed en vivo de las búsquedas y una animación de escaneo 3D.
   - **Con resultados:** carrusel horizontal tipo "Meet your perfect speaker", con una línea de progreso abajo, un contador `01/08` y flechas en pastilla. Cada slide es una recomendación con impacto, motivo y fuentes.
   - Abajo, la lista de recomendaciones manuales y las fuentes enlazadas.
6. **Modo Juego:**
   - interruptor grande;
   - el juego detectado en vivo;
   - acciones activas;
   - historial;
   - juegos personalizados.
7. **Ajustes.**

---

## 6. SISTEMA DE DISEÑO — basado en el shot "Brody" (Dribbble / Korsa)

### 6.1 Análisis de la referencia

| Qué tiene el shot | Cómo lo usa Optikax |
|---|---|
| **Loader con contador** 0→100 sobre negro, logotipo mínimo centrado y número en serif itálica abajo a la derecha | Splash de arranque ligado al escaneo real de hardware |
| **Hero** con tipografía gigante condensada en mayúsculas cortada por una palabra en serif itálica (`DISCOVER /Shop/ DOWNLOAD`) sobre un producto monocromático | `DETECTA /ajusta/ JUEGA` sobre el núcleo 3D monocromático |
| **Nav en pastilla** centrada y botones pequeños redondeados (pastilla oscura con texto claro) | Navegación principal y CTAs |
| **Fotografía en blanco y negro** con un único acento **lima** | Escenas 3D en grises; el lima solo marca acción o estado |
| **Ritmo oscuro → claro editorial** (sección blanca "Thoughtfully crafted…") | Panel y Memoria oscuros, Optimizar claro |
| **Cards de producto** sobre gris muy claro con badge lima `+` | Tarjetas de ajustes |
| **Cursor "View"** lima que sigue el puntero sobre las tarjetas | Cursor contextual "Ver" / "Aplicar" |
| **Carrusel** con línea de progreso, contador y flechas | Recomendaciones de la IA |
| **3 pasos numerados 01/02/03** en tarjetas translúcidas sobre una **ola de partículas** | Flujo Escanear / Analizar / Aplicar sobre la ola en three.js |
| **Prueba social** "98% satisfaction" | Métricas grandes: Score, MB liberados, sesiones optimizadas |
| Fila de features con íconos finos separados por divisores | Fila de garantías: "Sin tocar servicios · Reversible · Punto de restauración · Offline + IA opcional" |

### 6.2 Tokens
```css
:root {
  /* paleta del shot */
  --ink:        #010101;  /* fondo principal */
  --graphite:   #3F3D40;  /* superficies elevadas / bordes fuertes */
  --smoke:      #7E7682;  /* texto secundario sobre oscuro */
  --mist:       #B6B5C9;  /* texto terciario, iconografía */
  --paper:      #F4F4F6;  /* secciones claras / texto principal sobre oscuro */
  --lime:       #D8F33A;  /* ÚNICO acento: acción, estado activo, cursor */
  --lime-ink:   #0A0D05;  /* texto encima del lima */

  --surface-1:  #0E0E0F;
  --surface-2:  #161517;
  --hairline:   rgba(255,255,255,0.08);
  --glass:      rgba(22,21,23,0.55);  /* + backdrop-filter: blur(18px) */

  --ok:   #8BE38B;  --warn: #F2C14E;  --danger: #FF6B5E; /* solo para estados */

  --ease-snap: cubic-bezier(0.16, 1, 0.3, 1);
  --r-xl: 24px; --r-lg: 20px; --r-md: 12px; --r-pill: 999px;
}
```

### 6.3 Reglas de estilo (skills `taste-skill`, `impeccable` y `emil-kowalski`)
- **Dos familias:**
  - *Inter Tight* (variable) para la interfaz y los titulares en mayúsculas;
  - *Instrument Serif Italic* solo para las palabras de acento y los números del loader.
  - Ninguna otra fuente.
- **Escala tipográfica:**
  - hero `clamp(3rem, 7vw, 7.5rem)` con `letter-spacing: -0.04em` y `line-height: 0.9`;
  - h2 `clamp(1.75rem, 3vw, 2.5rem)`;
  - cuerpo de 15–16 px con `line-height: 1.6`;
  - etiquetas de 12 px en mayúsculas con `letter-spacing: 0.08em`.
- **Todos los números** (RAM, Score, contador, MB) con `font-variant-numeric: tabular-nums`.
- **Espaciado en múltiplos de 8** (4 para micro-espacios). Nada de valores arbitrarios.
- **Un solo protagonista por pantalla.** Lima solo en: el CTA principal, el estado activo, el cursor y los badges de "recomendado". **Cero gradientes morados**, cero RGB gamer y cero tarjetas idénticas sin jerarquía.
- **Radios concéntricos:** `interior = exterior − padding`.
- **Bordes y sombras:**
  - bordes translúcidos `1px solid var(--hairline)`;
  - sombras en dos capas: contacto + ambiente.
- **Movimiento:**
  - solo `transform` y `opacity`, con la curva `--ease-snap`, entre 150 y 400 ms;
  - `:active { transform: scale(.975) }` en todo lo que se pueda pulsar;
  - transiciones de página con fade + 8 px de desplazamiento;
  - stagger de 40 ms en las listas.
- **Detalles:**
  - `::selection` en lima;
  - scrollbar fino;
  - `:focus-visible` con un outline lima de 2 px;
  - separadores con degradado de desvanecimiento en lugar de `<hr>`.
- **Accesibilidad:** contraste WCAG AA (4.5:1) y texto `--lime-ink` encima del lima.
- **`prefers-reduced-motion`:** desactiva el 3D y reduce las animaciones a fades.

### 6.4 three.js (React Three Fiber + drei)
- **Núcleo del Panel:**
  - esfera o toro de unas 6–12 k partículas en grises, con un leve brillo lima en la zona "activa";
  - shader sencillo con ruido;
  - **reacciona en vivo**: el uso de RAM cambia la densidad o el radio, la carga de CPU la velocidad de rotación y el Modo Juego activo la pone en reposo.
- **Ola de partículas** (como el fondo de los pasos 01/02/03): plano de puntos con desplazamiento senoidal y paralaje suave con el mouse.
- **Animación de purga:** al liberar RAM, las partículas se dispersan y se re-condensan; aparece el contador "+N MB".
- **Escaneo IA:** un anillo de barrido tipo radar mientras se buscan fuentes.
- **Rendimiento (obligatorio):**
  - `frameloop="demand"` y se invalida solo cuando cambian los datos o hay animación activa;
  - máximo 60 fps;
  - `dpr={[1, 1.5]}`;
  - sin sombras;
  - geometrías instanciadas o `Points`;
  - se **pausa por completo** cuando la ventana está minimizada, oculta o sin foco y cuando hay un juego activo;
  - el 3D se carga con lazy import en su propio chunk;
  - el ajuste "Efectos 3D: Nunca" lo reemplaza por una imagen estática.

### 6.5 Herramientas de diseño
- Antes de escribir la interfaz, carga y sigue las skills **taste-skill**, **impeccable**, **emil-kowalski** y **emil-design-eng**.
- Prototipa las pantallas clave (Loader, Panel, Optimizar, Análisis IA) con **Claude Design** (artifact de tipo Design) y valídalas antes de pasarlas a React.
- Al terminar, usa `design:design-critique` y `design:accessibility-review`.

---

## 7. FASES DE CONSTRUCCIÓN (verifica cada una)

1. **Base:** electron-vite, la ventana con su barra de título, el preload tipado, el store y los tokens CSS y las fuentes. *Verificar:* `npm run dev` abre la ventana.
2. **Capa de sistema:** `ps.ts`, el worker y `OptikaxNative`. *Verificar:* `memStats` devuelve datos reales y `ListProcesses` lista procesos.
3. **Hardware:** `hardware.ps1` y las reglas de problemas. *Verificar* con el hardware de esta PC.
4. **RAM:** las purgas y la limpieza automática. *Verificar* que el standby baja después de purgar.
5. **Ajustes:** el catálogo, el respaldo, el punto de restauración y la reversión. *Verificar* el ciclo aplicar → leer → revertir en **cada** ajuste, comprobando el registro antes y después.
6. **IA:** la investigación, la estructuración y la persistencia. *Verificar* con una API key real; si no la hay, prueba el paso 2 con un informe simulado.
7. **Modo Juego:** detección, acciones y restauración. *Verificar* lanzando un exe de prueba dentro de una carpeta `steamapps\common\Test\`.
8. **Interfaz completa** (diseño de la sección 6) y **three.js**. *Verificar* las capturas de cada pantalla y que el 3D se pausa al minimizar (uso de GPU cerca de 0%).
9. **Empaquetado:** `npm run dist` genera un instalador NSIS que pide permisos de administrador.
10. **Revisión final:** `npm run typecheck`, `/code-review`, critique de diseño y auditoría de accesibilidad.

## 8. CRITERIOS DE TERMINADO
- [x] No hay ninguna llamada que modifique servicios o seguridad (búsqueda en el repo: `Set-Service|sc config|Stop-Service|bcdedit|DisableAntiSpyware` → 0 resultados).
  *Evidencia (14/11/2026):* `git grep` en `src`, `resources` y `scripts` devuelve 0 resultados.
- [x] Todos los ajustes del catálogo hacen el ciclo aplicar/revertir y dejan el registro idéntico al original.
  *Evidencia:* `npm run verify:tweaks` → `TODO OK` en los 13 ajustes y 9 casos borde, comparando fotos del registro valor por valor. Ver `docs/VERIFICACION_AJUSTES.md`.
- [x] La purga de standby funciona y muestra los MB liberados reales.
  *Evidencia:* `npm run verify:game` registra las purgas reales con sus bytes (por ejemplo, 1,1 GB y 7 GB). La pantalla Memoria muestra "+N MB" con el valor medido antes y después.
- ~~El análisis IA cita fuentes reales y solo recomienda IDs del catálogo.~~
  *Retirado el 14/11/2026 por decisión del usuario:* se quitó todo el análisis con IA (Claude y Gemini) y Optikax es 100 % offline. Las recomendaciones salen de las reglas locales: ajustes de riesgo bajo que aplican al equipo.
- [x] El Modo Juego detecta, optimiza y restaura.
  *Evidencia:* `npm run verify:game` 24/24, con un exe falso en `steamapps\common\Test`. Además detectó de verdad Call of Duty MW II y The Farmer Was Replaced.
- [x] El 3D no consume GPU con la ventana oculta ni durante un juego.
  *Evidencia:* `npm run capture`, con la ventana minimizada: 0–1 % de GPU, que es la línea base de Electron. Con un juego abierto la escena se desactiva por la misma regla (`active = visible && !juego`), pero no se midió la GPU en ese estado.
- [x] La interfaz sigue la sección 6: paleta, dos fuentes, lima como único acento y ritmo oscuro/claro.
  *Evidencia:* capturas en `docs/capturas/` y crítica de diseño en `docs/REVISION_FINAL.md`.
- [ ] El instalador `.exe` funciona en una sesión limpia.
  *Parcial:* `dist\Optikax Setup 0.1.0.exe` se genera y la app empaquetada (`win-unpacked`) arranca, encuentra sus scripts y funciona. **Falta instalarlo en una sesión limpia.**
