# Decisiones y hallazgos

Registro de decisiones tomadas durante el desarrollo y de lo que se descubrió al verificar. Lo más reciente va arriba.

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
