# PROMPT DE CONTINUACIÓN — OPTIKAX

> Pega este prompt en una sesión de Claude Code abierta en `C:\Users\Administrator\Documents\Projects\OptiKax\Optikax`.
> Complementa a `docs/PROMPT_OPTIKAX.md`, que sigue siendo la especificación completa. Si algo choca, manda `PROMPT_OPTIKAX.md`, salvo lo que este archivo corrige de forma explícita.

---

## 0. CONTEXTO

Ya están hechas las fases 1 a 5 de `PROMPT_OPTIKAX.md`:
- base Electron;
- worker de PowerShell y `OptikaxNative`;
- hardware y reglas de problemas;
- liberador de RAM;
- catálogo de ajustes con respaldo.

También existen las pantallas Panel, Optimizar y Memoria, y la API key ya se guarda cifrada con `safeStorage` (`src/main/store.ts`).

**Falta:** `ai.ts`, `gamemode.ts`, la bandeja del sistema, las pantallas Análisis IA, Modo Juego y Ajustes, three.js y animaciones, el empaquetado y la revisión final.

**Riesgos detectados en la revisión anterior** (resuélvelos en este orden):
1. Node.js no está instalado en la máquina: no hay `node` ni `npm` en el PATH ni en `C:\Program Files\nodejs`. Tampoco existe `node_modules`.
2. Nunca se ha corrido el typecheck ni `npm run dev`.
3. Las versiones de `package.json` no están validadas (TypeScript 7, Vite 8, Electron 45, electron-vite 6, `@anthropic-ai/sdk` 1.8).
4. El ciclo aplicar → revertir de los ajustes no se ha verificado.
5. El proyecto no está bajo control de versiones.
6. `network_throttling_off` y `nagle_off` tienen un beneficio discutible.
7. El modelo y las betas que pide la sección 4.4 no se han validado contra la API real.

Trabaja **por fases**. Verifica cada fase antes de pasar a la siguiente y dime qué verificaste y qué no. Si algo falla, no lo ocultes: muestra la salida.

---

## FASE A · Entorno y control de versiones

1. **Node.js.** Comprueba si Node está instalado. Si no lo está, **detente y pídeme que lo instale** (Node 22 LTS o superior desde nodejs.org, o `winget install OpenJS.NodeJS.LTS`). No descargues ni ejecutes instaladores por tu cuenta. Después confirma `node -v` y `npm -v` desde PowerShell.
2. **Git.** Ejecuta `git init`. Revisa que `.gitignore` incluya `node_modules/`, `out/`, `dist/` y `*.log`. Haz un primer commit con el estado actual, **antes de tocar nada más**, como punto de partida.
3. **Dependencias.** Ejecuta `npm install`.
   - Si una versión no existe o hay conflictos de peers, **no fuerces** con `--force` ni `--legacy-peer-deps` sin decirme por qué. Baja a la última versión estable compatible y anota cada cambio de versión en `docs/DECISIONES.md`.
   - Verifica que exista `node_modules/electron/dist/electron.exe`. Si falta, ejecuta `node node_modules/electron/install.js`.
4. **Typecheck.** Corre `npm run typecheck` y deja **cero errores**. Corrige el código, no relajes `tsconfig` (nada de `skipLibCheck` nuevo, `any` ni `@ts-ignore` sin justificar).
5. **Arranque.** Corre `npm run dev`. Confirma que la ventana abre como administrador, que el loader avanza con el escaneo real y que Panel, Optimizar y Memoria cargan sin errores en la consola.

*Commit:* `chore: entorno, dependencias y typecheck en verde`.

---

## FASE B · Verificación del ciclo aplicar → revertir (crítica)

Es el criterio de terminado más importante: la app modifica el registro y el plan de energía.

1. **Script de verificación.** Crea `scripts/verify-tweaks.ps1`, que **no** se empaqueta (no lo pongas en `resources/scripts`). Para **cada** ID del catálogo:
   - exporta el estado previo: valores de registro exactos, incluidos los que no existen, plan de energía activo y estado de `Get-MMAgent`;
   - aplica el ajuste usando el mismo camino que la app (`tweaks.ps1` o el worker);
   - lee el estado y confirma que coincide con lo esperado;
   - revierte;
   - compara con el estado previo **campo por campo**: valor, tipo y existencia. Un valor que no existía tiene que volver a no existir.
2. **Informe.** Genera `docs/VERIFICACION_AJUSTES.md` con una tabla `ID | aplica | lee | revierte | idéntico | notas`.
3. **Casos borde que tienes que probar:**
   - `windowed_optimizations` combina con `DirectXUserGlobalSettings` si ya existe: prueba con el valor vacío y con otro valor previo, y confirma que no lo pisa;
   - `power_ultimate` restaura el GUID original y no deja planes duplicados huérfanos en cada ciclo;
   - `nagle_off` aplica solo a la interfaz activa por GUID;
   - `backup.json` no se sobrescribe en un segundo "aplicar" (tiene que conservar el original de verdad);
   - **Revertir todo** con varios ajustes aplicados a la vez;
   - punto de restauración con System Protection apagado: avisa y continúa.
4. **Antes de probar,** crea un punto de restauración manual y avísame. Si algún ajuste no deja el sistema idéntico, **corrígelo antes de seguir**.

*Commit:* `test: verificación aplicar/revertir de todo el catálogo`.

---

## FASE C · Ajustes de riesgo medio

- `network_throttling_off` y `nagle_off`:
  - mantén `riesgo: 'medio'`;
  - **no** se incluyen en "Aplicar recomendados" salvo que la IA los recomiende con un motivo específico para el hardware o los juegos del usuario;
  - en la tarjeta, añade una nota corta: "Efecto discutido; solo ayuda en algunos juegos".
- Confirma de nuevo con búsqueda en el repo que no hay coincidencias de `Set-Service|sc config|Stop-Service|bcdedit|DisableAntiSpyware`.

---

## FASE D · Análisis con IA (`src/main/ai.ts`)

1. **Antes de escribir código,** carga la skill `claude-api` y valida contra la documentación actual:
   - el ID del modelo (`claude-opus-5-5`);
   - `thinking: { type: 'adaptive' }` y `output_config.effort`;
   - la beta `server-side-fallback-2026-07-01` y `fallbacks`;
   - la herramienta `web_search_20260209`;
   - `messages.parse` con `zodOutputFormat` en la versión instalada del SDK.

   Si algo no existe o cambió de nombre, usa el equivalente vigente y anótalo en `docs/DECISIONES.md`.
2. Implementa los dos pasos de la sección 4.4 de `PROMPT_OPTIKAX.md`:
   - **investigación** con streaming y progreso de búsquedas al renderer;
   - manejo de `pause_turn` y `refusal`;
   - fuentes extraídas de `web_search_tool_result`;
   - **estructuración** con `RecomendacionSchema`, con `z.enum` de los IDs del catálogo.
3. **Seguridad:**
   - la API key solo se lee en el proceso principal, desde `store.ts`;
   - nunca se registra en logs ni en mensajes de error;
   - filtra en código cualquier ID fuera del catálogo;
   - jamás ejecutes comandos ni claves de registro generados por el modelo.
4. **Extras:**
   - caché del último análisis con su fecha;
   - botón "Re-analizar";
   - coste estimado visible;
   - botón "Probar conexión" en Ajustes.
5. **Verificación:** si no tengo API key configurada, prueba el paso 2 con un informe simulado (`fixtures/informe-ejemplo.md`) y dímelo. **No** pidas que pegue la key en el chat: la introduzco yo en la pantalla de Ajustes.

*Commit:* `feat(ai): investigación y recomendaciones estructuradas`.

---

## FASE E · Modo Juego y bandeja (`src/main/gamemode.ts`)

1. Implementa la sección 4.5: sondeo cada 3 s, rutas de launchers, lista de juegos conocidos, juegos personalizados y exclusiones (anti-cheats, crash handlers y setups).
2. **Al detectar un juego:**
   - prioridad `High` (nunca `Realtime`);
   - purga de standby;
   - plan Máximo rendimiento;
   - limpieza automática agresiva;
   - aviso al renderer para que pause el 3D y las animaciones.
3. **Al cerrar el juego,** restaura **exactamente** el estado previo: plan de energía y umbrales de RAM. Guarda ese estado antes de cambiar nada, para que un cierre inesperado de la app no lo pierda (persístelo y restáuralo al arrancar si quedó pendiente).
4. **Bandeja del sistema:** al cerrar la ventana, la app se queda en la bandeja y el Modo Juego sigue activo. Menú de bandeja con Abrir, Modo Juego on/off y Salir.
5. Registro de sesiones: juego, duración y RAM liberada.
6. **Verificación:**
   - copia un exe inofensivo (por ejemplo `notepad.exe`) a una carpeta temporal `...\steamapps\common\Test\` y lánzalo;
   - confirma la detección, las acciones y la restauración al cerrarlo;
   - borra la carpeta al terminar.

*Commit:* `feat(gamemode): detección, acciones, restauración y bandeja`.

---

## FASE F · Interfaz completa y three.js

1. Instala `three`, `@react-three/fiber`, `@react-three/drei` y `motion` (o `framer-motion`), en versiones estables compatibles con React 19.
2. Antes de diseñar, carga la skill `emil-design-eng`. Sigue la sección 6 de `PROMPT_OPTIKAX.md` al pie de la letra:
   - paleta;
   - dos fuentes;
   - lima como único acento;
   - ritmo oscuro/claro.
3. **Pantallas:**
   - completa Análisis IA (feed en vivo y carrusel `01/08`), Modo Juego y Ajustes;
   - pule Panel con el núcleo 3D, el Score y las tarjetas 01/02/03 sobre la ola de partículas.
4. **Rendimiento 3D (obligatorio):**
   - `frameloop="demand"`;
   - `dpr={[1, 1.5]}`;
   - el 3D va en un chunk lazy;
   - pausa total con la ventana oculta, sin foco o con un juego activo;
   - con "Efectos 3D: Nunca" o `prefers-reduced-motion`, se sustituye por una imagen estática.
5. **Verificación:**
   - haz una captura de cada pantalla;
   - minimiza la ventana y confirma en el Administrador de tareas que el uso de GPU de la app cae cerca de 0%.

*Commit:* `feat(ui): pantallas completas y escena 3D`.

---

## FASE G · Empaquetado y revisión final

1. Ejecuta `npm run dist`. Confirma que se genera el instalador NSIS, que pide administrador y que `resources/scripts` queda dentro de `resources/scripts` del paquete.
2. Instala y abre la app empaquetada. Confirma que el worker y los scripts se encuentran (ruta `process.resourcesPath`).
3. Revisión final:
   - `npm run typecheck`;
   - `/code-review`;
   - `design:design-critique`;
   - `design:accessibility-review`.

   Corrige lo que salga y resume lo que dejes sin corregir, con el motivo.
4. Marca en `docs/PROMPT_OPTIKAX.md`, sección 8, los criterios de terminado que quedaron verificados, cada uno con su evidencia.

*Commit:* `chore: empaquetado y revisión final`.

---

## REGLAS PARA ESTA SESIÓN

- Siguen vigentes **todas** las reglas no negociables de la sección 1 de `PROMPT_OPTIKAX.md`.
- No hagas `push` ni crees repositorios remotos sin pedírmelo.
- No descargues ni ejecutes binarios fuera de `npm install`.
- Pregúntame antes de cualquier acción difícil de deshacer en el sistema real.
- Al final de cada fase, dame un resumen corto con:
  - **qué funciona** y cómo lo verificaste;
  - **qué no se pudo verificar**;
  - **qué decisiones tomaste** (también en `docs/DECISIONES.md`).
