# DRL Launcher — Sistema de actualización AAA (informe técnico)

Sistema de actualización profesional para DRL Champions construido sobre el **updater
oficial de Tauri 2** (`tauri-plugin-updater`, firmas minisign/ed25519). El **DRL Launcher**
es la app principal y posee el 100% del ciclo de actualización; **el juego nunca se
actualiza a sí mismo**.

---

## 1. Arquitectura final

```
┌────────────────────────────────────────────────────────────────┐
│  Tauri 2 (Rust)  src-tauri/                                      │
│  ├─ plugin-updater   ← descarga + verificación minisign + apply  │
│  ├─ plugin-process   ← relaunch tras instalar                    │
│  ├─ plugin-fs        ← lectura de recursos (verify/repair)       │
│  └─ single-instance / dialog / notification / deep-link          │
└───────────────▲────────────────────────────────────────────────┘
                │ IPC (invoke) vía paquetes oficiales JS
┌───────────────┴────────────────────────────────────────────────┐
│  Capa de plataforma  src/platform/                              │
│  ├─ updater.ts   UpdateController (máquina de estados observable, │
│  │               métricas velocidad/ETA/%, backend INYECTABLE)   │
│  ├─ channels.ts  Stable/Beta/Developer/Nightly (cabecera HTTP)   │
│  ├─ verify.ts    SHA256 vs files.json + reparar                  │
│  └─ update.ts    fachada compat (checkForUpdate/applyUpdate)     │
└───────────────▲────────────────────────────────────────────────┘
                │ hook useUpdater
┌───────────────┴────────────────────────────────────────────────┐
│  DRL Launcher (UI)  src/app/launcher + src/components/launcher  │
│  Logo · Noticias · Eventos · Live · estado servidores · versión  │
│  instalada/disponible · barra de progreso (MB/s, ETA, fases) ·    │
│  ACTUALIZAR / JUGAR · Verificar · Reparar · Config · Logs ·       │
│  Cambiar rama (canal)                                             │
└──────────────────────────────────────────────────────────────────┘
                │ "JUGAR" (solo si está al día)
                ▼
        DRL Champions (juego)  — NO importa el módulo updater
```

**Principio clave:** el controlador depende de un `UpdaterBackend` inyectable. En
producción es `TauriBackend` (plugin oficial); fuera de Tauri es `NoopBackend` (web → "al
día", sin romper); en tests el harness inyecta un backend determinista. No hay mocks en
producción: es inyección de dependencias real.

### ¿Qué usa el updater oficial de Tauri y qué es complementario?
| Capacidad | Mecanismo |
|---|---|
| Comprobar versión | **Tauri** `check()` contra `latest.json` firmado |
| Descargar bundle | **Tauri** `download()` con eventos de progreso |
| Verificar firma | **Tauri** (minisign/ed25519, `pubkey` en `tauri.conf.json`) |
| Instalar + reiniciar | **Tauri** `install()` + `plugin-process` `relaunch()` |
| Canales (ramas) | **Complementario**: cabecera `X-DRL-Channel` → el servidor sirve el manifiesto de la rama |
| Verificar/Reparar archivos | **Complementario**: `files.json` SHA256 de recursos; reparar = reinstalar vía updater |

> **Nota honesta sobre "delta":** el updater de Tauri **reemplaza el bundle firmado
> completo** (NSIS/MSI/AppImage/.app). **No** ofrece delta por-archivo. Por eso "Reparar"
> valida los recursos contra `files.json` y, si hay daño, re-ejecuta el updater oficial
> (no se inventa un patcher por-archivo que Tauri no soporta). Lo que **sí** se evita es
> "descargar otro instalador a mano": el jugador pulsa ACTUALIZAR y el updater trae solo el
> nuevo bundle de la versión, verificado y aplicado en caliente.

---

## 2. Flujo de actualización

```
Lanzar launcher
   └─ loadChannel() → UpdateController.check(canal)
         ├─ sin update  → phase "up-to-date"  → botón JUGAR
         └─ hay update  → phase "available"   → muestra v0.5.2 → v0.6.0,
                                                 notas, botón ACTUALIZAR
ACTUALIZAR
   └─ downloadAndInstall()
        phase "downloading"  → barra MB/MB + MB/s + ETA + mini-pasos
        phase "installing"   → aplica el bundle
        phase "verifying"    → firma minisign validada por Tauri
        phase "ready"        → relaunch() → arranca la nueva versión
```

Estados (`UpdatePhase`): `idle → checking → up-to-date | available → downloading →
installing → verifying → ready` (+ `error` con reintento).

---

## 2.1 Arranque automático (comportamiento AAA, sin botones)

La ventana de Tauri abre `/launcher`, que monta **`BootGate`** — el punto de enganche de la
comprobación automática. Secuencia al hacer doble clic en el `.exe`:

```
Splash (logo, mín. 1.3 s)
  → initPlatform()            "Inicializando plataforma…"
  → isOnline()                "Comprobando conexión…"
  → controller.check(canal)   "Buscando actualizaciones…"  (si checkOnStart)
       ├─ red falla / servidor inaccesible → PANTALLA OFFLINE
       │     "Modo sin conexión" → [Continuar sin conexión] → Launcher
       ├─ al día  → SPLASH ÉXITO "✔ DRL Champions actualizado · v0.6.0" (2.2 s) → Launcher
       └─ hay update → PANTALLA EXCLUSIVA DE ACTUALIZACIÓN (no se entra al juego)
             autoDownload? → empieza sola; si no → botón ACTUALIZAR
             Descargando (██ 38% · 356/924 MB · 12 MB/s · ETA) → Verificando
             → Instalando → Finalizando → Reiniciando → relaunch() → reabre y revuelve a comprobar
```

Toggles de `Configuración` (persistidos, `update-prefs`): **checkOnStart / autoDownload /
autoInstall / autoRestart** + **canal**. Con todo activado el flujo es 100% automático
(abrir → actualizar → reiniciar → jugar). Si se desactiva alguno, el controlador para en la
fase correspondiente (`downloaded` → botón Instalar; `ready` → botón Reiniciar).

**Errores:** cualquier fallo (`CHECK/DOWNLOAD/INSTALL/RESTART_FAILED`) lleva a la pantalla de
error con **código + descripción + Reintentar + Ver registros + Salir**. Nunca se bloquea.

**Verificación:** la firma minisign la valida Tauri al terminar `download()` (antes de
instalar); si no coincide, lanza y se muestra el error (no se instala nada).

## 2.2 Detección en caliente (mientras el usuario juega) — como Fortnite/Valorant

El **mismo `UpdateController` singleton** se vigila app-wide con `useUpdateWatcher`
(`setInterval` cada `pollMinutes`, def. 15, configurable; recomprueba también al recuperar
conexión). Así el cliente detecta una versión nueva aunque lleve horas abierto, **sin
reiniciar**. Reutiliza el flujo oficial de Tauri; no duplica nada.

- **En el Launcher (`/launcher`):** `LauncherHome` muestra una **zona fija** (`StatusCard`)
  con "Versión instalada vX+N" y estado "✔ Actualizado", que cambia solo a "⚠ Actualización
  disponible · vY · [ACTUALIZAR]". No secuestra la pantalla (eso es solo el arranque
  obligatorio).
- **En el juego (rutas del juego):** `UpdateWatcher` (montado en `AppShell`) muestra una
  **notificación elegante** abajo a la derecha:
  - Fuera de partido → "Nueva versión disponible · [Actualizar] [Después]".
  - **En partido** (ruta `/entrenador`) → "Se instalará cuando termine el partido ·
    [Actualizar ahora] [Más tarde]". **Nunca interrumpe un partido** (detección por ruta, sin
    tocar el Match/Coach Engine). "Actualizar" lleva a `/launcher`, que ejecuta el flujo
    oficial firmado.

## 2.3 "Actualizado correctamente" (tras la OTA)

Al reabrir tras instalar, `BootGate` compara la última versión vista (`seenVersion`,
persistida) con la instalada; si cambió, muestra 2 s **"DRL Champions actualizado
correctamente · Bienvenido a la versión X"** y entra al Launcher.

## 3. Archivos creados / modificados

### Creados
**Capa plataforma** — `src/platform/`: `updater.ts` (controlador + máquina de estados +
métricas + flujo granular + backends), `channels.ts` (4 canales), `verify.ts` (SHA256 +
reparar), `updatePrefs.ts` (preferencias auto-update), `app.ts` (`exitApp`).
**Launcher** — `src/components/launcher/`: `BootGate.tsx` (orquestador de arranque),
`BootSplash.tsx` (splash loading/success), `OfflineScreen.tsx`, `UpdateRequiredScreen.tsx`
(pantalla exclusiva de actualización), `SettingsDrawer.tsx` (configuración + toggles),
`LauncherHome.tsx` (launcher principal), `useUpdater.ts` (hook), `UpdatePanel.tsx`,
`ChannelSwitcher.tsx`.
**Tooling** — `scripts/lib/release-core.mjs`, `scripts/gen-latest.mjs` (latest.json +
meta.json + files.json), `scripts/release.mjs`, `scripts/update-server.mjs`,
`scripts/updater-verify.ts` (51 aserciones). `docs/UPDATER.md`.

### Modificados
- `src/app/launcher/page.tsx` — ahora solo monta `<BootGate/>`.
- `src/platform/update.ts` — fachada sobre el controlador (compat).
- `src/platform/index.ts` — exporta updater/channels/verify/updatePrefs/app.
- `src-tauri/Cargo.toml` + `src/lib.rs` — `tauri-plugin-process`.
- `src-tauri/capabilities/default.json` — permisos updater/process(exit,restart)/fs.
- `src-tauri/tauri.conf.json` — `createUpdaterArtifacts: true`, endpoint `update.drlchampions.com`.
- `package.json` — deps oficiales `@tauri-apps/{api,plugin-updater,plugin-process}` + scripts.

> **Motores intactos:** Match/Brain/Agent/Utility/Economy/Coach/Tactical/Combat/Identity/
> Narrative/Live Esports/Intel/Broadcast/UI no se tocan. Toda la lógica vive en
> `Platform/Updater` + `Launcher`. El juego se monta al pulsar JUGAR (router → `/`).

---

## 3.1 Versionado automático y Build Number (fuente única de verdad)

`version.json` (raíz) es el **único** origen: `{ version (semver público), build (contador
interno monótono), channel }`. `scripts/lib/version-manager.mjs` lo lee y **sincroniza** a
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` y `src/platform/version.ts`
(de ahí lo consumen launcher/about/logs/ventana/updater). El "full version" mostrado es
`${version}+${build}` (p.ej. `0.6.1+128`). **Nadie edita el número a mano.**

> Por qué la versión semver avanza en cada release: el updater oficial de Tauri solo actualiza
> si `remoto > instalado` por **semver** (ignora `+build`). Por eso el pipeline incrementa
> `patch` por defecto (además del build), garantizando que el cliente SIEMPRE detecte la
> actualización. `--minor`/`--major` para saltos mayores; `--none` solo build (no dispara OTA).

## 3.2 Detección de cambios (no genera releases vacías)

`scripts/lib/changes.mjs` hace un **fingerprint SHA256** de `src/`, `src-tauri/src`,
`capabilities`, `public`, `scripts/` y los ficheros de config. **Normaliza** los campos
`version` (para que un bump no se auto-detecte) y excluye `version.json`/`version.ts`. Compara
con la huella de la última release (`.release/last.<canal>.json`):
- **Sin cambios** → `No changes detected. Release cancelled.` (no bumpea).
- **Con cambios** → diferencia archivos → **notas automáticas** mapeando rutas a motores/módulos
  (Brain/Utility/Agent/Match/Coach/Card system/Launcher & Updater/…).

## 4. Publicar una nueva versión — comando ÚNICO

```bash
# Clave de firma (solo para el bundle real; NUNCA se commitea)
export TAURI_SIGNING_PRIVATE_KEY="$(cat src-tauri/.tauri-signing.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

npm run release            # detecta cambios → auto-bump → build → firma → manifiestos → publica
```

`npm run release` ejecuta automáticamente (11 pasos):
1. Detecta cambios desde la última release (si no hay → cancela).
2. Auto-incrementa **Build Number** + versión semver (patch por defecto).
3. Sincroniza la versión en todo el proyecto.
4. Compila Web. 5. Compila Desktop + **bundle firmado** de Tauri.
6-8. Genera `latest.json` (Tauri, firmado) + `meta.json` (build/tamaño/notas) + `files.json`
   (SHA256 de recursos). 9. **Verifica integridad** (re-hash vs `files.json`).
10. **Notas automáticas** (motores/módulos modificados) → `CHANGELOG.md`.
11. Publica en `dist/update/<canal>/` y guarda la huella en `.release/`.

Opciones: `--channel <c>` · `--minor`/`--major`/`--none` · `--force` (releasar sin cambios) ·
`--dry` (planificar sin escribir) · `--no-bundle` (solo manifiestos, sin instalador firmado —
útil en máquinas sin toolchain Rust) · `--skip-web` · `--notes "…"`.

```
dist/update/stable/
  ├─ latest.json        (manifiesto del updater oficial de Tauri, firmado)
  ├─ meta.json          (versión+build, notas, tamaño por plataforma)
  ├─ files.json         (integridad SHA256 de recursos)
  └─ DRL Champions_x.y.z_x64-setup.exe (+ .msi, etc.)
```

## 5. Generar una release (solo manifiestos sobre un build previo)

```bash
npx tauri build --bundles nsis,msi      # genera el .exe + .exe.sig firmados
node scripts/gen-latest.mjs --version 0.6.0 --channel stable \
     --base https://update.drlchampions.com --notes "Notas del parche"
```

## 6. Probar el updater en local (sin desplegar)

```bash
# A) Genera dist/update/<canal>/ (pasos 4 o 5)
# B) Sirve esa carpeta como servidor de updates:
npm run update:server          # http://localhost:8787  (X-DRL-Channel / ?channel=)

# C) Apunta TEMPORALMENTE el endpoint en src-tauri/tauri.conf.json a:
#      "http://localhost:8787/latest.json"
#    Instala una versión ANTERIOR, ábrela y verás "Nueva versión disponible".
#    El servidor soporta Range (descargas reanudables) y /health (estado servidores).
```

El harness `npm run updater:verify` valida la máquina de estados, el progreso, los canales,
la integridad y el núcleo de release **sin** Tauri ni red (CI-friendly).

## 7. Desplegar el servidor de updates

`update.drlchampions.com` es un **servidor estático** que debe:
1. Servir `GET /latest.json` devolviendo el manifiesto del canal indicado en la cabecera
   `X-DRL-Channel` (default `stable`).
2. Servir los artefactos (`/<canal>/<archivo>`) con `Accept-Ranges: bytes`.
3. (Opcional) `GET /<canal>/files.json` para Verificar/Reparar.
4. (Opcional) `HEAD /health` → 200 (badge "Servidores: operativos").

Sirve cualquier CDN/objeto (S3+CloudFront, Cloudflare R2, nginx). Sube el contenido de
`dist/update/` respetando la estructura `/<canal>/...`. `update-server.mjs` es la referencia
exacta del comportamiento esperado.

## 8. Rollback

El updater de Tauri solo avanza (instala si `remote > local`). Para revertir:
- **Recomendado:** re-publica el build anterior con un número de versión **superior**
  (p.ej. `0.6.0` malo → publica `0.6.1` = contenido de `0.5.2`). Es forward-compatible.
- **Por canal:** mueve a los afectados a un canal con la versión buena (Cambiar rama).
- El servidor decide qué `latest.json` sirve por canal: el rollback es una operación de
  servidor (cambiar el manifiesto del canal), sin tocar el cliente.

## 9. Añadir / cambiar canales

Los canales viven en `src/platform/channels.ts` (`CHANNELS`). El cliente envía
`X-DRL-Channel`; el servidor responde con `dist/update/<canal>/latest.json`. Para una rama
nueva: añade la entrada en `CHANNELS` y publica con `--channel <nombre>`. El selector
"Cambiar rama" del launcher persiste la elección y re-comprueba al instante.

## 10. Logs y diagnóstico

`src/platform/log.ts` registra boot/errores/updates/tiempos. El launcher muestra los
últimos 60 (botón "Ver logs"). Eventos del updater: comprobación, versión, descarga,
instalación, firma verificada, reinicio y errores con mensaje.

## 11. Preparado para el futuro
- **Notarización macOS / firma Authenticode Windows**: añadir certs en `tauri.conf.json`
  (`bundle.macOS`, `bundle.windows.certificateThumbprint`).
- **Telemetría de updates**: el `UpdateController` es observable; suscribir un reporter.
- **A/B / staged rollout**: el servidor puede ponderar qué `latest.json` sirve por % de
  usuarios usando la cabecera de canal + un hash de instalación.
- **Background updates**: llamar a `check()` periódicamente desde el launcher.
- **Verify incremental real**: si Tauri incorpora deltas, `verify.ts` ya aísla el diff por
  archivo y se podría descargar solo lo dañado.

---

## Seguridad
- Firma **obligatoria**: el `pubkey` de `tauri.conf.json` debe corresponder a
  `src-tauri/.tauri-signing.key` (verificado: coinciden). Tauri rechaza cualquier bundle
  sin firma válida — un servidor comprometido no puede inyectar binarios.
- La clave privada **nunca** se commitea (`.gitignore`). Guárdala en el secreto de CI
  (`TAURI_SIGNING_PRIVATE_KEY`).
