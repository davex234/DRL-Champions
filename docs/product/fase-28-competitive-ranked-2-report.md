# FASE 28 — COMPETITIVE / RANKED 2.0 · Ladder + Match History + Leaderboard + Competitive Profile

**Estado:** completada (con P2 documentados) · **Fecha:** 2026-09-14 · **Rama:** `arch/stabilization` · **Sin commit/push/deploy** · **Sin VPS, cron, Docker, producción** · **Fórmula de rating, liquidación, matchmaking, timeout, anti-replay, motor de duelo, bots, sobres, colección, Pick'ems, progresión, Marketplace (OFF) y worker esports INTACTOS** · **Dos migraciones locales (0046 ampliada, 0047 nueva), NINGUNA aplicada**.

> Regla de la fase: el servidor decide (rating, resultado, liquidación, posición, escalera, recompensas,
> estadísticas persistidas); el cliente muestra. No hay tiers inventados: el competitivo es **rating +
> escalera**, porque eso es lo que el backend tiene.

## 1. Estado inicial

- PvP server-authoritative (`duel_matches` con `mode='PVP'`, `user_id` = A, `player_b_id` = B, `state` jsonb,
  `closed_reason ABANDONED|EXPIRED` + `closed_by`), matchmaking por rating con ventana creciente, timeout por
  Postgres, `actionId` idempotente, proyección `projectMatchFor` (lo no jugado del rival nunca viaja).
- Post-partida (Fase 26) con rating `old → new (+delta)` leído con `?outcome=1`. Meta Hub (Fase 27) con
  rating y partidas. **Sin** hub competitivo, sin escalera por rating, sin historial PvP (el replay PvE
  filtra por `user_id` = A: un jugador B no podía ver su partida), sin perfil de rival, sin cara a cara.
- `/ranking` y `RankBadge`/`RankEmblem` clasifican **`profiles.points`** (Pick'ems + duelos contra el bot):
  tiers bronce…nexus por puntos, no por rating. No se mezclan.

## 2. Rating / ranking real encontrado

- `duel_pvp_ratings(user_id PK, rating, games_played, wins, losses, draws, updated_at)`; inicial 1000, rango
  0–5000; RLS sin políticas (solo servidor); índice `(rating desc)`.
- `duel_pvp_rating_events(match_id, user_id, old_rating, delta, new_rating, opponent_rating, k_factor,
  result WIN|LOSS|DRAW, created_at)` con `unique (match_id, user_id)` y `check new = old + delta`: **el
  libro completo, por partida y jugador** → la evolución de rating es real, no reconstruida.
- Liquidación `duel_pvp_settle_match` (0035): K por jugador (40 provisional < 10 partidas, 24 después),
  abandono/tiempo = derrota de `closed_by`, `ALREADY_SETTLED` si ya hay asientos; la llama el servicio PvP
  tras cada cierre. **Provisional = `games_played < 10`** (semántica real, `PLACEMENT_GAMES`).
- Sin leaderboard por rating en ningún sitio; sin temporada competitiva; recompensas competitivas = carril
  COMPETITIVO del pase (26.000 créditos + 6 sobres premium en 6 hitos), que se abre con **400 puntos de
  rango** (Oro), no con rating.

## 3. Sistemas reutilizados

`duelsRating.ensureRating/getRatingHistory`, `duel_pvp_rating_events`, `duel_matches` PvP, `projectMatchFor`,
`buildMatchView`, `serverCatalog`, `getProgression` (carril competitivo), `listDecks`, `profiles.username/avatar`,
`PvpOutcome`/`PvpLobby`/`usePvpQueue`, `TurnHistory`, `MatchSummary` (destacada, desempate, miniaturas),
`DuelCard`, `FreeTrack.trackState`, `PassRail.describeReward`, `Meter/Badge/Readout/Surface`, `LoopStrip`,
`MetaHub`, telemetría con puerta, `scripts/lib/cdp.ts`.

## 4. Competitive Hub — `/duelos/competitivo`

Una lectura (`GET /api/game/competitive`) → hero (rating, posición, récord, forma, última partida, máximo,
CTA JUGAR RANKED) → alrededor de ti → últimas 5 partidas (+ historial completo) → evolución → recompensas
competitivas → tus cartas → top 25. Puerta nueva en `/duelos` (la de PvP sigue), entrada en la navegación,
enlace desde el Meta Hub y resumen en `/cuenta`.

## 5. Hero

Rating real grande; posición `#N` de `total` o **«Sin clasificar»** (nunca `#0`); `Top N %` solo con
≥ 20 clasificados; récord W–L(–D), winrate, partidas, forma reciente, «Última partida +18», «Máximo 1233»
(del libro), «Te faltan 9 puntos para pasar al #123» (vecino real), provisional con su condición real.

## 6. Provisional / unranked

Provisional = `games_played < 10` (K 40 frente a 24; se sale al liquidar 10 partidas). Sin partidas
liquidadas: sin posición, «Sin clasificar», CTA «Una partida liquidada te pone en la escalera». No se
inventan «placements» ni divisiones.

## 7. Leaderboard

Top 25 (≤ 50) de `duel_pvp_ratings` con `games_played >= 1`, ordenado en SQL, nombres/avatars en UNA
consulta `in(ids)`. Columnas: posición, jugador (enlace al perfil), rating, partidas, victorias. Tabla
semántica en escritorio; lista de tarjetas ≥ 52 px en móvil.

## 8. Around Me

Ventana `[pos−3, pos+3]` leída con `range()` en el mismo orden; la fila propia con `aria-current` y
«← tú»; deduplicada contra el top (`dedupeAround`). Sin posición → mensaje honesto.

## 9. Tie handling

Orden documentado y compartido por SQL y dominio (`compareLadder`): `rating desc → updated_at asc →
user_id asc` (a igual rating, quien lo alcanzó antes va delante; a igual instante, id). La posición se
calcula con tres recuentos acotados (`rating >`, `= y updated_at <`, `= = y user_id <`) + 1. Índice
compuesto en la migración local 0047 (no aplicada).

## 10. Player competitive profile — `/duelos/competitivo/jugador/[id]`

Solo público: nombre, avatar, rating, posición, récord, winrate, forma, últimas 10 partidas (sin cartas)
y cara a cara con quien mira. **Nunca** su mazo actual ni cartas no jugadas (P2: cartas jugadas
públicamente de otro jugador; se deja fuera por prudencia).

## 11. Match history — `/duelos/competitivo/historial`

`duel_matches` PvP donde `user_id = yo OR player_b_id = yo`, solo terminadas (`COMPLETED|DRAW|UNRESOLVED`
o `closed_reason` no nulo), `updated_at desc`, páginas de 10 (≤ 20) por cursor `before`. Cada fila:
fecha, rival (enlace), letra W/L/D, desenlace real (abandono/tiempo nombrados; en curso/sin resolver no
cuentan), marcador, rating antes → delta (asiento), detalle. Sin duración (no se persiste).

## 12. Match detail — `/duelos/competitivo/partida/[matchId]`

Solo los dos jugadores (404 al resto; 409 en curso). `projectMatchFor(state, side)` + `buildMatchView`
desde el bando del espectador: marcador, desenlace, asiento de rating (antes/cambio/después/rating del
rival), motivo, desempate, carta destacada propia, miniaturas turno a turno, `TurnHistory` con las
estadísticas enfrentadas, cartas jugadas por ambos y «N cartas no llegaron a jugarse y siguen ocultas».
**Bug de base corregido de paso**: el replay PvE nunca sirvió a un jugador B; el detalle competitivo
funciona para ambos bandos.

## 13. Rating evolution

SVG propio (sin librería) sobre los últimos 20 asientos (`new_rating` tras cada partida, del más antiguo
al más reciente), puntos verdes/rojos por delta, resumen textual («12 partidas: de 1140 a 1201 (+61),
mínimo…»). Sin asientos: mensaje; con uno: «con una segunda aparecerá». Nada reconstruido.

## 14. Recent form / streak

`recentForm` = últimas 10 letras reales (más reciente primero); `streak` derivada (≥ 2 = «3 victorias
seguidas»); winrate = victorias / partidas terminadas con desenlace (de `duel_pvp_ratings`, que solo
cuenta liquidadas). Sin racha de login.

## 15. H2H

Partidas terminadas donde ambos son los dos jugadores (`and(user_id, player_b_id)` en los dos sentidos,
≤ 50), contadas desde mi perspectiva: «2 – 1 en 3 partidas». Solo entre los dos.

## 16. Card performance

Sobre mis últimas 10 partidas (una lectura de `state->turns`), solo mi bando de cada turno: carta más
usada y carta con más turnos ganados. Personal; sin winrates globales (P2).

## 17. Post-match integration

`useLadderPositionDelta`: foto `?position=1` al entrar en la partida y otra cuando llega el asiento
(`outcome.event`). `PvpOutcome` enseña `#182 → #169 · Subes 13 puestos` **solo con las dos fotos**; si
no hay foto previa, solo la posición actual; sin partidas, «Sin clasificar». El rating sigue siendo el
asiento (`old → new`, `outcome=1`), nunca una estimación.

## 18. Matchmaking UX

Sin tocar el algoritmo. «Ranked · Duelo PvP» al buscar, rating y tiempo (ya existían), cancelar; al
emparejar «Rival encontrado · preparando la arena…»; al volver por URL «Recuperando la partida…». Sin
«calidad de partida» (no existe la métrica).

## 19. Competitive rewards

Únicamente el carril competitivo del pase: 6 hitos (5/10/15/20/25/30) = 26.000 créditos + 6 sobres
premium, se abre en Oro (400 puntos de rango), reclamo manual en «Logros y pase». Track con estados
Bloqueado / Disponible / Conseguido por autoridad real (`trackState`). El rating PvP no da recompensas y
se dice. Nada nuevo.

## 20. Season / placements

Sin temporada competitiva (no existe): el hub funciona sin ella. Provisional = 10 partidas reales.

## 21. Home / meta / profile integration

Home: `loop.competitive` (rating + posición, una lectura en `getLoop`) → tarjeta «Sube en ranked» con
`competitiveHint` («Estás #124 de 500» / «Provisional: 4 de 10…»); nunca promete posición tras una
victoria. Meta Hub: la tarjeta Competitivo enlaza «Estás #N en ranked →». `/cuenta`: `CompetitiveSummary`
(rating, posición, récord, enlace). `/ranking` (puntos) queda como está.

## 22. Read model / API

`services/competitive.ts` → `CompetitiveSnapshot { self, stats, leaderboardTop, aroundMe, recentMatches,
nextBefore, ratingSeries, cards, rewards }`, `getCompetitiveHistory`, `getCompetitiveMatch`,
`getCompetitivePlayer`, `getCompetitivePosition`. `GET /api/game/competitive` (`?top`, `?history&before`,
`?match`, `?player`, `?position`). Sin POST; sin `setRating`. Cliente `lib/competitive/client.ts`.

## 23. Queries / indexes

Todas acotadas: top `range(0, N)`, alrededor `range(pos−4, pos+2)`, historial `limit+1`, cara a cara
`limit 50`, cartas 10 partidas, tres `head` counts para la posición, perfiles por `in(ids)` (sin N+1).
Índices existentes: `(rating desc)`, `(user_id, created_at desc)` en eventos, `(player_b_id, status)`.
**Migración local 0047 (NO aplicada)**: `(rating desc, updated_at asc, user_id asc) where games_played >= 1`
y `(user_id|player_b_id, updated_at desc) where mode='PVP'`.

## 24. Privacy

De otros: `username`, `avatar`, rating/partidas/W-L-D, forma, cara a cara. Nunca correo, XP, créditos,
`is_admin`, mazos, cartas no jugadas. Detalle solo para participantes y proyectado. El rating oculto no
existe (hay uno solo, público en la escalera).

## 25. Security

Ruta solo GET con Bearer; UUIDs validados; el servicio no tiene `rpc/insert/update/upsert/delete` (solo
`ensureRating`, la RPC de siempre que crea la ficha vacía); IDOR de partida → 404 (`NOT_A_PLAYER`); sin
clave de servicio en cliente; límites acotados; consultas parametrizadas por supabase-js (sin SQL a mano).
Tests 36–43.

## 26. Concurrency

Una liquidación por partida (`unique (match_id, user_id)` + `on conflict do nothing` + `inserted <> 2`);
el competitivo no liquida nunca; la escalera lee el rating persistido tras la liquidación; la foto de
posición «después» espera al asiento.

## 27. Telemetry

Contrato cerrado. `trackCompetitive` con seis contextos (`competitive_view`, `leaderboard_view`,
`history_view`, `match_detail_view`, `queue_start`, `queue_cancel`) y puerta `isFlow("competitive")`:
hoy no-op. 0046 (local, NO aplicada) reserva `competitive` junto a `duel_play` y `progression`.

## 28. Mobile

390: hero (cifras en fila, forma debajo) → JUGAR RANKED → alrededor de ti (tarjetas ≥ 52 px) → últimas
partidas → evolución → recompensas (scroll/snap) → cartas → top como lista. Sin tabla comprimida.

## 29. Accessibility

Tabla con `scope="col"` en escritorio, `<ol>` en móvil, `aria-current` en la fila propia y «← tú»
textual; tendencia con `+/−` y «Subes N puestos»; gráfico `role="img"` + `figcaption`; foco visible;
`useReducedMotion` en el gráfico; sin `aria-live` de rating.

## 30. Performance

Snapshot: ~10 consultas en paralelo, todas acotadas, una sola lectura del pase; historial paginado;
`no-store` (la posición propia se revalida al instante). Caché corta del top: P2 (no hay capa de caché).

## 31. QA

28 escenarios cubiertos por escena del arnés `/design-system/fase28` o por test: nuevo (`03`),
provisional (`02`), clasificado (`01`), top 10 (`23`), fuera del top / alrededor (`06`), mismo rating
(`07`), victoria/derrota/empate y rating ± (`08`, `13`, `14`, `15`), historial vacío/lleno (`09`, `08`),
detalle (`10`, `11` tiempo), perfil rival + H2H (`12`), recompensas (`17`, `18`), matchmaking (`19`),
reconnect (`27`/texto), timeout (`11`, `16`), cancelled (no existe como estado de partida: los cierres
reales son abandono y tiempo; documentado), móvil (`-390`), reduced motion (`25`, `26`), backend error
(`22`), población pequeña (`20`, `21`), sin posición (`03`). **42 capturas** en
`docs/product/qa/fase28/` + README (índice generado). La QA visual destapó dos cosas y se corrigieron: la
escalera del arnés era incoherente (vecinos a 900) y las cifras del hero se apilaban en 390 (ahora en fila).

## 32. Tests / gates

- Nuevos: `ladder.test.ts` 19 · `competitive.contract.test.ts` 21 = **40** (escalera 1–10, historial 11–20, estadísticas 21–29, post-partida 30–35, seguridad 36–43, regresión 44–55, telemetría y accesibilidad; los números del brief cubiertos por uno o más tests).
- Modificados: ninguno.

| Gate | Resultado |
|---|---|
| `npm test` | **1415 / 1415** (1375 previos + 40 nuevos), 0 fallos |
| `tsc -p tsconfig.json` | 0 errores |
| `tsc -p tsconfig.scripts.json` | 0 errores |
| `next build` | OK (`/api/game/competitive`, `/duelos/competitivo{,/historial,/partida/[id],/jugador/[id]}`, `/design-system/fase28`) |
| `eslint` (27 ficheros de la fase) | 0 errores (1 aviso preexistente en `cuenta/page.tsx`) |
| `security:verify` · `pack:verify` · `content:verify` · `distribution:verify` · `competitive:verify` · `importer-vlr:verify` | exit 0 |
| Suites PvP/rating/escalera (`duel.test`, `pvpPoller.test`, `pvp.test`, `gameplay.contract`, `ladder`, `competitive.contract`, `rank.test`) | verdes dentro de `npm test` |
| `pvp-rating:verify`, `pvp-rating-settlement:verify`, `pvp-arena:verify`, `pvp-matchmaking:verify`, `pvp-timeout:verify` (BD) | **no ejecutados**: exigen Supabase local (Docker desinstalado); no se apuntan a producción |
| Capturas | 42 PNG (1440/1024/390) + README, 0 errores de consola propios |

## 33. Bugs reales encontrados / corregidos

1. **Un jugador B no podía ver sus partidas PvP terminadas** (el replay PvE filtra por `user_id` = A y
   asume «yo = A»): el detalle competitivo se sirve para ambos bandos desde su lado. El replay PvE queda
   como estaba (P2 abajo).
2. La primera versión del arnés QA tenía una escalera incoherente (vecinos a 900 con self a 1201): corregida.

Ninguna fórmula, pago, liquidación ni regla cambia.

## 34. P2 reales

- **Replay PvE** (`getReplay`) sigue filtrando por A y sin filtro `mode`: no sirve a B y, si un A pidiera
  el replay de una PvP terminada, expondría el mazo completo de B. Debería redirigir a `?match=` o proyectar.
- **Caché corta del top** y **percentil** con población pequeña (< 20): sin caché y sin percentil por diseño.
- **Cartas jugadas públicamente de otros jugadores**: no se enseñan (privacidad prudente).
- **Winrates globales de cartas**: dataset pequeño; solo estadística personal.
- **Duración de partida**: no se persiste; no se enseña.
- **Telemetría**: 0046 sin aplicar → `trackCompetitive` no-op.
- **Índices 0047** sin aplicar: la escalera ordena bien pero sin índice compuesto con población grande.
- **Verificadores con BD** (`pvp-*:verify`) no ejecutados (sin Supabase local).

## 35. Archivos

Creados: `src/domain/pvpLadder/{ladder.ts,ladder.test.ts,competitive.contract.test.ts}`,
`src/server/services/competitive.ts`, `src/app/api/game/competitive/route.ts`, `src/lib/competitive/{client,telemetry}.ts`,
`src/components/competitive/{CompetitiveHub,CompetitiveHero,Leaderboard,MatchHistoryList,RatingChart,CompetitiveRewards,CardPerformanceCard,PlayerProfile,MatchDetailView,RecentForm,CompetitiveSummary}.tsx`,
`src/app/duelos/competitivo/{page,historial/page,partida/[matchId]/page,jugador/[id]/page}.tsx`,
`src/app/design-system/fase28/{page.tsx,fixtures.ts}`, `scripts/_fase28-visual-qa.ts`,
`supabase/migrations/0047_pvp_ladder_indexes.sql` (NO aplicada), `docs/product/qa/fase28/*`, este informe.

Modificados: `src/server/services/loop.ts` (foto competitiva), `src/server/services/meta.ts` (`ladder`),
`src/components/duel/pvp/PvpOutcome.tsx` (bloque escalera), `PvpLobby.tsx` («Ranked»), `src/app/duelos/pvp/page.tsx`
(fotos antes/después, «Rival encontrado», telemetría), `src/app/duelos/page.tsx` (puerta), `src/design/nav.ts`,
`src/app/page.tsx` + `LoopStrip.tsx` (frase competitiva), `MetaHub.tsx` (enlace), `src/app/cuenta/page.tsx`
(resumen), `supabase/migrations/0046_…sql` (+`competitive`, sigue sin aplicar), `design-system/fase27/fixtures.ts` (tipos).

No tocados: `duelsRating.ts`, `duelsPvp.ts`, `duelsMatchmaking.ts`, RPCs y migraciones aplicadas,
`domain/cardgame/**`, `data/season.ts`, `services/{packs,pickems,progression,rewards}.ts`, `config/features.ts`,
worker esports, importador VLR, `lib/telemetry/**`.
