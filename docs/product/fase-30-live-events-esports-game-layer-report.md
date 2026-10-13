# Fase 30 · LIVE EVENTS 1.0 — Esports Game Layer + Event Hub + Live Matches + Pick'ems + Event Objectives

Fecha: 2026-09-14 · Rama `arch/stabilization` (HEAD `48dac2a`, sin commit) · Sin deploy, sin VPS, sin Docker, sin migración nueva ni aplicada.

## 1. Estado inicial encontrado

- Datos reales ya existentes y públicos bajo RLS: `events` (status libre: `upcoming|ongoing|finished`, `source` `vlr|demo`), `stages` (kind `group|swiss|playoff|bracket|showmatch`), `matches` (`status` `upcoming|live|finished`, `start_time`, `score_a/b`, `winner_team_id`, `format bo1|bo3|bo5`, `best_of`, `round`, `match_order`, `stage_id` + estructura 0045 `winner_to_match_id…progression_confidence`), `match_maps` (`map_id` NULL cuando el conector no reconoce el mapa = deuda «TBD»), `maps`, `map_player_stats`, `teams`, `players` (`role` libre de la fuente, `is_substitute`), `standings` (`status` nunca escrito por `recompute_standings` = deuda «qualified»).
- `sync_state['esports:autosync']` (solo servidor: RLS sin políticas) con `last_synced_at` (último éxito), `updated_at` (último intento), `cursor` JSON (`consecutiveFailures`, `lastResult`…). Worker VPS por cron cada 2 min; política live 2 min · active 10 min · upcoming_soon 30 min · future 6 h · recently_finished 60 min.
- Pick'ems maduro: `pickem_events` (uno por evento, el más antiguo manda), `pickem_questions` (`locks_at` por pregunta, `correct_option` oculto hasta el cierre), `pickem_submissions/answers/scores`, RPC `app_submit_pick`/`app_score_pickem_event`, escalones `REWARD_TIERS`, live UX con `LIVE_POLL_MS` (20/45/120/300 s) y `refreshIntervalFor`, `PickemPanel` compartido por `/pickems` y `/torneos/[id]`.
- Cuadro Fase 24: `buildBracketModel` (formato, aristas confirmadas, calificaciones, conflictos) + `TournamentBracket`.
- Desafíos de evento (Fase 10/12): `services/events.ts` con `CHALLENGE_SETS` por tipo de evento, progreso contado sobre hechos reales en la ventana del evento, reclamación por `award()`/`app_grant_reward` (ref `event:<eventId>:<challengeId>`), `user_achievements`.
- `/eventos` es el «Centro de Eventos» LOCAL heredado (tienda FUT, `useEventsStore`), no el esport real. `/torneos` y `/torneos/[id]` eran el circuito real, con lecturas directas desde el navegador y sin estado derivado.
- Cartas: `CardDef.playerId` es el slug del catálogo; `players.id` es el id VLR; la única costura es `src/data/vlr/players-vct-2026.json` (`vlrId` → `id`). Sobres: `PackDef.team` (alias) + `publicPacks()` (solo ACTIVE); `TeamPackStatus.BLOCKED` es auditoría, no lifecycle.

## 2. Modelo real de eventos encontrado

No hay tabla de participantes: los equipos del evento son los ids vistos en `matches` (`team_a_id/team_b_id`, sin `vlr-t-tbd`). El «estado» del evento no está en una columna fiable: se deriva de los partidos. Puede haber varios eventos en curso (ligas regionales simultáneas). El ganador solo existe en `winner_team_id` (o `winner_team` legado). Los mapas de partidos sin jugar no existen; los que el conector no reconoce quedan con `map_id NULL`.

## 3. Sistemas reutilizados

Pick'ems (panel, cierres, escalones, ranking), cuadro Fase 24, desafíos de evento (objetivos + reclamación canónica), catálogo del servidor (`serverCatalog`), `publicPacks`, `resolveTeamIdentity`, `readHealth`, `refreshIntervalFor`, `MatchCard`, `takeRate`, `getSession`, primitivas UI. Sin motor nuevo de predicciones, cuadro, objetivos ni economía.

## 4. Qué se ha construido

Dominio puro `domain/liveEvents/eventState.ts` (+ costura `playerCards.ts`), servicio `services/liveEvents.ts` (tres read models), ruta `GET /api/game/live-events`, cliente `lib/liveEvents/client.ts` (fetch + `useLiveRefresh` + `useLiveBadge`), telemetría con puerta, 18 componentes `components/liveEvents/*`, tres páginas (`/torneos`, `/torneos/[id]`, `/torneos/[id]/partido/[matchId]`), integración home/navegación, arnés `/design-system/fase30`, script de capturas, 55 tests nuevos.

## 5. Events Overview

`/torneos`: EN CURSO · PRÓXIMAMENTE · FINALIZADOS con `EventCard` (nombre, región real, estado con texto, progreso de partidos, en directo/próximo con hora real, participantes, predicciones pendientes con sesión, VER EVENTO). Sin filas: «No hay eventos publicados». Ruta existente reutilizada (coherente: `/eventos` es la tienda local).

## 6. Selección / current event

`rankEvents` (puro): en curso con partido en directo → en curso (el que empezó antes) → próximo más cercano → terminado más reciente. `mainEventId` en el overview; nada hardcodeado (test «datos reales»). Varios en curso se enseñan todos.

## 7. Event Hub

`/torneos/[id]`: hero → en directo / próximo → tus acciones → tu progreso → Pick'ems (panel real) → partidos → cuadro o formato → clasificación si hay filas → equipos → jugadores y cartas → objetivos → recompensas → actividad. Demo con aviso. Evento terminado = misma página.

## 8. Event state / lifecycle

`deriveEventState({event, matches, stages, now})` → `UPCOMING|ACTIVE|COMPLETED`, `liveMatches` (todos), `nextMatch/nextMatches`, `recentResults`, `completedMatches/totalMatches/progressPct`, `currentStage`, `participantIds`. Partidos mandan sobre la fila; sin partidos, status/fechas. `now` es el del servidor (`serverNow` viaja al cliente).

## 9. Live / Next Match

`LiveStrip`: todos los partidos con `status = live` (marcador real, SEGUIR) o el próximo con hora real. Sin partidos, nada. «EN DIRECTO» jamás por `start_time <= now` (contrato + tests 7/13).

## 10. Match Center

`/torneos/[id]/partido/[matchId]`: equipos con identidad verificada, estado con texto, marcador accesible, formato/BO si real, mapas (`TBD` cuando `map_id` es NULL), marcadores por mapa, ganador por mapa por `winner_team_id`, estadísticas por jugador si existen, predicción relacionada (solo lectura; `correct_option` solo tras el cierre) con enlace al panel real.

## 11. Refresh / live policy

`useLiveRefresh` reutiliza `refreshIntervalFor` (20 s con partido en directo, 45 s en curso, 2 min futuro, 5 min terminado, backoff por fallos, nada oculto/offline) con UN `setTimeout` reprogramado por lectura. Sin websockets. El `PickemPanel` conserva su propio ritmo (ya existente).

## 12. Pick'ems integration

`pickemView`: abiertas (`locks_at > now` del servidor), pendientes (con sesión), respondidas, corregidas, aciertos, próximo cierre, puntos, escalón, y `byMatch` para etiquetar cada partido. CTA a `/pickems` y `#pickems`; formulario = `PickemPanel`. Ningún guardado ni puntuación fuera de `/api/pickems`.

## 13. Bracket / standings

`EventBracket`: `buildBracketModel` sobre stages + matches reales (sin preguntas) y `TournamentBracket` en solo lectura con pestañas de fase; sin formato de cuadro, texto honesto («liga», «grupos», «por confirmar»). `EventStandings` solo con filas de `standings`; `qualified/eliminated` solo si la fila lo dice.

## 14. Teams

`TeamView`: nombre real, identidad `resolveTeamIdentity(name ?? tag)` (verificada o no; ambigua = sin identidad, nunca fusión), récord W–L solo con ganador escrito, estado en evento solo desde `standings`, jugadores vinculados, sobre ACTIVE si existe.

## 15. Players

`players` por `team_id in participantes` (una consulta, ≤ 400), `role` solo si la fuente lo trae («Rol no publicado» si no), suplentes marcados, cartas por costura VLR → catálogo.

## 16. Event cards

`catalogPlayerIdFor` (vlrId → slug; nick normalizado como respaldo) → `registry.forPlayer(slug)` sobre el catálogo del servidor. Solo cartas existentes; sin costura, sin carta. EN TU COLECCIÓN / NO CONSEGUIDA por `user_cards` del usuario (por lotes de 300), sin tocar la propiedad.

## 17. Collection progress

`collectionProgress(cardIds únicos, poseídas)` → `owned / total · %`. Denominador = cartas reales elegibles; un jugador sin carta no cuenta. Sin cartas: «ningún jugador tiene carta todavía».

## 18. Team Packs

`packsForTeams`: `publicPacks()` (ACTIVE) cruzado por identidad canónica; sin identidad en ambos lados, por nombre/etiqueta exactos; identidad conocida frente a alias desconocido = no se adivina. DRAFT ocultos, RETIRED no comprables, sin creación de sobres. CTA «Ver sobre del equipo» → `/packs/[id]`.

## 19. Event objectives

Reutiliza los desafíos de evento: `getEventViewFor(admin, userId, eventId)` (nuevo, mismo `buildEventView` que la home) → definiciones reales (`CHALLENGE_SETS`), progreso contado por el servidor, `claimable` solo en fase válida; reclamación = `claimChallenge` existente (idempotente por `ref`). Sin sesión, definiciones sin progreso. Sin definiciones: «Sin objetivos del evento». No hace falta migración.

## 20. Event progress

Checklist de tres métricas separadas: PICK'EMS respondidas/total, OBJETIVOS completados/total, COLECCIÓN poseídas/total. Sin puntuación arbitraria.

## 21. Rewards

Escalones del Pick'em (`REWARD_TIERS`, «alcanzado» por puntos reales) y total de desafíos (`totalReward`) con lo cobrado. Sin reward track, sin moneda del evento, sin nueva economía.

## 22. Event Actions

`eventActions` (puro): Pick'em pendiente (urgente si cierra en < 6 h) > objetivo reclamable/pendiente > partido en directo > próximo partido > colección incompleta > sobre ACTIVE > jugar. Solo acciones con dato real; ≤ 5.

## 23. Activity

`eventActivity`: partidos terminados (ganador solo si escrito), en directo, predicciones corregidas; orden por hora real. Sin titulares generados.

## 24. Home / navigation integration

Home: `LobbyCircuit` absorbe el evento (badge de estado real derivado con `deriveEventState`, «Entrar al evento»); sin tercera tarjeta; la prioridad Fase 27/29 (`todayActions`/`continueCta`) intacta. Navegación: Jugar › **Eventos** (`/torneos`) con badge `live` (partidos `status = live` contados por el servidor, `?badge=1`, cada 2 min); Tienda › «Centro de eventos» (`/eventos`, local) para no confundir. Indicador sin animación agresiva (punto con pulso, reduced-motion respetado por el sistema).

## 25. Completed / archive

Evento terminado: misma ruta, resultado por partido, cuadro final, partidos, Pick'ems históricos (panel en modo cerrado), participantes, colección. Sin enlaces rotos.

## 26. Upcoming events

Fechas reales, participantes confirmados por partidos publicados, formato detectado por el motor, primer partido con hora real, Pick'ems si abiertos. Sin partidos: «Sin partidos publicados».

## 27. Read models / API

`EventsOverviewSnapshot`, `EventHubSnapshot` (event, state, stages, live/next/recent, matches, standings, participants, players, cards, collection, packs, pickem, objectives, rewards, actions, activity, sync, signedIn, serverNow), `EventMatchSnapshot`. `GET /api/game/live-events` (`?event=`, `?match=`, `?badge=1`), sesión opcional (`userId` del token), sin POST.

## 28. Sync freshness

`syncFreshness`: FRESH · STALE · FAILING · UNKNOWN con umbrales derivados del worker (con partido en directo 15 min; en curso 30 min; próximo 18 h; terminado nunca; `consecutiveFailures ≥ 3` = FAILING). Al usuario solo llega «Los datos del evento pueden tardar en actualizarse.»; `SyncView` no lleva error, lease, runId ni internos.

## 29. Queries / performance / cache

Overview: ≤ 24 eventos, partidos en una consulta `in(event_id)`, stages en una, Pick'ems en 2–4 consultas agrupadas. Hub: ≤ 400 partidos, equipos/jugadores/standings en una consulta cada uno, cartas por catálogo en memoria, propiedad por lotes. Match: mapas, nombres, stats, jugadores por lote. Sin bucles con `await`. Caché HTTP corta y compartida solo SIN sesión (`max-age=15, s-maxage=30`); con sesión `no-store`. Cubeta `events_read` 60/min.

## 30. Privacy / security

Datos personales solo con Bearer válido; nunca `userId` por parámetro; `correct_option` solo tras el cierre; sin `sync_state` crudo; 5xx del servicio → 503 con frase de producto (sin `TypeError: fetch failed`); ids validados; sin service key en cliente; sin escrituras en el servicio.

## 31. Telemetry

`trackLiveEvent` con puerta `isFlow("live_events")` (no-op honesto): `event_view · event_match_view · event_pickem_cta · event_collection_cta · event_pack_cta`, todos usados. 0046 (sin aplicar) reserva `'live_events'`. Contrato cerrado.

## 32. Responsive / mobile

390: hero 2×2, tira en directo compacta, acciones en una columna, tablas con `overflow-x-auto`, cuadro en modo móvil del componente real, tarjetas apiladas. Arnés desplaza a la sección en escenas de sección.

## 33. Accessibility

Estado con texto y punto (no solo color), marcador con `sr-only` («A 2, B 1»), `Meter` con etiqueta, sin `aria-live` por segundo (sin cuenta atrás en el hub), foco visible (`nx-focus`), táctil ≥ 44, pestañas del cuadro reales (Fase 24), fallback textual del cuadro (formato).

## 34. Game feel / visual system

`Stage` con rejilla y tinte por estado (cian en curso, oro próximo, neutro terminado), radiales por tarjeta, chips de etiqueta de equipo (identidad NEXUS: sin logos ni assets protegidos), separadores por fase (`Rail`), placas de acción con glifo. Sin dashboard SaaS.

## 35. QA visual

**65 capturas** en `docs/product/qa/fase30/` + README (1440/1024/390): overview (simple, múltiple, próximo, terminado, vacío, stale), hub (activo, próximo, terminado, en directo, sin directo, dos en directo, próximo partido), match center (en directo, terminado, mapas TBD), Pick'ems (pendientes, completo, sin), cuadro (escritorio, tablet, móvil, liga sin cuadro), equipos/clasificación, jugadores, cartas, progreso de colección, sobre ACTIVE, sin sobre, objetivos, sin objetivos, recompensa reclamable, sin cartas/recompensas, acciones, sync stale, error backend, vacío, móvil, reduced-motion, sin sesión, anónimo, demo, tarjeta de home, ruta real sin backend. 0 errores de consola propios. La QA destapó y corrigió dos fixtures (próximo/terminado con fechas incoherentes).

## 36. Tests / gates

- Nuevos: `eventState.test.ts` 23 (estado 1–12, integridad 13–20, colección, acciones, frescura) · `liveEvents.contract.test.ts` 32 (datos reales, no fake live, no inferred winner, TBD, cuadro/calificación, Pick'ems 21–26, colección 27–32, sobres 33–37, objetivos/recompensas 38–43, seguridad 44–50, regresión 51–67, home/nav/refresco/archivo, telemetría, accesibilidad, móvil, arnés) = **55**.
- Modificado: `social.contract.test.ts` (Fase 29, mismo día): la unión de badges de navegación admite `"live"` (antes literal exacto). Ningún otro test existente cambia.

| Gate | Resultado |
|---|---|
| `npm test` | **1553 / 1553** (1498 previos + 55), 0 fallos |
| `tsc -p tsconfig.json` · `tsc -p tsconfig.scripts.json` | 0 errores |
| `next build` | OK (`/api/game/live-events`, `/torneos`, `/torneos/[id]`, `/torneos/[id]/partido/[matchId]`, `/design-system/fase30`) |
| `eslint` (ficheros de la fase) | 0 errores |
| `security:verify` · `pack:verify` · `content:verify` · `distribution:verify` · `competitive:verify` · `importer-vlr:verify` | exit 0 |
| Suites Pick'ems (`pickems.test`, `live.test`, `pickemHub.test`, `bracket.test`, `structure.test`, `questions.test`), lobby, telemetría, meta.contract, pack lifecycle, seguridad | verdes dentro de `npm test` |
| `events:verify`, `pickems-integration-test`, `game-loop-verify`, `pvp-*:verify` (BD) | **NO EJECUTADO — REQUIERE BD DE PRUEBAS** (sin Supabase local; no se apunta a producción) |

## 37. Bugs reales encontrados / corregidos

- Home «Retoma tu duelo» ya filtraba `mode='PVE'` desde la Fase 29; sin cambios.
- La ruta de eventos devolvía el error crudo del backend (`TypeError: fetch failed`) sin Supabase: ahora 503 con frase de producto.
- Fixtures QA de próximo/terminado nacían con fechas del evento activo y se etiquetaban «En curso»: corregido (fechas coherentes + status).

## 38. P2 reales

- `standings.status` nunca se calcula (deuda 24.7): la clasificación no enseña «clasificado» hasta que el RPC lo escriba.
- Mapas «TBD» del conector (deuda 24.7): se muestran como TBD; no se toca el importador.
- Rol del jugador: solo si la fuente lo trae; muchos quedan «Rol no publicado».
- `format` del evento no se persiste: se detecta con el motor (puede quedar «por confirmar»).
- Sin ruta `/pickems/[eventId]`: el CTA lleva al panel embebido (`#pickems`) o a `/pickems` (selector).
- Caché HTTP pública corta solo sin sesión; con sesión cada refresco es una lectura completa del hub (aceptable con 20–45 s).
- Actividad sin «fase avanzada» (no hay señal persistida de cambio de fase).
- Badge `live` solo con sesión (misma política que el social); sin sesión no hay indicador en la navegación.

## 39. Migraciones creadas / no aplicadas

Ninguna nueva: la fase no necesita tablas (objetivos = desafíos existentes; lecturas sobre tablas del pipeline). 0046 solo gana la reserva del flujo `'live_events'` (sigue local y sin aplicar). 0046/0047/0048 sin aplicar; `schema_migrations` intacto.

## 40. Archivos creados / modificados

Creados: `src/domain/liveEvents/{eventState,playerCards,eventState.test,liveEvents.contract.test}.ts`, `src/server/services/liveEvents.ts`, `src/app/api/game/live-events/route.ts`, `src/lib/liveEvents/{client,telemetry}.ts`, `src/components/liveEvents/{bits,EventCard,EventsOverview,EventHero,LiveStrip,EventActionsPanel,EventProgressChecklist,EventMatches,EventPickems,EventBracket,EventStandings,EventTeams,EventPlayersCards,EventObjectives,EventRewards,EventActivity,EventHub,MatchCenter}.tsx`, `src/app/torneos/[id]/partido/[matchId]/page.tsx`, `src/app/design-system/fase30/{page.tsx,fixtures.ts}`, `scripts/_fase30-visual-qa.ts`, `docs/product/qa/fase30/*` (65 PNG + README), este informe.

Modificados: `src/app/torneos/page.tsx` y `src/app/torneos/[id]/page.tsx` (reescritos sobre los read models), `src/server/services/events.ts` (`getEventViewFor` + `buildEventView`), `src/server/services/rateLimit.ts` (`events_read`), `src/design/nav.ts` (Eventos + badge live; Centro de eventos), `src/components/layout/GameShell.tsx` (`useLiveBadge`), `src/components/lobby/LobbyCircuit.tsx` (estado real + «Entrar al evento»), `src/app/page.tsx` (`deriveEventState` para la tarjeta), `supabase/migrations/0046_telemetry_flows_progression.sql` (reserva `'live_events'`), `src/domain/social/social.contract.test.ts` (unión de badges).
