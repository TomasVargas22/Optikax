# Decisiones y hallazgos

Registro de decisiones tomadas durante el desarrollo y de lo que se descubrió al verificar. Lo más reciente va arriba.

---

## 2026-11-14 · Fase F: interfaz completa y three.js

### Dependencias
- `three@0.187.0`, `@react-three/fiber@9.8.2` (compatible con React 19.3) y `motion@14.14.0`.
- **No se instaló `@react-three/drei`:** las escenas son dos `Points` con shaders propios y no usan nada de drei. Sería una dependencia sin uso.

### Pantallas
- **Loader:** el contador 0→100 sigue el progreso real de `hardware.ps1`, con la línea de estado arriba a la izquierda y la marca `O.` con su destello.
- **Panel:**
  - hero `DETECTA /ajusta/ JUEGA` con el núcleo 3D;
  - chips de hardware y Optikax Score: 60 % salud del hardware (problemas detectados) y 40 % ajustes de riesgo bajo aplicados;
  - tres pasos de vidrio sobre la ola, problemas detectados y fila de garantías.
- **Optimizar** (claro editorial):
  - tarjetas tipo producto con ícono de línea por categoría y badge lima `+`;
  - toda la tarjeta es seleccionable;
  - cursor lima "Aplicar / Quitar / Ver" con muelle (`useSpring` de motion);
  - barra de acción fija abajo.
- **Análisis IA:** carrusel con línea de progreso, contador `01/06` y flechas en pastilla (también con las teclas ← →), anillo de barrido tipo radar y feed de búsquedas en vivo.
- **Modo Juego:** interruptor grande y aviso de optimizadores en conflicto.
- **Ajustes:**
  - API key;
  - Efectos 3D (Auto / Siempre / Nunca);
  - Iniciar con Windows;
  - accesos a los umbrales de memoria y a los juegos personalizados;
  - Exportar respaldo.

### 3D y rendimiento
- `frameloop="demand"`. Mientras la escena está activa, un temporizador pide fotogramas a 30 fps; si no, cero fotogramas.
- Activa = ventana visible y con foco, sin juego abierto y efectos permitidos.
- `dpr` de 1 a 1,5, sin antialias ni sombras, una geometría `Points` por escena.
- Chunk aparte con carga diferida (`Scenes-*.js`).
- Si WebGL falla, o con "Nunca", o con "Auto" y movimiento reducido, se muestran imágenes de puntos fijas.
- **Este equipo tiene el movimiento reducido activado** (animaciones de Windows apagadas). Con "Auto" verás las imágenes fijas: es lo que pide el diseño. Para ver el 3D, elige "Siempre".
- El núcleo crece con el uso de RAM y se dispersa y se vuelve a juntar con cada purga. **No reacciona a la carga de CPU:** la app no mide la CPU todavía.
- El radar del análisis es CSS, no three.js: es más barato y se detiene con la misma regla que el resto de animaciones.

### Inicio con Windows
Optikax pide administrador, y Windows no arranca solas las apps elevadas que están en la clave `Run`. Por eso se usa una tarea programada (`schtasks /SC ONLOGON /RL HIGHEST`) que lanza la app con `--hidden`, para que arranque en la bandeja. Solo funciona en la app instalada.

### Verificación (`npm run capture`)
- Capturas de cada pantalla en `docs/capturas/`, hechas en una carpeta de datos temporal con Efectos 3D en "Siempre" y un análisis de ejemplo.
- **GPU** (contadores `GPU Engine` de los procesos de Electron, 8 s por medición, tres pasadas):
  - con el Panel y los dos 3D activos: 0–2,1 %;
  - minimizada: 0–0,65 %.

  Las mediciones varían y todas están cerca de cero.
- Fallo encontrado y corregido: con un juego abierto, la regla que pausaba las animaciones dejaba las de entrada congeladas en opacidad 0, y la pantalla salía en negro al navegar. Ahora saltan a su estado final.
- Durante las capturas, el Modo Juego detectó de verdad *The Farmer Was Replaced*. La prioridad ya era Alta (KRNLGame) y el plan no se tocó.
- **Sin verificar:** el cursor lima en movimiento y la animación de dispersión al purgar. Son interacciones; las capturas no las recogen.

---

## 2026-11-14 · Fase E: Modo Juego y bandeja

### Diseño
- `game-detect.ts` (puro):
  - juego = carpeta de una tienda (Steam, Epic, Riot, Xbox, GOG, EA, Ubisoft), lista de juegos conocidos o agregado a mano;
  - se excluyen launchers, crash handlers, anti-cheats, instaladores, `bootstrapper.exe` y apps de Steam que no son juegos (Wallpaper Engine, SteamVR, Steamworks Shared);
  - con varios juegos abiertos gana el de primer plano.
- `gamemode.ts`: sondeo cada 3 s. Al detectar un juego:
  - prioridad Alta, nunca Realtime, y solo si estaba en Normal o por debajo;
  - purga de la standby;
  - plan Máximo rendimiento;
  - limpieza agresiva (mitad del umbral de standby, cada 15 s) aunque la automática esté apagada;
  - notificación silenciosa;
  - la interfaz pausa animaciones y sondeos.
- **El plan de energía solo se cambia si el activo es Equilibrado o Economizador.** Un plan propio (como el "Ultimate Performance" de KernelOS de este equipo) se respeta, porque no hay forma fiable de saber qué hace.
- **Restauración:** el estado se guarda en `gamemode-pending.json` ANTES de cada cambio. Al cerrar el juego se vuelve al plan anterior, salvo que otro programa lo haya cambiado mientras tanto; en ese caso se deja y se anota en la sesión. Si la app se cierra de golpe, se restaura al volver a abrirla. Al salir con un juego abierto, se restaura antes de cerrar.
- Avisa de optimizadores en conflicto (KRNLGame, Process Lasso, ISLC, Razer Cortex, Wise Game Booster, Game Fire, Hone), sin tocarlos.
- Bandeja: cerrar la ventana la oculta y el Modo Juego sigue funcionando. El menú tiene Abrir, Modo Juego (casilla) y Salir.
- Las operaciones de energía tienen ahora un límite de 30 s (antes 10): una llamada a `powercfg` llegó a tardar más de 10 s.
- El escaneo de hardware tiene un límite de 120 s y un reintento: resuelve el hallazgo de la Fase D.

### Verificación (`npm run verify:game`)
- **24/24 OK:**
  - detección con casos fijos y sin falsos positivos en los 147 procesos del equipo;
  - de punta a punta con `ping.exe` copiado como `steamapps\common\Test\TestGame.exe`: prioridad Alta, plan Máximo rendimiento, purga de 1,1 GB, aviso al renderer, restauración del plan al cerrar, sesión registrada;
  - recuperación tras un cierre inesperado.
- La prueba pone "Equilibrado" para ejercitar el cambio de plan y al final deja el plan original.
- **Incidente en la primera pasada:** Call of Duty MW II estaba abierto. El Modo Juego lo detectó de verdad, le subió la prioridad y cambió el plan mientras la prueba esperaba. El plan se restauró al final, y COD se cerró poco después, así que no quedó nada cambiado. Desde entonces la prueba de punta a punta se salta si hay un juego real abierto.
- Comprobado en la app real: al cerrar la ventana, la app sigue en la bandeja.
- **Sin verificar a la vista:** el menú de la bandeja, la notificación y la pantalla Modo Juego.

---

## 2026-11-14 · Fase D: análisis con IA

### API validada (skill `claude-api`, SDK `@anthropic-ai/sdk` 1.8.0 instalado)
Todo lo que pide la sección 4.4 del prompt existe tal cual, sin cambios de nombre:
- modelo `claude-opus-5-5`;
- `thinking: { type: 'adaptive' }`. En Opus 5.5 no se puede desactivar y su esfuerzo por defecto es `medium`, así que se fija `effort: 'high'` en la investigación y `low` en la estructuración;
- `betas: ['server-side-fallback-2026-07-01']` con `fallbacks: 'default'`: si el modelo declina por política, la API reintenta en otro modelo dentro de la misma llamada;
- herramienta `web_search_20260209` (`max_uses: 12`), y `pause_turn` resuelto reenviando el turno, como máximo 5 veces;
- `client.beta.messages.parse` con `betaZodOutputFormat` (el helper importa `zod/v4`, compatible con zod 4).

**Ajuste respecto al prompt:** el paso 2 usa `beta.messages.parse` + `betaZodOutputFormat` en lugar de `messages.parse` + `zodOutputFormat`, para poder enviar también `fallbacks`, que solo existe en la API beta.

### Diseño
- `src/main/ai.ts`: la clave se lee de `store.ts` solo en el proceso principal y nunca se registra. Los errores de la API se traducen a mensajes en español, sin la clave.
- `src/main/ai-schema.ts`: esquema y posprocesado puros. Descarta IDs fuera del catálogo antes de validar, quita duplicados y ajusta los umbrales de RAM a un rango de 256 MB a la mitad de la RAM.
- Las fuentes salen de los bloques `web_search_tool_result`, no del texto del modelo.
- El análisis se guarda en `userData/analysis.json`, con su fecha y su coste estimado con los precios de Opus 5.5.
- "Probar conexión" usa `models.retrieve`: valida la clave sin generar tokens.
- Optimizar muestra "Recomendado por la IA" con el motivo, y `recommendedTweaks` recibe las recomendaciones del último análisis.

### Verificación
- No hay API key en el equipo. `npm run verify:ai` prueba sin coste:
  - el posprocesado del paso 2 con una salida simulada (`fixtures/`);
  - "Aplicar recomendados" contra el catálogo real;
  - que el esquema genera un `json_schema`;
  - la estimación de coste;
  - el mensaje sin clave y una clave inválida (`AuthenticationError`).
- **Sin verificar:** las llamadas reales de investigación y estructuración (streaming, búsquedas, `pause_turn`, fallbacks). Hace falta una API key real.

### Hallazgo: el escaneo de hardware puede pasar de 60 s
Una vez `hardware.ps1` tardó 108 s, cuando lo normal son 6 s (WMI ocupado de forma puntual). Con el límite de 60 s de `runScript`, el escaneo falla. Conviene subirlo o reintentar; queda pendiente.

---

## 2026-11-14 · Fase B: verificación de ajustes

### Cómo se verifica
- `npm run verify:tweaks` arranca Electron en un modo de verificación, solo en desarrollo (`OPTIKAX_VERIFY=1`, bloqueado si `app.isPackaged`). Corre el motor real (`applyTweaks` / `revertTweaks`) con un `backup.json` temporal en `%TEMP%\optikax-verify`.
- `scripts/verify-tweaks.ps1` toma las fotos del sistema por su cuenta, sin el worker de la app, para que la comparación no dependa del código que se verifica. No se empaqueta: vive fuera de `resources/scripts`.
- El chunk `out/main/verify-*.js` se excluye del instalador en `build.files`.
- `OPTIKAX_VERIFY_ONLY=id1,id2` repite solo algunos ciclos.
- Si un ajuste ya está activo en el equipo, se simula el estado de fábrica de Windows durante la prueba y luego se restaura el valor original. Si el valor de fábrica ya cuenta como activo (el Modo de juego), se escribe el contrario.
- La foto ignora los valores DHCP de las interfaces de red (`Dhcp*`, `Lease*`, `T1`, `T2`), que Windows renueva solo.

### Hallazgo: KernelOS interfiere con los planes de energía
Este equipo usa **KernelOS** (Windows modificado). Trae `C:\Windows\KRNLGame.exe`, que arranca desde `HKLM\...\Run`. Durante las pruebas:
- cambió el plan activo de "Ultimate Performance" (`01001011-…-883`) a "KernelOS Performance V6.1 IDLE ON" (`…884`). Lo confirma el visor de eventos: `UserModePowerService`, evento 12, `powercfg.exe` en un ciclo donde Optikax no cambia planes;
- muy probablemente también escribió `NetworkThrottlingIndex = 0xFFFFFFFF` en otra pasada.

Con `KRNLGame.exe` cerrado durante la prueba, la suite completa pasa (`TODO OK`) y el sistema queda idéntico antes y después. Al terminar se volvió a abrir.

**Consecuencias para el producto:**
- Optikax (plan Máximo rendimiento, Modo Juego) y un agente así se van a pisar.
- **Pendiente para la Fase E:** detectar optimizadores conocidos en ejecución (KRNLGame, Process Lasso, ISLC, etc.) y avisar en el bloque de problemas, sin tocarlos.

### Observación: `power_ultimate` no reconoce un plan "Ultimate" duplicado
Si el usuario ya usa una copia del plan Máximo rendimiento con otro GUID (aquí `01001011-…-883`), el ajuste lo da por inactivo y activa `e9a42b02-…`. Al revertir se vuelve al plan anterior, así que no rompe nada. Se podría reconocer por el nombre o por la configuración, pero el nombre depende del idioma. Queda anotado, sin cambio por ahora.

### Punto de restauración
- Windows solo permite uno cada 24 h y ya existía uno del 13/11/2026 ("Installed DirectX"). No se cambió `SystemRestorePointCreationFrequency`, porque es un ajuste del sistema.
- Como respaldo extra se exportaron las claves tocadas a `.verify-backup/<fecha>/` (`.reg` y foto inicial; ignorado por git).
- El camino "Protección del sistema apagada" no se ejecutó, porque habría que apagarla. Se revisó en el código: el script devuelve `no_disponible` y la app continúa.

---

## 2026-11-13 · Fase A: entorno
- Node 26.13.1 y npm 11.20.0. Las versiones de `package.json` resolvieron sin cambios ni `--force`.
- npm 11 no ejecutó el script de instalación de Electron. Se ejecutó a mano con `node node_modules/electron/install.js`. Lo mismo pasará con `electron-winstaller` en la Fase G.
- `npm audit`: 6 vulnerabilidades moderadas en dependencias indirectas de empaquetado. No se aplicó `audit fix --force`, porque puede romper versiones.
