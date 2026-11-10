# Contrato del Live Service — Fase 42 «Today. This week. This season.»

> Canónico. Código: `src/domain/liveService/` (vista temporal pura), `src/domain/progression/rotation.ts` (rotación pura),
> `src/domain/dailyLoop/index.ts` (única prioridad del vestíbulo), `src/server/services/dailyLoop.ts` (lectura),
> `src/server/services/duelCap.ts` (tope PvE atómico). Mapa máquina: `docs/product/qa/fase42/live-service-map.json`.
> Verificadores: `npm run live-service:verify` (+ `-time`, `-priority`, `-security`, `-returning`, `-performance`).

## 1. Preguntas que responde el vestíbulo

| Pregunta | Respuesta (campo de la foto `GET /api/game/daily-loop`) |
|---|---|
| ¿Por qué abro NEXUS hoy? | `primaryAction` + `primaryAction.reason` («por qué esto») |
| ¿Qué caduca? | `service.expiring` (≤ 3, solo `endsAt` real con urgencia SOON/VERY_SOON, o temporada ≤ 7 d) |
| ¿Qué completo hoy / esta semana? | `service.today` (≤ 3) · `service.thisWeek` (≤ 2) con `resets.dailyEndsAt` / `weeklyEndsAt` |
| ¿Qué pasa en el VCT? | `live.featured` / `live.upcoming` (datos del worker; demo marcado, nunca recomendado como directo) |
| ¿Vuelvo tras 5 días? | `service.returning` (≥ 1 día sin actividad real, ≤ 3 hechos verdaderos, sin recompensa) |
| ¿Ya terminé las misiones? | `service.dailyDone` / `weeklyDone` → acción evergreen (campaña, competitivo, partida rápida) |

Bucle: entro → foto (qué importa) → CTA única → juego → «Qué sigue» (`NextUpAfter`, misma foto) → siguiente acción o «Volver al lobby».

## 2. Mapa (resumen; el detalle por campo está en `LIVE_SERVICE_MAP`)

| Sistema | Alcance | Ventana / reset | Verdad | Autoridad | Acc. | Recl. | Cad. | Rec. | Econ. |
|---|---|---|---|---|---|---|---|---|---|
| Diarias | jugador | 00:00 UTC | `user_pass.state` + `resolvePassWindows` | servidor | ✓ | ✓ | ✓ | ✓ | ✓ |
| Semanales | jugador | lunes 00:00 UTC | ídem | servidor | ✓ | ✓ | ✓ | ✓ | ✓ |
| Temporada | global | `SEASON_CALENDAR` | calendario | servidor (datos) | ✓ | – | ✓ | – | – |
| Pase | jugador | temporada | `user_pass` | servidor | ✓ | ✓ | ✓ | – | ✓ |
| Eventos en directo | global | fechas VLR | `events/matches` | worker | ✓ | – | – | – | – |
| Pick'ems | jugador/global | `locks_at` por pregunta | `pickem_*` | worker + servidor | ✓ | ✓ | ✓ | – | ✓ |
| Desafíos de evento | jugador | evento | `event_challenge` refs | servidor | ✓ | ✓ | ✓ | – | ✓ |
| Campaña | jugador | sin fin | `campaign_progress` | servidor | ✓ | – | – | – | ✓ (una vez) |
| Run de Draft | jugador | hasta cerrar | `draft_runs` | servidor | ✓ | – | – | – | – |
| Partida PvP / privada | jugador | timeout del modo | `duel_matches` | servidor | ✓ | – | ✓ | – | – |
| Tope PvE diario | jugador | 00:00 UTC | `economy_ops duelcap:*` | servidor | – | – | – | ✓ | ✓ |
| Sobres | jugador | – | `user_packs` | servidor | ✓ | – | – | – | ✓ |
| Logros | jugador | – | `user_achievements` | servidor | ✓ | ✓ | – | – | ✓ |
| Contexto de vuelta | jugador | derivado | libro mayor, aperturas, partidas, `last_seen_at` | servidor | – | – | – | – | – |

## 3. Tiempo

- **Autoridad:** el servidor. La foto lleva `serverNow`; el cliente estima `serverNow + (reloj local − recibido)` (`estimateServerNow`) y solo **pinta** cuentas atrás. Ninguna ruta acepta hora, zona ni usuario: `GET /api/game/daily-loop` con cualquier parámetro → 400; meta/loop no leen query ni cuerpo.
- **Reset diario:** 00:00 UTC (`periodWindow("daily")`). **Semanal:** lunes 00:00 UTC. Aritmética UTC pura (sin `getHours`, `toLocale`, `Intl` en ventanas/rotación/vista).
- **Zona horaria:** la del jugador no existe para el juego; cambiar la zona del dispositivo no cambia ventanas ni permite una segunda diaria (la clave del reclamo es `mission:<season>:<id>:<assignedAt>:<baseline>` con `assignedAt` = inicio de ventana UTC).
- **Reloj desviado:** −5 min / +5 min / −2 h / +2 h → misma cuenta atrás (el desvío se cancela con `receivedAt`). Probado en la matriz (L084–L087), el arnés (`clock-ahead`/`clock-behind`) y el fuzzer temporal (`client_skew`).
- **Reset con la home abierta:** el cliente programa una recarga en la **siguiente frontera real** (`nextBoundary`: reset diario/semanal o caducidad de la foto) + 2 s de gracia, además del refresco cada 60 s y al volver a la pestaña (`visibilitychange`). La lectura tras el reset ya devuelve la tanda nueva sin escribir.
- **Varios resets sin entrar:** la rotación es función de (usuario, temporada, tipo, inicio de ventana): 14 días fuera = 3 diarias vigentes (no 42).

## 4. Rotación pura (lectura ≠ materialización)

- `resolvePassWindows(state, now, métricas, eventos desde el inicio de ventana)` → estado vigente, **idempotente**.
- Tanda determinista `batchFor(pool, userId, seasonId, kind, windowStart)` (semilla FNV): dos pestañas, dos servidores o dos lecturas obtienen la misma tanda.
- Baseline anclada: progreso = eventos reales desde el inicio de la ventana (`duel_matches.updated_at`, `economy_ops open_pack`, `pickem_answers`, primeras cartas por `obtained_at`), se lea cuando se lea.
- **Lecturas** (`GET meta`, `GET loop`, `GET daily-loop`, home): `peekProgression` → cero escrituras, ni ficha de rating (`readCompetitivePosition`).
- **Mutaciones** (`claimMission`, `claimPassLevel`, `refreshMissions`, `POST progression state`): `ensurePass` materializa con concurrencia optimista (`savePass` con `updated_at`, `PassConflictError`). Dos materializaciones simultáneas tras un reset → una tanda, sin híbrido.
- No hay segundo sistema de misiones: la definición sigue en `CURRENT_SEASON.missionPool`.

## 5. Prioridad (una sola: `orderToday` / `todayRank`)

`resume` 0 (ranked > privada > campaña > PvE > Draft combate) · `ftue` 0,5 · `run` Draft fuera de combate 0,7 · `challenge` 1 · **caduca muy pronto** (predict/objective/claim con urgencia VERY_SOON) 1,5 · `claim` 2 · `predict` 3 · `objective` 4 · `open` 5 · `build` 6 · `play` (campaña/competitivo/rápida) 7 · `explore` (directo real) 8.

- Una partida activa nunca pierde el primer puesto (fuzzer: mutación `active-match-lost` → 79.544 violaciones detectadas).
- Urgencia solo con `endsAt` real y futuro: NORMAL (> 12 h), SOON (≤ 12 h), VERY_SOON (≤ 2 h) (mutación `fake-urgency` → 100.000 detectadas). Texto + nivel, nunca solo color.
- Cada acción lleva `reason` que no repite su detalle (test sobre 2.000 combinaciones).
- «Ver en directo» solo con un evento **no demo**, ACTIVO y con partido en directo (bug de QA real, §10).

## 6. Hub «Hoy»

Héroe con CTA única + razón + chip de plazo (solo SOON/VERY_SOON) · «Termina pronto» (≤ 3) · «Hoy» y «Esta semana» separados, cada uno con su «Se renueva en …» · estados CLAIMABLE / CLAIMED / IN_PROGRESS con recompensa real de la definición · el reclamo enlaza a Logros (servicio canónico, **sin «Reclamar todo»**) · completadas → «El juego sigue: campaña, Draft, competitivo o partida rápida».

## 7. Vuelta

- `lastActivityAt = max(último asiento del libro mayor, última apertura, última partida, profiles.last_seen_at)` — sin migración; `last_seen_at` solo lo escribe el latido social existente, el vestíbulo **solo lo lee**.
- Umbral 1 día; horizontes probados 0 h / 6 h / 1 / 3 / 7 / 14 / 30 días (100.000 estados).
- «De vuelta en NEXUS» con ≤ 3 hechos verdaderos AHORA, en orden: partida abierta, run de Draft, Pick'em que cierra, recompensas por reclamar, semanal a medias (si la semana no cambió), diarias/semanales nuevas, evento en directo real, fin de temporada.
- **Sin** recompensa por volver, racha, calendario de login, moneda de recuperación ni diarias acumuladas. La semanal a medias continúa si la semana no cambió.

## 8. Después de jugar (`NextUpAfter`)

Partida rápida, campaña, ranked, privada, sobre y Draft. Pide la MISMA foto (sin escrituras) y enseña ≤ 2 objetivos relacionados (duelos ↔ partidas; sobres/cartas ↔ sobre; Draft = 0 economía, solo su fase), la acción principal del servidor con su razón (omitida si es la pantalla actual) y siempre «Volver al lobby».

## 9. Economía y seguridad

- **Cero cambios de importes.** Recompensas, precios y tablas intactos.
- **Tope PvE atómico** (P0 por concurrencia): cupos `duelcap:<uid>:<AAAA-MM-DD>:<k>` en `economy_ops` (PK global) + `duelcap:m:<matchId>` para reintentos; 40 liquidaciones simultáneas → 20 pagadas. Límite conocido: dos liquidaciones de la MISMA partida a la vez pueden gastar dos cupos (el jugador pierde uno, nunca cobra de más).
- **Pick'em recorregido:** `pickemTierDelta` paga créditos/XP menos lo ya pagado por niveles inferiores del mismo evento; sobres de niveles inferiores no se repiten. El worker no se toca.
- Reclamos: uno por misión y tanda (clave única del libro mayor); reintento y doble clic → 409, +0.
- La foto no contiene `correct_option`; el resumen de Pick'em del vestíbulo solo lee `id, pickem_event_id, locks_at`.
- Sin Marketplace, trading, venta rápida, crafting, energía, tickets, moneda nueva, anuncios, push ni email.

## 10. Disponibilidad y rendimiento

- Cada subsistema va en su `guard(...)`: si cae, su bloque se marca en `unavailable` y **no se recomienda**; el núcleo (acción, objetivos) sigue.
- Lecturas constantes con los datos (5 vs 500 cartas/partidas → 39 consultas; sin N+1). Foto < 8 KB típica (tope verificado 40 KB), listas acotadas.
- Límite de lectura `daily_loop_read` 40/min: infraestructura (contador de rate limit), no estado de juego.

## 11. Telemetría y métricas de retención

No se añade telemetría nueva (la del vestíbulo sigue cerrada/no-op). Métricas **definidas, sin números inventados**, calculables desde datos existentes cuando haya tráfico real:

| Métrica | Definición | Fuente |
|---|---|---|
| D1/D7/D30 de regreso | cuentas con actividad real en el día N tras su alta | libro mayor + `duel_matches` + `economy_ops` |
| Tasa de diarias completadas | misiones diarias cobradas / (3 × jugadores activos del día) | `credit_transactions reason=mission_reward` |
| Semanal completada | ídem semanal (2 por semana) | ídem |
| Sesiones con «una más» | partidas iniciadas < 10 min después de terminar otra | `duel_matches` |
| Vuelta tras ≥ 7 d | cuentas cuya actividad anterior tenía ≥ 7 días | `lastActivityAt` derivado |
