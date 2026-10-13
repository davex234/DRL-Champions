# Fase 29 · SOCIAL 1.0 — Perfiles + Amigos + Presencia + Invitaciones + Duelos privados

Fecha: 2026-09-14 · Rama `arch/stabilization` (HEAD `48dac2a`, sin commit) · Sin deploy, sin VPS, sin Docker, sin migración aplicada.

## 1. Estado inicial encontrado

- No existía nada social: cero tablas de amistad/presencia/retos, cero Realtime (`grep .channel(` = 0), `notifications` es una tabla de alertas ops (Telegram), `NotificationItem` es local (zustand + localStorage).
- `profiles` es legible por todos (`select using (true)`), con `username text unique` case-sensitive y SIN `last_seen`. Privacidad = proyectar solo `id, username, avatar` en el servidor (patrón ya usado por `competitive.ts`).
- `duel_matches.mode` solo admitía `PVE|PVP` (CHECK `duel_matches_mode_check` y `duel_matches_mode_shape` en 0031). `duelsPvp.ts` tenía 9 literales `"PVP"`; `toRecord` degradaba cualquier modo desconocido a `PVE` (todo daba `NOT_PVP`). La liquidación (`duel_pvp_settle_match`, 0035) rechaza `mode <> 'PVP'`.
- El rate limit (`app_rate_take`) admite cubetas nuevas solo en TS. Deck legality = `resolveDeckSnapshot` (propiedad + `validateDuelDeck`), la misma del ranked.
- Migraciones locales sin aplicar: 0046 y 0047. Siguiente número libre: **0048**.

## 2. Loop social implementado

Encuentro (rival reciente / búsqueda) → perfil público → AÑADIR AMIGO → ACEPTAR → lista de amigos con presencia → RETAR (elige mazo) → ACEPTAR RETO (elige mazo) → partida `PVP_PRIVATE` en la MISMA arena → resultado sin rating → cara a cara RANKED/PRIVADOS/TOTAL → REVANCHA (reto nuevo) / OTRO RETO / VOLVER A SOCIAL / VER PERFIL.

## 3. Modelo de datos (0048, local, NO aplicada)

- `profiles.last_seen_at timestamptz` (latido).
- `duel_friendships (user_lo, user_hi) PK` con `user_lo < user_hi` (imposible A→B y B→A; imposible A→A), `requester_id`, `status PENDING|ACCEPTED|DECLINED|BLOCKED`, `blocked_by` (⇔ BLOCKED), `created_at/responded_at/updated_at` (trigger `touch_updated_at`).
- `duel_challenges (id, challenger_id, challenged_id, status PENDING|ACCEPTED|DECLINED|EXPIRED|CANCELLED|MATCHED, challenger_deck_id, challenged_deck_id, match_id, previous_match_id, created_at, expires_at, responded_at)`; `not_self`; **único parcial** `(challenger_id, challenged_id) where status='PENDING'`.
- Ambas tablas: RLS activa, sin políticas, `revoke all` a anon/authenticated, `grant all` a service_role. RPC `security definer`, solo `service_role`.
- Índice `profiles_username_lower_idx (lower(username) text_pattern_ops)` para el prefijo.

## 4. Amistad: transiciones atómicas (RPC)

`social_friend_request` (SELF · NOT_FOUND · REQUESTED · ALREADY_PENDING · **ACCEPTED** si cruzadas · ALREADY_FRIENDS · BLOCKED; DECLINED se re-pide), `social_friend_respond` (solo el destinatario: NOT_TARGET; NO_REQUEST), `social_unfriend` (borra ACCEPTED/DECLINED o el PENDING propio → también retira solicitud enviada; conserva partidas), `social_block` (upsert BLOCKED + cancela retos pendientes en ambos sentidos), `social_unblock` (solo el bloqueador). Todo `for update` sobre la fila del par: doble clic y dos pestañas convergen.

## 5. Solicitudes

Enviar / aceptar / rechazar / retirar. «Solicitud enviada» es estado, no botón. Rechazar no bloquea. Bandeja «Esperan tu respuesta» derivada (no hay tabla de notificaciones).

## 6. `/social` hub

Hero con cifras REALES (amigos, en línea ahora, solicitudes, retos pendientes) + CTA BUSCAR JUGADORES; bandeja; pestañas AMIGOS · SOLICITUDES · BUSCAR JUGADORES · RETOS · RIVALES RECIENTES (+ actividad derivada). `?tab=` para enlaces directos (home, navegación, resumen de cuenta).

## 7. Búsqueda de jugadores

Solo `username`, ≥ 2 letras, debounce 300 ms, `ilike 'prefijo%'`, ≤ 10, orden fijo, sin uno mismo, sin quien me bloqueó, sin comodines del cliente, nunca «@». Resultados con relación + presencia + rating público. Cubeta propia `social_search` 30/min.

## 8. Perfil público del jugador

Reutiliza `PlayerProfile` (Fase 28) con un hueco `social` que la página rellena con `SocialActions` (`GET ?player=`): presencia, relación, acciones (AÑADIR AMIGO / SOLICITUD ENVIADA + RETIRAR / ACEPTAR / RECHAZAR / RETAR / ELIMINAR AMIGO / BLOQUEAR / DESBLOQUEAR), reto pendiente entre los dos, cara a cara partido y últimos duelos privados (sin cartas). En el perfil propio no hay acciones.

## 9. Privacidad

Del otro jugador solo `username`, `avatar`, presencia (categoría, no instante), rating público, cara a cara. El servicio proyecta `PROFILE_COLS = id, username, avatar, last_seen_at`; nunca correo, créditos, XP, `is_admin`, mazo actual, `card_uids`, `user_cards` ni `state` jsonb (solo `scoreA/scoreB`). Contrato: test 15/17.

## 10. Lista de amigos y presencia

Orden servidor (`sortFriends`): EN LÍNEA (< 2 min) → RECIENTE (< 30 min) → DESCONECTADO; dentro por último latido y nombre. Latido `POST heartbeat` cada 60 s con la pestaña visible (solo `last_seen_at` propio, id del token). Sin Realtime, sin «en línea» inventado: sin latido = desconectado. Documentado en `PRESENCE_WINDOWS`/`HEARTBEAT_MS`.

## 11. Rivales recientes

Desde `duel_matches` reales (ranked + privadas, terminadas), únicos por última partida, ≤ 8, con relación y presencia → «Añadir amigo» tras un duelo.

## 12. Retos (modelo y ciclo)

`social_challenge_create` (solo ACCEPTED; mazo validado ANTES por `resolveDeckSnapshot`; TTL 24 h por reloj del servidor; ALREADY_PENDING devuelve el mismo id), `social_challenge_respond` (solo el retado; DECLINED sin penalización; DECK_REQUIRED; BUSY si alguno tiene partida activa; **ACCEPTED reserva `match_id = gen_random_uuid()` una sola vez**: la doble aceptación recibe ALREADY_ACCEPTED con el MISMO id), `social_challenge_cancel` (solo retador, solo PENDING), `social_challenge_expire_due` (caducidad perezosa al leer), `mark_matched` / `fail`.

## 13. Modo `PVP_PRIVATE`

0048 amplía `duel_matches_mode_check` y `duel_matches_mode_shape`; recrea `_duel_pvp_has_active_match`, `duel_pvp_expired_candidates` y `duel_pvp_expire_turn` con `mode in ('PVP','PVP_PRIVATE')`; índices parciales privados. **`duel_pvp_settle_match` NO se toca**: sigue rechazando `mode <> 'PVP'`.

## 14. CRÍTICO: cero liquidación en privado

Dos redes: `isSettleable(rec)` devuelve `false` si `rec.mode !== "PVP"` (TS) y el RPC devuelve `NOT_PVP` (SQL). `getMatchRatingOutcome` sigue exigiendo `PVP`. El servicio social no importa nada de rating/settle. Ni rating, ni escalera, ni W/L competitivo, ni provisionales, ni `duel_pvp_rating_events`, ni recompensas competitivas. Test 38/74.

## 15. Creación de la partida privada

`respondChallenge` → RPC ACCEPTED → `createPvpMatch(sb, {retador, su mazo}, {retado, su mazo}, { matchId, mode: "PVP_PRIVATE" })` (revalida los DOS mazos: propiedad + legalidad; `firstAttacker` aleatorio del servidor; retador = A, retado = B) → `social_challenge_mark_matched`. Si falla, `social_challenge_fail` (ACCEPTED→CANCELLED) y mensaje («el mazo de tu amigo ya no es válido»). Carrera ALREADY_ACCEPTED sin fila aún: se reintenta con el mismo id (choque de PK = ya existe).

## 16. Arena privada (misma arena)

`PvpArena` recibe `mode` y `rival`: rótulo «DUELO PRIVADO · SIN RATING · contra {nombre}», «{nombre} está decidiendo…». Mismo `MatchBoard`, `buildMatchView(rivalLabel: "Rival")`, `HelpSheet`, cuenta atrás, abandono, pantalla completa, sonido. Sin `PrivateArena`, sin motor duplicado (test 42).

## 17. Reconexión privada

`/duelos/pvp?match=<uuid>` + `usePvpSync` idénticos; el modo lo dice el snapshot (`mode`), nunca la URL. «Recuperando la partida…». Home y Social enlazan con `?match=`.

## 18. Resultado privado

`PvpOutcome` con `privateDuel`: mismo veredicto/marcador/desempate/carta destacada/turno a turno; **sin** placa de rating ni de escalera; `PrivateDuelPanel` con cara a cara RANKED · PRIVADOS · TOTAL (leído de `?match=` al terminar) y REVANCHA · VOLVER A SOCIAL · VER PERFIL · OTRO RETO. Abandono/tiempo: veredicto por `closedBySide` (bando, nunca id) que ahora publica el snapshot.

## 19. Revancha

Reto NUEVO con `previous_match_id` (debe ser una partida real de los dos) que el rival debe aceptar; se elige mazo en la misma `ChallengeSheet`; «Revancha pedida: tu rival la verá en Social».

## 20. Cara a cara

`h2hSplit` (dominio puro): RANKED / PRIVADOS / TOTAL desde mi perspectiva; el ranked de la Fase 28 (`competitive.ts`, `mode = 'PVP'`) queda intacto y no absorbe privados.

## 21. Notificaciones = bandeja derivada

`inboxOf`: solicitudes recibidas + retos recibidos pendientes + «aceptó tu reto» (con «Entrar en la arena»). Sin servicio de notificaciones ni tabla nueva.

## 22. Badge de navegación

Entrada **Social** en JUGAR (`/social`, `badge: "social"`); `useSocialBadge` lee `GET ?badge=1` (servidor: solicitudes + retos recibidos pendientes) al montar, al volver a la pestaña y cada 90 s; móvil lo enseña en «Jugar».

## 23. Bloqueo

Bloqueado ≠ visible: búsqueda lo omite, perfil da 404 (igual que inexistente), solicitudes y retos se rechazan como «no encontrado» (no se revela). Desbloquear desde SOLICITUDES › Bloqueados.

## 24. Rate limiting

Cubetas nuevas en `RATE_POLICY` (misma tabla/RPC `app_rate_take`, sin migración): `social_read` 90/min, `social_search` 30/min, `social_write` 30/min, `social_heartbeat` 10/min. 429 uniforme con `Retry-After`.

## 25. Concurrencia e idempotencia

Doble clic en «Añadir» → una fila (REQUESTED/ALREADY_PENDING). Cruzadas → ACCEPTED. Doble aceptación de reto → mismo `matchId`. Aceptar caducado → EXPIRED (fila marcada). Aceptar cancelado → NOT_PENDING. Búsqueda: la respuesta más nueva manda (`seq`). Acciones deshabilitadas mientras `busy`.

## 26. Actividad (P2 acotado)

`activityOf`: hechos reales (ahora sois amigos, duelo privado/ranked con letra), sin texto libre, ≤ 8. Pestaña RIVALES RECIENTES.

## 27. `/cuenta`

`SocialSummary` bajo el resumen competitivo: amigos, en línea, pendientes (badge) y puerta a `/social` (`?tab=solicitudes` si hay pendientes).

## 28. Integración competitiva

Historial ranked ya enlazaba al perfil del rival; el perfil ahora ofrece añadir/retar. `MatchHistoryList` sin cambios.

## 29. Home

`loop.ts`: partida de dos personas activa (ranked o privada, A o B) → `resume` prioridad 0,5 a `/duelos/pvp?match=`; retos recibidos vigentes → paso `challenge` prioridad 1,5 (`/social?tab=retos`). `meta.ts`: `resume 0 > challenge 1 > claim 2 > predict 3 > objective 4 > open 5 > build 6 > play 7 > explore 8`; `continueCta` «Responde al reto». `NextUp`/`TodayPanel` con icono. Corrección de paso: el «Retoma tu duelo» PvE ahora filtra `mode = 'PVE'` (antes una partida PvP en curso de A enviaba a `/duelos/jugar`). Sin 0048 aplicada la home no rompe (`catch` → sin pasos).

## 30. FTUE vacío

«Todavía no tienes amigos en NEXUS» + BUSCAR JUGADORES; retos y solicitudes vacíos con su texto. Captura `02-*`.

## 31. Móvil 390 y accesibilidad

Hero 2×2, pestañas desplazables, hojas inferiores (`role=dialog|alertdialog`, `aria-modal`, Escape, foco al cerrar), botones ≥ 44 px, `role=tablist/tab/tabpanel` + `aria-selected`, búsqueda con `label` + `aria-describedby` + `aria-live`, menú de fila `aria-haspopup`. Arena privada con rótulo compacto.

## 32. Read model y API

`SocialSnapshot` (`self`, `counts`, `friends`, `incoming`, `outgoing`, `blocked`, `challenges` con estado efectivo + `actions`, `recentOpponents`, `inbox`, `badge`, `activity`, `serverNow`, ventanas, TTL). `GET /api/game/social` (`?badge=1`, `?q=`, `?player=`, `?match=`), `POST {action, targetUserId?, challengeId?, deckId?, previousMatchId?}` (11 acciones). `userId` del token; el cuerpo solo ids. Consultas acotadas (amistades ≤ 500, retos ≤ 40, partidas ≤ 30/100).

## 33. Seguridad

401 sin sesión; UUID en ruta y servicio; 400 acción/cuerpo inválidos; 404 no enumerador (jugador, reto, partida, bloqueo); `p_user` siempre = token; `NOT_TARGET` en RPC; latido solo propio; la partida privada usa `guardAction` y la ruta PvP (bando del servidor); tablas sin políticas; sin secretos en cliente. Tests 56–64.

## 34. Telemetría

`lib/social/telemetry.ts`: `trackSocial` con puerta `isFlow("social")` (no-op honesto); contextos `social_view · player_search · friend_request · friend_accept · challenge_sent · challenge_accept · private_match_complete`, todos usados. 0046 (sin aplicar) reserva `'social'`. Contrato de eventos cerrado.

## 35. QA visual

**43 capturas** en `docs/product/qa/fase29/` + README (1440/1024/390): hub lleno/vacío/tranquilo, amigos, solicitudes, búsqueda (con y sin resultados), retos (con y sin), rivales recientes, actividad, hoja de reto (enviar/aceptar), confirmaciones (eliminar/bloquear), perfil (amigo/desconocido/enviada), arena privada, resultado privado (victoria/derrota/abandono), resumen de cuenta, error, reduced-motion, `/social` sin sesión, navegación. 0 errores de consola propios. En móvil, las escenas de pestaña se capturan sobre la pestaña.

## 36. Tests y gates

- Nuevos: `social.test.ts` 19 (dominio) · `social.contract.test.ts` 64 (código real) = **83**; los números del brief (1–79) cubiertos por uno o más tests. Modificado: `duel.test.ts` solo para inscribir `PrivateDuelPanel.tsx` en `UI_FILES`/`PVP_UI` (exigido por su propio barrido).

| Gate | Resultado |
|---|---|
| `npm test` | **1498 / 1498** (1415 previos + 83), 0 fallos |
| `tsc -p tsconfig.json` · `tsc -p tsconfig.scripts.json` | 0 errores |
| `next build` | OK (`/api/game/social`, `/social`, `/design-system/fase29`) |
| `eslint` (ficheros de la fase) | 0 errores (1 aviso preexistente en `cuenta/page.tsx`) |
| `security:verify` · `pack:verify` · `content:verify` · `distribution:verify` · `competitive:verify` · `importer-vlr:verify` | exit 0 |
| Suites PvP/gameplay/competitivo/meta/poller | verdes dentro de `npm test` |
| Verificadores con BD (`pvp-*:verify`, `duel-gameplay`, economía, pase) | **no ejecutados**: exigen Supabase local (Docker desinstalado); no se apuntan a producción |

## 37. Deudas y P2

- 0048 sin aplicar: `/social`, `?match=` y los retos responden error de dependencia hasta aplicarla; la home degrada sin pasos sociales. Aplicarla es decisión de producción (aditiva, idempotente).
- `_duel_pvp_has_active_match` ahora cuenta privadas: mientras juegas un duelo privado no puedes entrar en cola ranked (y viceversa). Deliberado; documentar en el copy de la cola es P2.
- El latido bumpa `profiles.updated_at` (trigger `profiles_touch`) una vez por minuto por usuario activo. Alternativa: trigger que ignore `last_seen_at` (P2).
- Sin Realtime: presencia/bandeja se refrescan por lectura (badge cada 90 s, hub tras cada acción). Suficiente para 1.0.
- Retos cerrados: el hub muestra los últimos 6; historial completo de retos es P2.
- Replay de partida privada para el jugador B: hereda el P2 del replay PvE (`getReplay` asume A).

## 38. Lo que NO se ha tocado

Motor/reglas/bots, liquidación y fórmula de rating, matchmaking ranked, RNG/precios de sobres, propiedad de colección, reglas de mazo, Pick'ems, XP y recompensas, logros, worker esports/VLR, identidades, Marketplace (`GLOBAL_MARKET_ENABLED=false`). Ni chat, ni feed, ni clanes, ni trading, ni espectadores. Sin commit/push/deploy/VPS/Docker. `schema_migrations` intacto; 0046/0047/0048 locales.

## 39. Cómo verificar a mano

1. Aplicar 0048 en un entorno de pruebas. 2. Dos cuentas: buscar por nombre, añadir, aceptar. 3. Retar (mazo legal) → aceptar (mazo legal) → arena con rótulo «Duelo privado» → jugar/abandonar → resultado sin rating → `duel_pvp_ratings` y `duel_pvp_rating_events` sin cambios. 4. Cara a cara PRIVADOS +1. 5. Revancha → reto nuevo en `/social?tab=retos`. 6. Bloquear → desaparece de búsqueda y perfil da 404.

## 40. Archivos creados/modificados

Creados: `supabase/migrations/0048_social_friends_private_duels.sql`, `src/domain/social/social.ts`, `src/domain/social/social.test.ts`, `src/domain/social/social.contract.test.ts`, `src/server/services/social.ts`, `src/app/api/game/social/route.ts`, `src/lib/social/client.ts`, `src/lib/social/telemetry.ts`, `src/app/social/page.tsx`, `src/components/social/{types.ts,bits.tsx,SocialHub,SocialHero,SocialInbox,FriendsList,RequestsList,PlayerSearch,ChallengesList,RecentOpponents,ActivityList,ChallengeSheet,ConfirmSheet,SocialActions,SocialSummary}.tsx`, `src/components/duel/pvp/PrivateDuelPanel.tsx`, `src/app/design-system/fase29/{page.tsx,fixtures.ts}`, `scripts/_fase29-visual-qa.ts`, `docs/product/qa/fase29/*` (43 PNG + README), este informe.

Modificados: `src/server/services/duelsPvp.ts` (modo en `createPvpMatch`, `toRecord`, `isPvpLike`, `isSettleable` solo PVP), `src/domain/cardgame/pvp/{types,authority,sync}.ts` (`PVP_PRIVATE`, `isPvpLike`, `mode`/`closedBySide` opcionales en el snapshot), `src/server/services/rateLimit.ts` (4 cubetas), `src/server/services/loop.ts` (pasos social + PvE filtrado), `src/domain/progression/meta.ts` (`challenge`), `src/components/loop/NextUp.tsx`, `src/components/progression/TodayPanel.tsx`, `src/design/nav.ts` (Social + badge), `src/components/layout/GameShell.tsx` (badge servidor), `src/app/duelos/pvp/page.tsx` (modo privado, revancha), `src/components/duel/pvp/{PvpArena,PvpOutcome}.tsx` (parametrizados), `src/components/competitive/PlayerProfile.tsx` (hueco `social`), `src/app/duelos/competitivo/jugador/[id]/page.tsx`, `src/app/cuenta/page.tsx` (resumen), `supabase/migrations/0046_telemetry_flows_progression.sql` (reserva `'social'`), `src/lib/duel/duel.test.ts` (inscribe `PrivateDuelPanel.tsx`).
