# WALKOUT 0.7 — activación global en producción

**Veredicto: WALKOUT 0.7 — LIVE FOR ALL PLAYERS** (2026-10-08T17:44:19Z, autorización expresa del propietario).

| | |
|---|---|
| Release activa | `drl-0.1.1-1-6079e070` |
| WALKOUT GLOBAL | **ON** (`PACK_WALKOUT_3D_ENABLED = "all"`) |
| Rollback inmediato | `bin/deploy.sh --activate drl-0.1.1-1-69e4b672` (misma build con el walkout en «off», segundos) · antes del walkout: `drl-0.1.1-1-39b025b8` |
| Migraciones | ninguna (cabeza 0073) |
| Economía | sin cambios: overlay de 3 ficheros (`src/config/features.ts` + 2 tests); los 7 ficheros de economía con su sha256 |

Evidencia: `docs/product/qa/walkout-0.7/`.

## 1. Verificación previa

Release `69e4b672` healthy (0 reinicios, 0 errores), túnel 4 conexiones, interruptor «off» en la fuente servida,
APIs y assets 200, `/design-system/*` 404, releases de rollback presentes.

**Compuerta con sesión de administrador (obligatoria):** en el Chrome del propietario, que ya tenía sesión admin
iniciada (no se tecleó ninguna credencial), `https://valorosters.com/admin/walkout` pasó el `AdminGuard` del servidor y
reprodujo: w-tr → `lar0k` Future Star · WALKOUT · TUR/BBL; w-mega → 3 especiales seguidas `mada` Moments · MEGA ·
CAN/NRG, `xross` Future Star · WALKOUT · KOR/NS, `marteen` Record Breaker · MEGA · CZE/M8 → «Fin… sus 3 especiales».
REPETIR/SALTAR/CONTINUAR funcionaron, 0 errores de consola. Ese Chrome pide movimiento reducido, así que la comprobación
con sesión se vio en 2D; el 3D se verificó sobre los mismos bytes en los puntos 3 y 4.

## 2. Activación

Interruptor existente `PACK_WALKOUT_3D_ENABLED` → `"all"` (constante del build; ningún localStorage). Release nueva por
el procedimiento habitual: staging sobre la fuente viva (`scripts/ops/_w07-stage.sh`: `BOUNDARY_OK`, 0 añadidos,
3 modificados, F78 = producción) → `bin/deploy.sh` (build 3 min, BUILD_ID verificado, `ACTIVA`).

Gates locales antes: suite **6340/6340**, typecheck verde, lint 0 errores en lo tocado.

## 3. Pruebas aisladas sobre la release viva

Copia de `releases/6079e070` servida en un contenedor aislado (sin `secrets/app.env`, sin BD, sin worker esports),
arnés F81 con cartas REALES fijas. En build de producción el arnés ya no puede forzar nada: los walkouts salen porque
el interruptor es «all».

| Prueba | Resultado |
|---|---|
| 7 escenas (TUR, JPN, USA, KOR, MEGA, duplicados con Champions S, sin especiales) · 1280 | **75/75** |
| móvil 390 (w-tr, w-mega, w-std) | **30/30** |
| movimiento reducido (w-us, w-mega, w-dup) | **43/43** |
| sin WebGL (w-us, w-mega) → 2D, la carta aparece | **28/28** |

Cada walkout: carta, intensidad y nacionalidad = las de la carta (en la pieza y en la arena 3D); doble clic en ABRIR,
SALTAR, REPETIR y F5 → siempre 1 apertura y 1 petición; resumen con todas las cartas.

## 4. Verificación pública (https://valorosters.com, invitado, sin cuenta ni clave de prueba)

El invitado juega en local (motor del navegador): sin servidor, sin cuenta, sin créditos reales. Al invitado de ese
navegador de pruebas se le dejó un sobre Icon en su estado local para que salieran especiales; las cartas las sorteó
el motor real.

| Escenario | Resultado |
|---|---|
| Icon · 1280 · 3D | 3 walkouts: `marteen` Record Breaker MEGA CZE, `timotino` Future Star CAN, `loita` Future Star TUR; arena = país; persona 3D |
| Icon · 390 | igual, 3/3 |
| Icon · reducido | 3 walkouts en 2D |
| Bronce | 0 especiales → 0 walkouts: apertura tradicional |

En todos: ningún asset 3D se descarga antes de abrir, 0 errores de consola. `qa-public-live.txt` y capturas
`public-live-*.png`.

## 5. Estado tras la activación

App healthy, 0 errores en logs desde 17:44Z, `/api/ready` ready (331/331), túnel 4 conexiones. `/`, `/tienda`,
`/abrir/*`, `/inventario`, `/cuenta`, `/api/content/agents|packs`, assets → 200; `/design-system/*` → 404.

## 6. Economía

El servidor sigue decidiendo y guardando el sobre antes de cualquier animación (sin cambios desde 0.5). Prohibidos y no
tocados: RNG, probabilidades, precios, créditos, inventario, recompensas, límites, transacciones. Ninguna cuenta real
abrió un sobre en las pruebas.

## 7. Pendiente

- Rendimiento en GPU reales y móviles modestos sin medir (render por software en la QA); nadie ha escuchado el audio.
- Sobres caros más largos si no se omite (Champions +21 s, Icon +36 s de media); OMITIR siempre disponible.
- Sin telemetría agregada aún de `walkout_failed`/`walkout_shown` en producción: vigilar `/admin/operations`.
- Preexistente y ajeno: contenedores `edge_runtime`/`vector` de Supabase reiniciándose, copia con `fallos=1` (04:30Z),
  off-site BLOCKED, autoconfirmación de correo, cloudflared antiguo, 2 medidas del Sobre Inicial en `economy:verify`.

## 8. Rollback

1. `ssh nexusadmin@212.95.40.144 /opt/nexus/projects/valorosters/bin/deploy.sh --activate drl-0.1.1-1-69e4b672`
   → apertura anterior para todos (1–3 s de corte).
2. `bin/status.sh` → healthy + `/api/health` 200.
3. Si hiciera falta quitar todo el walkout: `--activate drl-0.1.1-1-39b025b8`.
