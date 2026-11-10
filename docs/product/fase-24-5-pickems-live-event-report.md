# FASE 24.5 — PICK'EMS LIVE EVENT EXPERIENCE · Torneos vivos, bracket que avanza, estado en directo

**Estado:** completada (flujo vivo contra backend pendiente de entorno, documentado) · **Fecha:** 2026-09-14
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** · **Migración 0045 NO aplicada** (el código sigue siendo compatible pre y post 0045).

> Regla de la fase: no inventar «en directo». Un partido está en directo solo si `matches.status`
> del backend lo dice; ganadores, puntos, clasificados, posiciones y recompensas se leen, nunca se
> calculan. Lo que añade 24.5 es UX sobre los snapshots reales: refresco con ritmo, diff entre
> refrescos y feedback en sesión.

---

## 1. Qué existía

24.1–24.4: core, modo competitivo, cuadro data-driven, estructura confirmada. `usePickem` cargaba
UNA vez por torneo (seis lecturas en un lote, caché por torneo). No había refresco en segundo
plano, ni estado del evento, ni partido en directo, ni «hoy», ni actividad, ni feedback entre
refrescos. En el repositorio existía una política de sondeo (`lib/duel/pvpPoller`: intervalos por
estado, retroceso por fallos, pausa con pestaña oculta) que esta fase sigue como patrón.

## 2. Qué se añadió

| Capa | Pieza |
|---|---|
| Dominio | `domain/pickems/live.ts`: `tournamentStatus`, `deriveLiveEventSnapshot`, `diffLiveSnapshots`, `dedupeChanges`, `changedIdsOf`, `refreshIntervalFor` (+`LIVE_POLL_MS`, retroceso), `URGENT_LOCK_MS`/`isUrgent`, `agoLabel`, `dayKey`. Todo puro. |
| Hook | `usePickem(id, user, { live: true })`: refresco por `setTimeout` con el intervalo del dominio; pausa con pestaña oculta y sin red; refresco inmediato al volver; fallo conserva el lote; diff + deduplicación por sesión; brillo por id; `previousPosition`; carrera envío/refresco resuelta. |
| UI | `components/pickems/live/LiveMatchCard.tsx` (en directo / siguiente, sobre `BracketMatchCard`), `EventSummary.tsx` (`EventProgress`, `EventToday`, `RecentEventActivity`, `PendingPredictions`, `LiveUpdateNotice`, `LiveChangesBanner`, `EventNav`, `describeChange`). |
| Adaptado | `PickemHero` (+estado real, fase, progreso del torneo, posición anterior, +pts), `BracketMatchCard`/`QualifiedNode`/`BracketRound`/`TournamentBracket`/`BracketPickemView` (+`highlight`/`changedIds`, `initialStageId`), `/pickems` (composición viva + navegación), CSS `nx-live-glow`, telemetría (`PICKEM_LIVE_ACTIONS`). |

## 3. Event status

`tournamentStatus(matches, fallback, now)`: los partidos reales mandan — todos terminados →
`finished`; alguno en directo o terminado, o el primero ya empezó → `live`; si no → `upcoming`.
Sin partidos, `events.status` del importador (misma taxonomía `upcoming|live|finished`); sin nada,
la fase de 24.2. Etiquetas: PRÓXIMAMENTE / EN CURSO / FINALIZADO. La fase actual (`stageLabel`)
es la del partido en directo o del siguiente.

## 4. Live matches

`liveMatches` = partidos con `status` live/ongoing, ordenados por hora. Uno → tarjeta «EN
DIRECTO» con marcador real (si existe), tu pick y estado; varios → cabecera «EN DIRECTO · N
partidos» y una tarjeta por partido. Sin partido en directo no se pinta nada de directo.

## 5. Next matches

`nextMatches` = partidos no terminados ni en directo con hora, ordenados; el primero es
«SIGUIENTE PARTIDO», con cuenta atrás local (`useNow`), urgencia por debajo de `URGENT_LOCK_MS`
(30 min, un solo sitio) y los mismos botones de predicción que el cuadro (`pick` del hook →
`/api/pickems`).

## 6. Tournament progress

`progress` = partidos completados / total y porcentaje, más desglose por fase (grupos, playoffs)
cuando hay varias. Derivado de `matches.status`; nada hardcodeado. En el héroe y en el resumen.

## 7. Today

`todayMatches` = partidos cuyo `start_time` cae en el día LOCAL del navegador (`dayKey` con
`getDate()` local), el directo primero y el resto por hora; cada fila: hora local, equipos,
marcador si existe, tu pick y estado (Finalizado / En directo / Próximo).

## 8. Recent results

`activity` = partidos terminados (ganador real, marcador), predicciones resueltas (acertada +N del
corrector / fallada +0), clasificados (nodo 24.4 con equipo) y recompensa concedida (asiento
real). Las únicas horas que se enseñan son reales: inicio del partido y `created_at` del asiento.
Cuando no hay hora, la fila sale sin ella. No hay tabla de eventos ni event sourcing.

## 9. Prediction resolution

Entre refrescos, `diffLiveSnapshots` detecta `PREDICTION_RESOLVED` cuando el estado de una
pregunta pasa a acertada/fallada según `is_correct`/`points_award` del servidor (o el
`correct_option` ya publicado). La caja pasa a ACERTADA +N / FALLADA +0 sin recargar la página;
toast y banner `aria-live` con deduplicación por sesión.

## 10. Bracket updates

La estructura confirmada (24.4) no se recalcula: al llegar el resultado cambian ganador, marcador y
participante del siguiente partido (`PARTICIPANT_SET`) y los ids afectados reciben un brillo de
1,8 s (`changedIds` → `highlight`). Claves estables por partido y ronda: sin remontaje, la ronda
elegida se deriva y el scroll no se devuelve al inicio.

## 11. Qualification updates

`QUALIFIED` cuando un nodo pasa de «Por definir» a equipo real (ganador del partido de origen).
La caja cambia a «CLASIFICADO · [logo] Equipo» con brillo; la actividad y el banner lo anuncian.

## 12. Ranking

`TournamentLeaderboard` recibe las filas del lote refrescado. `RANK_CHANGED` solo si la posición
del servidor cambia; el héroe enseña «#24 → +6» únicamente cuando la sesión conoció la anterior
(`previousPosition` en memoria; no se persiste nada). Sin dato, solo la posición actual.

## 13. Rewards

`REWARD_EARNED` cuando aparece un asiento nuevo de `credit_transactions`; banner/toast y fila en
actividad. Sin botón reclamar; la concesión sigue en el servidor.

## 14. Refresh strategy

`refreshIntervalFor`: partido en directo 20 s · torneo en curso 45 s · próximo 120 s · terminado
300 s · fallos → retroceso 5/10/20/40/60 s. `setTimeout` encadenado, nunca `setInterval` ni por
segundo. Un refresco es el mismo lote de siempre (siete lecturas en paralelo tras el evento).
Countdowns locales con `useNow`.

## 15. Visibility handling

`visibilitychange`: pestaña oculta → intervalo `null` (sin sondeo); visible → refresco inmediato y
vuelta al ritmo. `online`/`offline`: sin red no se sondea ni se envían picks; al volver, refresco.

## 16. Offline / error handling

Un refresco fallido conserva el último lote válido, anota `refreshError`, incrementa los fallos y
reintenta con retroceso. `LiveUpdateNotice`: «Sin conexión», «No se ha podido actualizar ·
Reintentar», o «última actualización hace N min» (solo pasados 2 min, sin `aria-live`). El primer
load usa el skeleton existente; los refrescos son silenciosos. Sin red, `pick` avisa y no afirma
guardado. Carrera envío/refresco: el lote conserva la respuesta optimista en vuelo.

## 17. Accessibility

`aria-live="polite"` solo en el banner de cambios, el aviso de error/sin red y el pie de la caja;
la cuenta atrás no se anuncia. Botones reales ≥ 44 px (medido), foco visible, `role="progressbar"`.
Brillo bajo la regla global `prefers-reduced-motion`.

## 18. Mobile

390: héroe compacto (posición/puntos/aciertos en rejilla), pendientes + CTA, directo primero,
siguiente partido, progreso, hoy, actividad, cuadro con selector de ronda de 24.3, banner de
cambios. Sin desbordamiento (medido a 1440/1024/390).

## 19. Telemetry

`PICKEM_LIVE_ACTIONS` (`event_live_viewed`, `live_match_seen`, `prediction_result_seen`,
`qualification_seen`, `event_refresh_failed`) viajan como `context` del flujo `pickem_form`,
como en 24.2; la lista `PICKEM_ACTIONS` de 24.2 no cambia (su prueba sigue verde). Sin migración,
sin analytics externo.

## 20. QA

`scripts/_fase24-5-qa.ts` (fuera de CI), **56/56 ✓**, capturas en `docs/product/qa/fase24-5/`
a 1440 / 1024 / 390: `upcoming`, `active-one-live`, `active-multi-live`, `just-resolved`
(predicción resuelta + clasificado + ranking + recompensa, con el diff real del escenario),
`refresh-error` (snapshot conservado), `league` (sin cuadro) — todos **QA LIVE FIXTURE**
etiquetados — y `real-future-champions-2026` (REAL FUTURE EVENT). App real: 11 rutas a tres
anchos sin excepciones ni desbordamiento.

## 21. Prueba REAL

- **REAL FUTURE EVENT**: Champions 2026 descargado con el importador real (sin BD): estado
  «Próximamente», fase Group Stage, 0 en directo, siguiente partido real Team Liquid vs Paper Rex
  (24-sep), 0/34 partidos, 20 aristas estructurales. No se llama «live real»: hoy no hay partido en
  directo en la fuente.
- **NO realizado**: flujo vivo contra Supabase (refresco real, resultado real llegando por sync).
  Sin Supabase local ni vía autorizada a la VPS no se finge.
- **Fuente de datos**: los resultados entran por `/api/esports/sync` (POST con `SYNC_SECRET`,
  pensado para un cron externo que no existe en el repo) o por `scripts/vlr-sync.ts` (manual). El
  navegador nunca lee VLR; solo consume el backend NEXUS. No se creó cron ni worker.

## 22. Limitaciones

1. Sin cron: el «evento vivo» refleja lo que el sync haya escrito; si nadie sincroniza, no cambia.
2. Migración 0045 sin aplicar: sin ella, las aristas son solo por resultado (como 24.3) y no hay
   nodos de clasificación; el código funciona igual.
3. Horas de resolución: no existen (solo `start_time` y `created_at` de recompensa); la actividad
   no fabrica ninguna.
4. La tarjeta «En directo» reutiliza la caja del cuadro, que muestra su propia insignia «En juego»
   además del marco: redundante, no incorrecto.

## 23. P2

Aplicar 0045 y programar el sync; validar el flujo vivo; unificar insignias de directo en la
tarjeta; contador de pendientes por fase; realtime solo si el proyecto lo adopta para estos datos.

## Archivos

**Creados:** `src/domain/pickems/live.ts`, `live.test.ts`; `src/components/pickems/live/LiveMatchCard.tsx`,
`EventSummary.tsx`, `live.test.tsx`; `scripts/_fase24-5-qa.ts`; `docs/product/qa/fase24-5/*`; este informe.

**Modificados:** `src/lib/usePickem.ts` (refresco vivo, diff, carrera, red/visibilidad),
`src/app/pickems/page.tsx` (composición viva), `src/components/pickems/PickemHero.tsx`,
`src/components/pickems/bracket/{BracketMatch,QualifiedNode,BracketRound,TournamentBracket,BracketPickemView}.tsx`,
`src/lib/telemetry/pickems.ts`, `src/app/globals.css`.

**No tocados:** Marketplace, packs/RNG/minting, colección, inventario, Duelos/PvP, Trainer,
`teamIdentities`, Team Packs, economía, XP/levels, reward engine, `app_submit_pick`,
`app_score_pickem_event`, migraciones (0045 sigue sin aplicar).

**Gates:** `npm test` 1168/1168 ✓ (34 nuevas; ninguna existente modificada) · `typecheck` ✓ · `build` ✓ ·
`security:verify` ✓ · `pack:verify` ✓ · `content:verify` ✓ · `distribution:verify` 30/0 ✓ · lint 0/0 ·
`test:pickems` no ejecutable (Supabase vivo).

Sin `git commit`, sin `push`, sin `deploy`. Sin Docker. Servidor detenido al terminar.

**FASE 24.5 — CERRADA** (flujo vivo contra backend pendiente de entorno, documentado).
