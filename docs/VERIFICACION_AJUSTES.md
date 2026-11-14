# Verificación del ciclo aplicar → leer → revertir

Generado por `npm run verify:tweaks` el 13/11/2026, 21:27:00.

**Equipo:** Intel(R) Core(TM) i7-9700F CPU @ 3.00GHz · NVIDIA GeForce RTX 4060 · 16 GB RAM · Windows build 26200 · escritorio

**Método:**
- El motor real de la app (`applyTweaks` / `revertTweaks`) aplica y revierte cada ajuste, con un `backup.json` temporal.
- `scripts/verify-tweaks.ps1` toma una foto del sistema antes y después, leyendo el registro por su cuenta: todos los valores de cada clave tocada, el plan de energía activo y la lista de planes, la compresión de memoria y la configuración del mouse en vivo.
- **Idéntico** significa que la foto tras revertir coincide valor por valor (tipo, dato y existencia) con la foto de partida.
- Si un ajuste ya estaba activo, se borran temporalmente sus valores (estado de fábrica de Windows) para poder ejercitar el ciclo, y al final se restaura el valor original del equipo.

## Por ajuste

| ID | Aplica | Lee activo | Revierte | Idéntico | Modo | Notas |
|---|---|---|---|---|---|---|
| `power_ultimate` | sí | sí | sí | sí | motor | — |
| `game_mode_on` | sí | sí | sí | sí | motor (estado de fábrica simulado) | — |
| `game_dvr_off` | sí | sí | sí | sí | motor (estado de fábrica simulado) | — |
| `hags_on` | sí | sí | sí | sí | motor | — |
| `mmcss_games` | sí | sí | sí | sí | motor | — |
| `win32_priority_sep` | sí | sí | sí | sí | motor (estado de fábrica simulado) | — |
| `windowed_optimizations` | sí | sí | sí | sí | motor | — |
| `mouse_accel_off` | sí | sí | sí | sí | motor (estado de fábrica simulado) | — |
| `transparency_off` | sí | sí | sí | sí | motor (estado de fábrica simulado) | — |
| `power_throttling_off` | sí | sí | sí | sí | motor (estado de fábrica simulado) | — |
| `network_throttling_off` | sí | sí | sí | sí | motor | — |
| `nagle_off` | sí | sí | sí | sí | motor | — |
| `memory_compression_off` | sí | sí | sí | sí | directo (compresión activada temporalmente) | No aplica aquí: Solo conviene con 32 GB de RAM o más; con menos, la compresión ayuda. |

## Casos borde

| Caso | Resultado | Detalle |
|---|---|---|
| windowed_optimizations con valor previo (no existe) | OK | aplicado: "SwapEffectUpgradeEnable=1;"<br>revertido: (no existe) |
| windowed_optimizations con valor previo "" | OK | aplicado: "SwapEffectUpgradeEnable=1;"<br>revertido: "" |
| windowed_optimizations con valor previo "VRROptimizeEnable=0;" | OK | aplicado: "VRROptimizeEnable=0;SwapEffectUpgradeEnable=1;"<br>revertido: "VRROptimizeEnable=0;" |
| windowed_optimizations con valor previo "SwapEffectUpgradeEnable=0;VRROptimizeEnable=1;" | OK | aplicado: "VRROptimizeEnable=1;SwapEffectUpgradeEnable=1;"<br>revertido: "SwapEffectUpgradeEnable=0;VRROptimizeEnable=1;" |
| power_ultimate: 3 ciclos seguidos sin planes huérfanos | OK | ciclo 1: activo e9a42b02-d5df-448d-aa00-03f14749eb61, planes nuevos 0<br>ciclo 2: activo e9a42b02-d5df-448d-aa00-03f14749eb61, planes nuevos 0<br>ciclo 3: activo e9a42b02-d5df-448d-aa00-03f14749eb61, planes nuevos 0<br>tras 3 ciclos: plan activo y lista de planes idénticos al original |
| backup.json no se sobrescribe en un segundo aplicar | OK | el segundo aplicar conservó el respaldo original<br>al revertir: (no existe) (original (no existe)) |
| Revertir todo con todos los ajustes aplicados a la vez | OK | aplicados juntos: 12/12<br>Revertir todo: 12 revertidos, respaldos pendientes 0 |
| nagle_off solo toca la interfaz activa | OK | interfaz activa: Ethernet {be37cf80-a86a-47d2-b75f-b0024e484734}<br>HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{be37cf80-a86a-47d2-b75f-b0024e484734}\TcpAckFrequency: (no existe) → DWord:1<br>HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{be37cf80-a86a-47d2-b75f-b0024e484734}\TCPNoDelay: (no existe) → DWord:1 |
| Punto de restauración (camino "ya hay uno reciente") | OK | estado: reciente<br>último: #1 "Installed DirectX" 2026-11-13T18:45:20.3361140<br>Con Protección del sistema apagada no se ejecutó: habría que apagarla, y eso es un ajuste de seguridad. Revisado en código: Checkpoint-Computer lanza, el script devuelve "no_disponible" y applyTweaks sigue. |

## Qué cambia cada ajuste

**`power_ultimate`**

- Plan activo: 01001011-0100-1111-0101-001188888883 → e9a42b02-d5df-448d-aa00-03f14749eb61

**`game_mode_on`**

- HKCU\Software\Microsoft\GameBar\AllowAutoGameMode: DWord:0 → DWord:1
- HKCU\Software\Microsoft\GameBar\AutoGameModeEnabled: DWord:0 → DWord:1

**`game_dvr_off`**

- HKCU\System\GameConfigStore\GameDVR_Enabled: (no existe) → DWord:0
- HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR\AppCaptureEnabled: (no existe) → DWord:0

**`hags_on`**

- HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\HwSchMode: (no existe) → DWord:2

**`mmcss_games`**

- HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\SystemResponsiveness: DWord:20 → DWord:10
- HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games\Priority: DWord:2 → DWord:6
- HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games\Scheduling Category: String:Medium → String:High
- HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games\SFIO Priority: String:Normal → String:High

**`win32_priority_sep`**

- HKLM\SYSTEM\CurrentControlSet\Control\PriorityControl\Win32PrioritySeparation: (no existe) → DWord:38

**`windowed_optimizations`**

- HKCU\Software\Microsoft\DirectX\UserGpuPreferences: clave no existía → existe
- HKCU\Software\Microsoft\DirectX\UserGpuPreferences\DirectXUserGlobalSettings: (no existe) → String:SwapEffectUpgradeEnable=1;

**`mouse_accel_off`**

- HKCU\Control Panel\Mouse\MouseSpeed: (no existe) → String:0
- HKCU\Control Panel\Mouse\MouseThreshold1: (no existe) → String:0
- HKCU\Control Panel\Mouse\MouseThreshold2: (no existe) → String:0
- Mouse en vivo (umbral1,umbral2,acel): 6,10,1 → 0,0,0

**`transparency_off`**

- HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\EnableTransparency: (no existe) → DWord:0

**`power_throttling_off`**

- HKLM\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling\PowerThrottlingOff: (no existe) → DWord:1

**`network_throttling_off`**

- HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\NetworkThrottlingIndex: DWord:10 → DWord:4294967295

**`nagle_off`**

- HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{be37cf80-a86a-47d2-b75f-b0024e484734}\TcpAckFrequency: (no existe) → DWord:1
- HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{be37cf80-a86a-47d2-b75f-b0024e484734}\TCPNoDelay: (no existe) → DWord:1

**`memory_compression_off`**

- Compresión de memoria: true → false
