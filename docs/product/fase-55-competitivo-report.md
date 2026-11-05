# FASE 55 — COMPETITIVO 4.0 · Ranked, rating, rangos y clasificación

Fecha: 2026-09-23 · Rama `arch/stabilization` · sin commit, sin push, sin deploy · 0 migraciones.

## 1. Estado anterior del competitivo

Ya existía un ranked **real y server-authoritative** (bloques 7.2–7.6 + Fase 28):

| Pieza | Estado antes de F55 |
|---|---|
| Cola `duel_pvp_queue` + RPC `duel_pvp_enqueue/claim_pair/commit_pair` (0032) | Funciona. Solo humanos. |
| Rating Elo `duel_pvp_ratings` + libro `duel_pvp_rating_events` (0033) | Funciona. |
| Liquidación `duel_pvp_settle_match` (0033/0034/0035), llamada por el servicio PvP al terminar | Funciona, idempotente. |
| Arena `/duelos/pvp` (antesala, cola, arena, resultado con rating antes→después) | Funciona; la búsqueda y el «rival encontrado» eran un texto de carga. |
| Hub `/duelos/competitivo` (Fase 28): rating, escalera top/alrededor, historial, detalle, perfil | Funciona, con aspecto de panel; **bug**: la escalera del hub traía 1 sola fila (ver §15). |
| `/competitivo` | No existía. |
| Tiers/divisiones del rating | **No existen** (decisión F28 con contrato «sin tiers inventados»). |
| `src/competitive/` (ligas Hierro→Campeón, MMR 1500) | Motor **congelado** (docs/FROZEN.md) del juego táctico 5v5, sin consumidores. No es de los duelos. |
| Rangos Bronce…Nexus (`domain/progression/rank.ts`) | Existen, pero sobre `profiles.points` (Pick'ems + duelos contra el bot), no sobre el rating PvP. |
| Recompensas | Solo el **carril competitivo del pase** (6 hitos, 26.000 créditos + 6 sobres), abierto por puntos de rango ≥ 400 (Oro). El rating no da recompensas. |
| Cierre/reset de temporada del rating | No existe. |

Qué era solo UI: nada del rating; todo cambio de rating lo decide SQL. Qué faltaba: centro competitivo claro,
CTA de juego con la puerta del mazo, búsqueda/rival encontrado honestos, ceremonia de ascenso/descenso,
clasificación paginada, integración con la temporada.

## 2. Arquitectura encontrada (y reutilizada)

`/competitivo` → `GET /api/game/competitive` (`services/competitive.ts`, solo lectura) · JUGAR → `/duelos/pvp?buscar=<deckId>` →
`POST /api/game/duel/matchmaking {enqueue, deckId}` → emparejador por tráfico (RPC atómicas, `for update skip locked`) →
`createPvpMatch` (motor `duel-turns-2`/`duel-combat-2`) → `/api/game/duel/pvp` (acciones con `actionId` + `expectedVersion`) →
al quedar terminal, `settleTerminalMatch` → `duel_pvp_settle_match` → `?outcome=1` lee el asiento. **No se construyó ningún sistema paralelo.**

## 3. Sistema de rangos real

El rating PvP **no tiene tiers**. Inventar «Oro II» sobre el Elo habría sido una escalera nueva (y contradice el contrato F28);
aplicar los rangos por puntos (umbrales 0–4000 pensados para Pick'ems) al Elo 1000 no significa nada; y el motor de ligas
está congelado y es de otro juego. Por tanto, en F55 **el rango ranked es la escalera real**:

- **Sin clasificar** (0 partidas) → **Colocación** (1–9 partidas, K 40, 10 muescas en el emblema) → **Clasificado** (≥ 10, K 24).
- «Rango anterior → actual → siguiente» = puesto de detrás → tu puesto → puesto de delante, con sus ratings persistidos y
  «+N de rating para superar a X» (`pointsToAbove`, calculado en el servidor). #1 con corona dorada.
- Identidad visual propia (escudo SVG + galones, sin assets externos ni logos de otros juegos): `LadderEmblem`.

**Decisión de producto pendiente (no la tomé):** si se quieren tiers con nombre sobre el rating, hay que diseñarlos
(umbrales para Elo 1000) y rescindir el contrato F28. Queda documentado, no simulado.

## 4. Rating real y fórmula

Elo en SQL (`duel_pvp_settle_match`): inicial **1000**, límites 0–5000, `delta = round(K · (score − expected))`,
`expected = 1 / (1 + 10^((rb − ra)/400))`, **K 40** con < 10 partidas y **K 24** después; empate 0,5; abandono/tiempo
= derrota de quien cerró. Verificado en vivo: 1000 vs 1000, victoria → +20 / −20 (K 40).

## 5. Requisito de desbloqueo

**La cola ranked no tiene requisito de puntos ni de rango** (inspeccionado: `duel_pvp_enqueue` y el servicio no leen puntos).
La puerta real es: sesión + mazo legal propio + no tener otra partida PvP viva (`ACTIVE_MATCH`). El «78 / 400» de F52 es el
**carril competitivo del pase** (puntos de rango ≥ `competitiveMinPoints` = 400 = Oro); se muestra como tal, con los puntos
reales del servidor y «cómo desbloquearlo» (duelos contra el bot y Pick'ems). Nada de 400 escrito en la pantalla (test H3).

## 6. Flujo final de JUGAR

`/competitivo` (JUGAR COMPETITIVO con tu mazo legal) → 1 clic → `/duelos/pvp?buscar=` entra en cola sola (valida y limpia la URL;
recargar no re-encola) → **BUSCANDO RIVAL** (radar, tu rating, ventana real ±150/±300/±600/cualquiera según la espera,
jugadores por delante, «no tiene bots», aviso de poca gente y caducidad a los 10 min, cancelar) → **RIVAL ENCONTRADO** (~1,8 s,
tú vs rival con nombre/avatar/rating/puesto públicos; se cierra solo, con «Empezar», Intro o Esc) → partida (sin intro
duplicada, rótulo «Ranked · rating en juego · contra X · jugador real») → **VICTORIA/DERROTA** → rating antes → después con el
delta del asiento → ceremonia **ASCENSO / DESCENSO / CLASIFICADO / ENTRAS EN LA ESCALERA** → «Buscar otro rival» (re-encola
directamente con el mismo mazo) o «Volver a Competitivo».

## 7. Qué rival utiliza realmente

**Una persona**, siempre. La cola ranked empareja dos entradas de `duel_pvp_queue`; no hay bots ni relleno (0032 sin «bot»,
comprobado también en la función viva). La UI lo dice antes de jugar, durante la búsqueda y en el VS.

**Hallazgo importante:** en la BD real, a 2026-09-23, **solo la cuenta demo tiene cartas** (353) y mazo; el resto de cuentas
tienen 0 cartas tras el reemplazo del catálogo del 21-09. Antes de F55 había **0 partidas PvP jugadas**. Con la población actual,
la búsqueda de la cuenta demo no encontrará a nadie salvo que otra cuenta con mazo busque a la vez. La pantalla lo cuenta
honestamente (aviso tras 60 s). No se añadió un bot para disimularlo.

## 8. Validación de mazo

Sin reglas nuevas ni simplificadas: la marca `valid` y los mensajes vienen del validador canónico del servidor
(`/api/game/duels`, 10 cartas, 2 por rol, sin duplicados de carta ni de jugador, propiedad de las instancias) y la cola
**revalida** en la misma transacción que el INSERT. El centro muestra exactamente qué falta («El mazo debe tener 10 cartas:
te faltan 2», «Necesitas 2 cartas de Centinela…») con **EDITAR MAZO** que abre ese mazo (`/duelos/mazos?deck=`), o **CREAR MAZO**.

## 9. Resultado y actualización de rating

El cliente nunca envía resultado ni rating: el ganador lo decide el motor en el servidor y el delta la liquidación SQL; la
pantalla lee `?outcome=1` (antes/delta/después) y, mientras no hay asiento, dice «Calculando el rating…». E2E real: A 1000 → **1020 (+20)**,
B 1000 → **980 (−20)**; el historial de ambos muestra el mismo asiento; el detalle de B, también.

## 10. Idempotencia / concurrencia

- Índice único `(match_id, user_id)` + `on conflict do nothing` + `if inserted <> 2` + filas bloqueadas `for update`.
- Sonda en BD viva (BEGIN/ROLLBACK, usuarios sintéticos, 0 restos): 1.ª liquidación `SETTLED`; 2.ª `ALREADY_SETTLED` con 2 asientos;
  partida en curso `NOT_FINISHED`; duelo privado `NOT_PVP`; partida inexistente `NO_MATCH`.
- E2E: repetir la misma acción (mismo `actionId`) → 200 sin avanzar la versión (1 → 1); pedir el resultado dos veces → idéntico.
- Doble pestaña / refresh: la cola es por usuario (índice único parcial), el estado de partida viene del servidor y
  `?buscar=` se usa una sola vez.

## 11. Ascensos / descensos

Por PUESTO en la escalera, con dos fotos del servidor (antes de jugar y tras liquidar): ascenso si ganas puestos, descenso si
los pierdes (se dice con la misma claridad, sin protección de rango porque no existe), entrada en la escalera con la primera
partida y «Clasificado» al cerrar la colocación. Sin foto previa (recarga a mitad) no se afirma movimiento.

## 12. Historial

Últimas 5 en el centro (palabra + letra, rival público, fecha, antes→después, marcador persistido) y enlace al detalle ya existente;
historial completo paginado por cursor (F28). Nada reconstruido: si una partida no tiene asiento, se dice «Sin cambio de rating».

## 13. Leaderboard

Global (el único ámbito que tiene el rating), 25 por página (servidor acota a ≤ 50; `?ladder=1&offset=`), «Ir a mi posición»,
fila propia con `aria-current` y «← tú», marca «prov.» en colocación. Columnas: posición, jugador, rating, partidas, victorias.

## 14. Integración con Temporada

Misma fuente: el competitivo lee la temporada por `loadSeasonCalendar()` (el contrato «una sola fuente» de F34 lo exige) y el
récord de temporada **reutiliza `rankedRecap`**, la misma función que `/temporada`. `/competitivo` → «Temporada actual» (nombre,
días restantes, partidas, V·D·E, neto, mejor rating de la temporada) → «Ver temporada». `/temporada` → «Ver competitivo» y
«Jugar ranked» → `/competitivo`. **Cierre de temporada: no existe** — el rating no se reinicia; se muestra «tu rating continúa
entre temporadas» (`resetsRating: false`). No se simuló nada.

## 15. Vulnerabilidades / bugs encontrados y corregidos

- **Bug real (F28):** `GET /api/game/competitive` sin `?top` hacía `Number(null) = 0` → `clampLimit` → **top de 1 fila**
  (y lo mismo para `?history` sin `limit`). Corregido en la ruta; test P4.
- Seguridad verificada sin hallazgos explotables: RPC de cola/liquidación ejecutables solo por `service_role`; RLS activo y sin
  políticas ni grants a `anon/authenticated` en ratings/libro/cola; con rol `authenticated` se deniega liquidar, `update` de
  rating e `insert` de asientos; ninguna ruta lee `winner/rating/delta/opponent/userId/side/score/result` del cuerpo (test S2);
  rating falso en la cola ignorado (sellado 1000); campos falsos en una jugada ignorados; `matchup` 401 sin sesión, 400 id
  inválido, 404 a no participantes; 0 correos en todas las respuestas del E2E.
- Nota de privacidad: las filas públicas llevan el `userId` porque es el identificador de la ruta pública canónica
  `/jugador/[id]` (Fase 31); no hay handle público alternativo. Sin correo, sin datos de cuenta.

## 16. Persistencia / migraciones

**0 migraciones** (cabeza 0054). Se reutilizan `duel_pvp_ratings`, `duel_pvp_rating_events`, `duel_matches`, `duel_pvp_queue`.

**Datos persistidos en la BD real por esta fase (solo cuentas QA; la cuenta demo NO se tocó):**
- QA `8c326e52` (qa_campaign_352): 4 Sobres Estándar comprados y abiertos con sus créditos (6.570 → 3.570), 20 cartas, mazo «QA F55 Ranked»,
  1 partida ranked ganada (rating 1020, #1), 2 entradas de cola (una emparejada, una cancelada).
- QA `1ff2c0ef` (qa_f45): 3 Sobres Estándar (7.260 → 5.010), 15 cartas, mazo «QA F55 Ranked», 1 partida perdida (980, #2), 1 entrada de cola.
- 1 fila `duel_matches` PVP `e405a857-a3b0-47f2-a1ea-46df903be5d7`, 2 filas de rating, 2 asientos, filas de límite de frecuencia.
- Consecuencia visible: la clasificación global muestra ahora 2 jugadores (las dos cuentas QA). Si se prefiere retirarlas, es un
  borrado dirigido que no he hecho sin tu permiso.

## 17. QA visual

`docs/product/qa/fase55-competitive/` — 24 escenas del arnés `/design-system/fase55` (QA SYNTHETIC, partidas simuladas con el motor real)
+ matriz responsive `r-*` (centro, resultado con ascenso, búsqueda y VS a 1920/1440/1366/1024/768/390) = 48 capturas, **0 desbordes y
0 errores de consola** (`shots.json`). Capturas reales con sesión QA en `live/` (centro real #1, móvil, búsqueda real, detalle de la
partida E2E) con `live.json`. Instrumentos fuera de CI: `scripts/_fase55-shots.ts`, `_fase55-live-shots.ts`, `_fase55-live-e2e.ts`,
`_fase55-qa-prep.ts`.

## 18. Tests antes / después

Antes: **4861 / 4861**. Después: ver §19 (nuevos: `ranked.test.ts` 21, `f55.competitive.contract.test.ts` 22, `ranked.render.test.tsx` 14).
Contratos reescritos (no debilitados): F28 «integración» (la puerta es `/competitivo` y el alias redirige) y `UI_FILES`/`PVP_UI` con las
tres piezas nuevas de `components/duel/pvp`.

## 19. Types / lint / build

| Gate | Resultado |
|---|---|
| `npm test` | **4920 / 4920 PASS** (baseline 4861 → +59: 57 en los tres ficheros nuevos de F55; los otros 2 no los he atribuido a un fichero concreto) |
| `tsc` web | 0 errores |
| `tsc` scripts | 0 errores |
| `eslint src` | 0 errores, 10 advertencias **preexistentes** (admin, cuenta, layout, PackOpeningExperience, usePvpSync; ningún fichero de F55) |
| `npm run build` | **SIN VERIFICAR en la versión final.** Los builds de producción anteriores con todo el código de F55 terminaron con exit 0 (build 1 y build 2). El build final, que solo añadía el arreglo de 2 líneas de §15 en la ruta, **lo mató Claude Code por falta de memoria del sistema** durante «Running TypeScript» (worker con código 3221225794). `tsc` web del mismo código pasa. Queda `.next` incompleto: hay que volver a lanzar `npm run build`. |

## 20. Catálogo

331 cartas (test R1). Sin cambios.

## 21. Economía

Sin cambios de código (PvP sigue `NON_ECONOMIC`, 0 créditos; test R3). Única actividad económica: las compras de sobres de las cuentas QA
por la tienda normal (§16).

## 22. Marketplace / Payments

`GLOBAL_MARKET_ENABLED = false`, `PAYMENTS_ENABLED = false` (test R2).

## 23. Archivos

Nuevos: `src/app/competitivo/page.tsx`; `src/components/competitive/ranked/{LadderEmblem,RankedHero,RankedPlayPanel,SeasonStrip,RecentMatchCards,RankedLadder,RankedCenter}.tsx`
+ `ranked.render.test.tsx`; `src/components/duel/pvp/{RankedSearch,RankedMatchFound,RankedMovement}.tsx`; `src/domain/pvpLadder/{ranked.ts,ranked.test.ts,f55.competitive.contract.test.ts}`;
`src/app/design-system/fase55/{page.tsx,fixtures.ts}`; `scripts/_fase55-*.ts`; este informe; capturas.

Modificados (parches dirigidos): `server/services/competitive.ts` (temporada, `?ladder`, `?matchup`, `gamesPlayed` en la posición),
`app/api/game/competitive/route.ts` (dos lecturas + bug §15), `lib/competitive/client.ts`, `app/duelos/pvp/page.tsx`, `components/duel/pvp/{PvpOutcome,PvpArena}.tsx`,
`app/duelos/competitivo/page.tsx` (redirección), enlaces en `design/nav.ts`, `app/duelos/page.tsx`, `components/progression/MetaHub.tsx`,
`components/season/SeasonPanels.tsx`, `app/duelos/competitivo/{historial,partida}`, `design/{environment,gameShell}.ts`; tests
`lib/duel/duel.test.ts`, `domain/pvpLadder/competitive.contract.test.ts`; fixture `design-system/fase28/fixtures.ts` (`season: null`).

## 24. GO / NO-GO

**GO condicionado a un único gate pendiente: `npm run build` en la versión final.** El bucle ranked funciona de punta a punta
en la BD real (partida E2E entre dos cuentas QA: cola → emparejamiento → partida con el motor actual → liquidación en el servidor
→ historial, escalera y temporada), el rating no se puede falsificar desde el cliente (sonda SQL + E2E + tests), la liquidación es
idempotente y el rival es siempre humano y se presenta como tal. Todos los demás puntos de la definición de hecho se cumplen,
con dos matices documentados: los rangos con nombre sobre el rating no existen (decisión de producto pendiente, no inventada) y
la población real actual (solo la cuenta demo tiene cartas) hace que una búsqueda en solitario no encuentre rival.
