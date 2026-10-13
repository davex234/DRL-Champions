# WALKOUT 0.6 — despliegue en el VPS

**Veredicto: WALKOUT 0.6 — VPS DEPLOYED** (2026-10-08T17:17:21Z). El walkout está desplegado en el VPS con el
interruptor **OFF** global: la apertura que ven los jugadores es la de siempre (F81). La experiencia nueva se puede
probar sin gastar sobres en `/admin/walkout`, protegida por el servidor (solo admins).

Evidencia: `docs/product/qa/walkout-0.6/` (`qa-prod-build.txt`, `qa-public.txt`, `public-endpoints-before-after.txt`,
`overlay-files.txt`, capturas `prod-build-*.png`, `public-abrir-*.png`).

## 1. Estado inicial del VPS (auditoría, solo lectura)

| Comprobación | Resultado |
|---|---|
| SSH `nexusadmin@212.95.40.144` | OK (clave, sin contraseña) |
| Docker | `valorosters-app` healthy (0 reinicios, desde 2026-10-07T17:58Z), `valorosters-tunnel` arriba desde 2026-10-01 |
| Release activa | `drl-0.1.1-1-39b025b8` (Full Game Audit) |
| Salud | `/api/health` ok · `/api/ready` ready · migración `0073_pickems_launch_guard` |
| Cloudflare Tunnel | conector 200, 4 conexiones (fra08); avisos de versión 2026.9.1 «outdated» y un corte QUIC recuperado solo (16:30Z) |
| Disco / RAM / CPU | 335 GB libres (32 %) · 51 GB de RAM disponible de 62 · 16 núcleos |
| Node | v24.15.0 (imagen `node:24.15.0-bookworm-slim`) |
| Scripts del VPS | `bin/deploy.sh`, `bin/status.sh`, `compose.yml` = copias del repo (sha256 iguales) |
| Rollback | 7 releases anteriores con build (`39b025b8`, `c8645d8d`, …) |
| Ajeno (no tocado) | `supabase_edge_runtime_DRLCards`, `supabase_vector_DRLCards` y `supabase_vector_sportcoach` en bucle de reinicio **antes** de este despliegue; el registro de la copia local de las 04:30Z dice `fallos=1` |

## 2. Release anterior

`drl-0.1.1-1-39b025b8`. Rollback inmediato: `bin/deploy.sh --activate drl-0.1.1-1-39b025b8` (solo mueve `current` y
recrea la app; 1–3 s de corte).

## 3. Release nueva

`drl-0.1.1-1-69e4b672`, construida con el procedimiento existente:

1. Fuente = la de producción (`releases/39b025b8`) + **overlay de 62 ficheros** (`scripts/ops/_w06-stage.sh`). La
   frontera se probó byte a byte: `BOUNDARY_OK` (48 añadidos + 14 modificados = el overlay exacto, 0 borrados), los
   ficheros de F78 siguen siendo los de producción. El trabajo local ajeno (F78, `instrumentation.ts`, instrumentos,
   src-tauri, mapas…) NO va en la release.
2. Compuerta previa (`scripts/ops/_w06-gate.sh`): build de producción en un contenedor desechable con los mismos
   parámetros que `deploy.sh` → `GATE_BUILD_OK`, mismo aviso de `instrumentation` que la release viva (preexistente).
3. QA de esa build servida en un contenedor aislado (loopback 127.0.0.1:3016, **sin** `secrets/app.env`, clave de
   servicio inválida, Supabase interno inalcanzable, sincronización esports apagada → ninguna escritura posible).
4. `bin/deploy.sh drl-0.1.1-1-69e4b672` → build 3 min 23 s, BUILD_ID verificado, `ACTIVA`.

## 4. Archivos desplegados (overlay, lista completa en `qa/walkout-0.6/overlay-files.txt`)

- **Walkout** (Walkout 0.1–0.5, nunca desplegados): `src/components/walkout/*` (director, escenario 2D/3D, persona,
  arena), `src/domain/walkout/*`, `src/lib/walkout/*`, `src/components/packs/PackWalkout.tsx`, `public/walkout/**`
  (2 modelos glTF + .bin, 16 texturas, licencias), `src/app/design-system/pack-walkout/page.tsx` (arnés, 404).
- **Integración 0.5:** `PackOpeningExperience.tsx`, `domain/packs/reveal.ts`, `config/features.ts`
  (`PACK_WALKOUT_3D_ENABLED = "off"`), `design/environment.ts`, `lib/audio/music.ts`, arnés `fase81`.
- **Dependencia:** `three` 0.186.1 (+ `@types/three`, desarrollo) en `package.json`/`package-lock.json` (solo añadidos).
- **Nuevo en 0.6:** `src/app/admin/walkout/page.tsx` (vista previa protegida), `src/app/layout.tsx`
  (`metadataBase`), `stage3d.ts` (`PCFShadowMap`), `scripts/economy41-verify.ts` (pins viejos), tests
  `walkout05.integration`, `walkout06.deploy` y pins actualizados (`f57`, `packOpening.behavior`, `environment`).

## 5. Docker

`valorosters-app` healthy, 0 reinicios desde 17:17:18Z, misma imagen y límites (2 GB, 4 CPU). Logs desde el despliegue:
0 errores; arranque con los mismos avisos OPCIONALES de siempre (ANTHROPIC_API_KEY, VLR). El contenedor de QA
`valorosters-w06-qa` se borró; `/tmp/w06` borrado.

## 6. Cloudflare

Mismo túnel `drlcards`, sin reiniciar (desde 2026-10-01), 4 conexiones listas, sin errores nuevos tras el despliegue.
Las texturas y binarios del walkout se sirven con `Cache-Control: public, max-age=14400` y caché de borde
(primera petición `cf-cache-status: MISS`, la segunda `REVALIDATED` desde el borde), igual que el resto de imágenes del sitio; los `.gltf` (24 KB con gzip) se revalidan.

## 7. APIs

Antes/después idénticos (`qa/walkout-0.6/public-endpoints-before-after.txt`): `/`, `/tienda`, `/abrir/estandar`,
`/abrir/icon`, `/coleccion`, `/api/health`, `/api/ready`, `/api/content/agents`, `/api/content/packs`,
`/api/content/duel-theme` → 200; `/design-system*` → 404. `/api/ready`: todas las comprobaciones OK, catálogo 331/331.

**Los 503 locales** de `/api/content/agents|packs` NO son de producción: el servidor de desarrollo lee la BD por
`SUPABASE_INTERNAL_URL=http://127.0.0.1:54521`, el túnel SSH al VPS, que no está abierto (el catálogo devuelve 503 «no
disponible» en vez de inventar datos, que es lo correcto). En producción ambos responden 200 con datos reales.

**Avisos:** `metadataBase` era un problema REAL: producción publicaba `og:image = http://localhost:3000/...` (la vista
previa al compartir el enlace estaba rota). Ahora sale `https://valorosters.com/branding/assets/og.png`.
`PCFSoftShadowMap`: three 0.186 lo retiró y usaba `PCFShadowMap` de todas formas; se pide directamente (misma sombra,
sin aviso).

## 8. Tests

| Gate | Resultado |
|---|---|
| Suite completa | **6339/6339** (baseline real 6333 + 6 de `walkout06.deploy`; después se añadió D07 → 7/7, solo local, sin efecto en ejecución) |
| Walkout + apertura + entorno + admin | 67/67 |
| `pack-opening:verify` | 34 ✓ · 0 ✗ |
| `economy:verify` | **58 ✓ · 2 ✗** (antes 53 ✓ · 7 ✗) |
| Lint | 0 errores (29 avisos preexistentes) |
| Typecheck | verde |
| Build de producción | verde en el VPS (dos veces: compuerta y despliegue) |
| Ficheros de economía | sha256 idénticos (packs.ts, route.ts, sync.ts, packClass.ts, openPack.ts, pool.ts, useGameStore.ts) |

**Los 7 de `economy:verify`:** 5 eran expectativas viejas y se corrigieron con evidencia, sin tocar reglas ni precios:
3 de idempotencia fijaban el precio de Bronce 750 (desde F80 es 2.500: ahora se calculan con `getPack("estandar").price`
→ 3.500/1.000/1.350); la copia FTUE dice «equipo» y no «plantilla»; «sin migración nueva en F41» exigía que la última
fuera 0053 (hoy 0073, de fases posteriores; ahora se comprueba la base 0053). **Quedan 2, que NO son pins viejos**: la
simulación de 20.000 cuentas del Sobre Inicial mide 369 cuentas (1,8 %) que no completan equipo dentro del tope de
sobres gratis y P50/P90/P99 = 6/9/12 aperturas (objetivo ≤ 4/6/8). Es una medida de onboarding/economía; cambiarla
exige una decisión de producto. No se tocó.

## 9. Estado de WALKOUT

Desplegado y apagado. QA de la build de producción (`qa-prod-build.txt`, 9/9): persona 3D y arena listas (TUR), los
assets salen del mismo origen con 200, la animación llega al final, 0 violaciones de CSP, reducido → 2D, sin WebGL
(Chrome `--disable-3d-apis`) → respaldo 2D con la identidad de la carta, identidad en ejecución OK (TUR, JPN, EMEA de
reserva, USA; memoria estable al cambiar de carta). En la build de producción ni `localStorage["drl:walkout3d"]` ni el
arnés QA encienden el walkout.

QA pública en https://valorosters.com (`qa-public.txt`, 15/15, invitado, sin cuenta): inicio, tienda, inventario,
cuenta y colección cargan; **la apertura real de siempre** (invitado = motor local, gratis) llega al resumen con
0 walkouts aunque se ponga la clave de localStorage; ni el chunk de three.js ni los modelos se descargan; 0 errores de
consola.

## 10. Feature flag

`src/config/features.ts · PACK_WALKOUT_3D_ENABLED = "off"` (constante del build).

- **off** (ahora): nadie ve el walkout en la apertura real.
- **admins**: solo cuentas con `profiles.is_admin` (veredicto del servidor, cerrado ante fallos) lo ven en la
  apertura REAL. Ojo: esa apertura es real y gasta un sobre real de esa cuenta.
- **all**: todos.

Activar «admins» = cambiar la constante → release nueva (overlay de 1 fichero, ~4 min) **con tu autorización**.
Desactivar de inmediato = `bin/deploy.sh --activate drl-0.1.1-1-69e4b672` (esta release, en «off»), segundos.

**QA protegida sin gastar nada:** `https://valorosters.com/admin/walkout`. Detrás de `AdminGuard`
(`/api/admin/session` → `profiles.is_admin`); un anónimo recibe el armazón sin contenido (`no-store`, `noindex`).
Reproduce la pieza real (`PackWalkout`) con la cola real (`packWalkoutQueue`) de siete escenas de cartas reales
(TUR, JPN, USA, KOR, MEGA, duplicados, sin especiales). No abre sobres, no llama a APIs de juego, no toca el store.

## 11. URLs públicas

- https://valorosters.com — el juego (apertura de siempre).
- https://valorosters.com/admin/walkout — vista previa protegida del walkout (solo admins).
- https://valorosters.com/walkout/human/rocketbox-player.gltf (y el resto de `public/walkout/`) — assets públicos.
- `/design-system/*` → 404.

## 12. Assets

22/22 ficheros de `public/walkout/` → 200 desde Cloudflare con su Content-Type (`model/gltf+json`,
`application/octet-stream`, `image/webp`, `image/png`, `image/svg+xml`, `text/plain`), rutas relativas (el glTF
referencia `.bin` y texturas por nombre; test D04), sin localhost ni rutas de Windows, mismo origen (la CSP no se
tocó: `connect-src 'self'` e `img-src 'self'` bastan). Licencias en el propio despliegue: Rocketbox (MIT, aviso íntegro
incluido) y Quaternius (CC0) en `LICENSE-ASSETS.txt`; flag-icons (MIT). Peso de una persona: ~2,6 MB (glTF 24 KB con
gzip + .bin 795 KB + texturas WebP). three.js va en un chunk propio (`1upn7mwzwaxsl.js`) que no está en la carga
inicial de ninguna página (`/`, `/tienda`, `/abrir/*`, `/admin/walkout` comprobadas).

## 13. Rollback

- Apagar el walkout: ya está en «off». Si una release futura lo enciende:
  `bin/deploy.sh --activate drl-0.1.1-1-69e4b672`.
- Volver a la release anterior al walkout: `bin/deploy.sh --activate drl-0.1.1-1-39b025b8` (existe con build).
- Sin migración: no hay nada que deshacer en la BD.

## 14. Riesgos pendientes

- **No probado con una sesión admin real**: `/admin/walkout` no se pudo ver con sesión (no inicio sesiones con
  contraseña). Está verificada por build, test de render (D07) y piezas validadas en la build de producción.
- **GPU real y audio**: medidos con render por software; nadie ha escuchado el audio.
- **Duración en sobres caros**: Champions +21 s e Icon +36 s de media sin omitir (cuando se encienda).
- **«admins» gasta sobres reales** de la cuenta admin al abrir.
- **economy:verify**: 2 medidas de onboarding fuera de objetivo (ver punto 8), preexistentes.
- **Ajeno, preexistente**: `edge_runtime`/`vector` de Supabase reiniciándose, copia local con `fallos=1` a las 04:30Z,
  off-site BLOCKED (B2), autoconfirmación de correo ON, cloudflared 2026.9.1 «outdated».

## 15. Independencia del PC

La web la sirven `valorosters-app` + `valorosters-tunnel` en el VPS. En el PC: tareas `DRLCards` y
`DRLCards-Tunnel` **deshabilitadas**, ningún `cloudflared`, nada escuchando en 3005/54521/54522 (el túnel de QA 3016
se cerró). `production:check` desde el PC confirma que `127.0.0.1:3005` del PC no responde y la web sí. Los assets
están en la release del VPS (`releases/drl-0.1.1-1-69e4b672/public/walkout`), no en el PC.

## Lo que NO se hizo

Ni commit ni push. Ni migraciones. Ni cambios de RNG, probabilidades, precios, inventario, créditos, recompensas,
límites o transacciones. Ni escrituras económicas: ninguna cuenta real abrió un sobre (la apertura pública fue de
invitado, local). Worker esports y sus cron intactos. Otros proyectos del VPS intactos. Producción no depende de él, pero al cerrar la sesión el servidor de desarrollo :3000
del usuario ya NO estaba en marcha (no lo paré yo; el único proceso que cerré fue mi túnel SSH de QA) y no lo relancé
porque otra sesión estaba compilando DRLPhones-shop en el PC.
