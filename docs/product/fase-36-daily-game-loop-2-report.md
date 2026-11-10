# FASE 36 — DAILY GAME LOOP 2.0 (vestíbulo · hoy · sesión diaria · vuelta · orquestación de progresión)

Fecha: 2026-09-15 · Sin deploy, sin commit, sin push, sin Docker local, sin mutaciones de VPS · Marketplace OFF.
Contrato de prioridad: `docs/product/daily-loop-priority.md` · QA visual: `docs/product/qa/fase36/README.md` · Smoke real: `docs/product/qa/fase36/real-smoke.md`.

## Resultado

La home deja de ser un tablero de piezas sueltas y pasa a ser un vestíbulo con UNA acción principal decidida en el servidor:

`GET /api/game/daily-loop` (lecturas puras, aisladas y acotadas) → `buildDailyLoop` (dominio puro) → `orderToday` (la prioridad que ya compartían home y temporada) → `DailyLobby` (héroe · después · hoy + temporada · jugar · circuito · colección).

Sin sistemas nuevos: ni recompensas, ni moneda, ni stamina, ni rachas, ni Temporada 2, ni migración 0052, ni telemetría nueva.

## Estado inicial

- Home de ~12 lecturas desde el navegador (torneos, partidos, Pick'em ×3, ranking, libro mayor, posición, mazos, loop, evento de tienda, calendario) y **tres** ideas de «qué hacer»: el CTA del escenario decidido en la página, `continueCta(todayActions(loop.steps))` y el orden numérico de `loop.ts` en NextUp.
- `GET /api/game/loop` y `/api/game/meta` **escriben al leer**: `ensureRating` crea la ficha ranked 1000/0 y `getProgression` rota misiones y abre el carril competitivo (confirmado en la BD real en 35.2).
- Prioridades contradictorias: `loop.ts` ponía Pick'em (2) antes de reclamar (3); `todayActions`, al revés (claim 2, predict 3). La regla de primera sesión (abrir sobres sin cartas, prioridad 0) solo existía en `loop.ts`.

## Arquitectura

| capa | fichero | papel |
|---|---|---|
| prioridad única | `src/domain/progression/meta.ts` | `orderToday` (orden + uno por tipo + desempate estable), `todayRank` (regla `ftue`), `liveObjective`, `nearObjective(list, now)` |
| dominio | `src/domain/dailyLoop/index.ts` | hechos → candidatos → `dailyActions` → `todayItems` → `DailyLoopSnapshot` |
| servicio | `src/server/services/dailyLoop.ts` | `getDailyLoop(sb, userId|null)`: lecturas puras en paralelo, guarda por subsistema (4 s), sin escrituras |
| API | `src/app/api/game/daily-loop/route.ts` | solo GET, sin parámetros, token, `no-store`/caché pública corta, `daily_loop_read` 40/min, 5xx genérico |
| cliente | `src/lib/dailyLoop/client.ts` | tiempo máximo 8 s, última foto conservada, sin conexión, refresco al volver (≥ 30 s), `online`, eventos de invalidación |
| presentación | `src/lib/dailyLoop/presentation.ts` | modelos puros (héroe, hoy, temporada, competitivo, campaña, directo, colección) |
| UI | `src/components/dailyLoop/{DailyLobby,DailyHero,DailyPanels}.tsx` | vestíbulo, esqueleto, avisos |
| home | `src/app/page.tsx` | pinta la foto; no decide |

## Orden final (ver contrato)

resume (ranked > privada > nodo de campaña > PvE) → abrir sobres sin cartas (`ftue`, 0.5) → retos → reclamar → Pick'ems → objetivo casi completo → sobres → equipo (conseguir cartas > crear > editar) → jugar (campaña > competitivo > rápida; hub si no se leen equipos) → directo real. Principal + ≤ 3 secundarias, uno por tipo. Fallback «Jugar» → `/jugar`.

## Bugs reales

| # | bug | estado |
|---|---|---|
| 1 | La home leía por `loop`/`meta`, que escriben (rating 1000/0, rotación, carril) | corregido: la home usa el Daily Loop puro (loop/meta siguen existiendo para sus otros consumidores, P2) |
| 2 | Tres prioridades distintas para «qué hacer» | corregido: `orderToday` única |
| 3 | Objetivos completos de ventanas caducadas contaban como reclamables/casi completos (`refreshMissions` los borra al rotar) | corregido en el Daily Loop (`liveObjective`, `nearObjective(list, now)`) |
| 4 | Colores `rgb(r,g,b / a)` (comas + barra, inválido) en el vestíbulo nuevo | corregido (`rgba`) + test |
| 5 | CTA sin conexión decidía por destino (`/jugar`) en vez de por tipo | corregido (`NAVIGATION_ONLY`) |
| 6 | Secundaria del héroe duplicaba la barra «Después» | corregido |
| 7 | CTA desactivado con acento dorado parecía activo | corregido |
| 8 | FTUE «Abre tu primer sobre» a una cuenta con 25 cartas (dato real) | corregido (poseer cartas es prueba) |
| 9 | Directo de un evento `demo` sin marca en la acción | corregido |
| 10 | `app_open_pack` incrementa `user_game.packs_opened` pero la progresión lee `profiles.packs_opened`: misiones de sobres no avanzan online | **Cerrado en Fase 36.1** (fuente `user_game.packs_opened` + `metricVersion` + rebase conservador; ver `fase-36-1-pack-objective-counter-rebase-report.md`) |

## Gates

Túnel CERRADO y app parada durante los gates.

| gate | resultado |
|---|---|
| `npm test` | **2270 / 2270** (base 2111 · +159 nuevos) · 0 fail |
| typecheck web / scripts | 0 errores / 0 errores |
| ESLint (ficheros nuevos y modificados) | 0 |
| `next build` | exit 0 (incluye `/api/game/daily-loop` y `/design-system/fase36`) |
| security · pack · content · competitive · importer-vlr · combat · deck · social · replay | todas pasan (importer-vlr 69/69) |
| distribution | 30 ✓ / 0 ✗ |
| season · season-time · season-pass · season-security · season-recap | 21 · 4 · 4 · 4 · 4 ✓ / 0 ✗ |
| campaign · campaign-security · campaign-economy · campaign-content | 33 · 13 · 11 · 9 ✓ / 0 ✗ |
| **daily-loop** · **daily-loop-priority** · **daily-loop-security** (nuevos) | 47 · 22 · 25 ✓ / 0 ✗ |
| Suites con BD real (RLS, PostgREST, `app_rate_take`) | NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA |

Tests nuevos: `dailyLoop.test.ts` 72 (matriz de prioridad, P0, reclamables, casi completado, HOY, aislamiento, anónimo, rutas, copy) · `presentation.test.ts` 25 · `dailyLoop.service.test.ts` 31 (sin efectos, privacidad, aislamiento, timeout, lecturas acotadas) · `dailyLoop.contract.test.tsx` 31 (ruta, seguridad, render, a11y, movimiento, telemetría, migraciones). Contratos antiguos actualizados con la misma intención: gameplay C6, meta 38, competitive integración, liveEvents home, campaign T81-bis/T84/T87, deckBuilder 73/79, season home, lobby ADOPCIÓN/ANTI-GRAMÁTICA/SIN RED.

## Smoke real y QA

- Smoke local contra la BD del VPS con la cuenta QA (dos pasadas): acción real «2 objetivos por reclamar» (verificado en `user_pass`), RtC 1/15 con c1-n2 contra LOUD, equipo activo válido, ranked sin partidas; API segura (400 con `?userId=`, 405 POST, `no-store`); 9 rutas del loop correctas; **huella de BD idéntica antes/después** en ambas pasadas. Detalle: `qa/fase36/real-smoke.md`.
- QA visual: 90 capturas de arnés (41 escenas × 1440/1024/390) + 13 reales; 0 desbordamientos, 0 controles < 44 px, 0 errores de consola propios.

## P2

1. `GET /api/game/loop` y `/api/game/meta` siguen escribiendo al leer (consumidores: `/jugar`, `/progresion`, `CollectionObjectives`, post-partida).
2. `rgb(r,g,b / a)` inválido preexistente en `MasteryPanel`, `LiveEventPanel`, `NextUp`.
3. La ficha ranked 1000/0 de la cuenta QA creada en 35.2 por `ensureRating` sigue en la BD (inofensiva, 0 partidas).
4. Un token inválido en `/api/game/daily-loop` se trata como anónimo (200 público) en vez de 401; mismo patrón que `/api/game/season`.
5. El limitador (`app_rate_take`) es la única escritura del GET y es de infraestructura (ya en todas las rutas con sesión); RLS/PostgREST/`app_rate_take` reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
6. Telemetría del vestíbulo: no-op honesto (`FLOWS` = 4); «home vista» y «CTA usado» quedan sin medir.
7. Sin resumen de sesión ni «jugador que vuelve»: no hay fuente fiable (`last_login`, ventana de adquisición), se omite.
8. `schema_migrations` sigue sin reflejar 0026–0051.
