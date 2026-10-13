# Daily Loop · contrato de prioridad (Fase 36)

Describe la función REAL. Si este documento y el código divergen, manda el código y este documento está mal:
`src/domain/dailyLoop/index.ts` (`dailyCandidates`, `dailyActions`, `todayItems`, `buildDailyLoop`) sobre
`src/domain/progression/meta.ts` (`orderToday`, `todayRank`, `nearObjective`, `liveObjective`). Pruebas:
`src/domain/dailyLoop/dailyLoop.test.ts`, `npm run daily-loop-priority:verify`.

## 1. Una sola autoridad

```
hechos del servidor ──► dailyCandidates(facts) ──► orderToday(candidatos, 1 + 3) ──► acción principal + ≤ 3 secundarias
```

`orderToday` es el mismo orden que ya usaban la home (`todayActions`/`continueCta`, Fase 27) y la temporada
(`seasonActions`, Fase 34). No hay NextUp2, ni HomePriority, ni un motor por pantalla. `loop.ts` (`GET /api/game/loop`)
sigue existiendo para quien lo consuma, pero la home ya no lo usa.

## 2. Hechos (`DailyLoopFacts`)

Todos los sirve `getDailyLoop` (`src/server/services/dailyLoop.ts`) con lecturas puras. `null` = el subsistema no se pudo
leer (falló o superó `SUBSYSTEM_TIMEOUT_MS` = 4 s).

| hecho | fuente | nota |
|---|---|---|
| `matches` | `duel_matches` (PVE / PVP / PVP_PRIVATE `IN_PROGRESS`, columnas públicas) + `campaign_attempts` `STARTED` + `profiles.username` del rival | nunca `state` ni `rng` |
| `social` | `duel_challenges` recibidos `PENDING` con `expires_at > serverNow` (≤ 20) + `username` del primero | |
| `progression` | `peekProgression` (pase, misiones, logros, métricas) + `profiles.xp` | NO `getProgression` |
| `pickems` | `getEventsOverview` (recuentos por evento) | nunca respuestas |
| `packs` | `user_packs.qty` | |
| `decks` | `listDecks` + `readActive` | no crea equipo activo |
| `campaign` | `readCampaignSummary` | no crea progreso |
| `competitive` | `readCompetitivePosition` + últimos 5 `duel_pvp_rating_events` | NO `ensureRating` |
| `live` | `getEventsOverview` (≤ 6 eventos) | |
| `season` | `getSeasonCalendar(serverNow)` | código, sin BD |

## 3. Orden

Rango (`todayRank`), menor primero; UNA acción por tipo:

| rango | tipo | acciones (orden de entrada = desempate) |
|---|---|---|
| 0 | `resume` | `resume-ranked` > `resume-private` > `resume-campaign` > `resume-pve` |
| 0.5 | `open` con `ftue` | `open-first`: **0 cartas y ≥ 1 sobre** (regla de la Fase 15) |
| 1 | `challenge` | `challenge` |
| 2 | `claim` | `claim`: niveles del pase reclamables + objetivos completos sin reclamar **de una ventana viva** + logros completos sin reclamar |
| 3 | `predict` | `predict`: Pick'ems abiertos sin responder |
| 4 | `objective` | `objective`: `nearObjective(objetivos, serverNow)` |
| 5 | `open` | `open`: sobres sin abrir (fuera de la primera sesión) |
| 6 | `build` | `get-cards` (< 10 cartas y 0 sobres) > `create-team` (0 equipos) > `edit-team` (ninguno válido) |
| 7 | `play` | `campaign` (no completada, con siguiente nodo) > `ranked` > `quick`; `play-hub` si no se pudieron leer los equipos |
| 8 | `explore` | `live`: solo con un partido **en directo** (`liveCount > 0`) |

Reglas de exclusión dentro de la construcción:

- Sin sesión: `sign-in` (→ `/cuenta`) y, si hay partido en directo, `live`. Nada personal.
- Con PvE/campaña a medias no se proponen `campaign` ni `quick`; con PvP a medias no se propone `ranked`.
- Sin equipo válido no se propone ningún modo; con < 10 cartas y sobres, no se propone crear equipo (abrir ya está).
- Un hecho `null` no genera ninguna acción de su subsistema.

P0: **una partida a medias gana siempre** (rango 0, por debajo de todo).

## 4. Desempate

1. Rango efectivo (`todayRank`).
2. Orden de entrada en `dailyCandidates` (el `sort` de JS es estable): la tabla de arriba.
3. Deduplicación por tipo: sobrevive la primera de cada tipo.

`nearObjective`: mayor porcentaje → antes caduca → `id`.

## 5. Casi completado

`nearObjective(list, now)`: `goal > 0`, `!complete`, `!claimed`, **`current / goal ≥ 50 %`**, ventana viva
(`expiresAt === null || expiresAt > now`). Es la regla existente de la Fase 27 (no un segundo umbral): con metas de 1, 3 y 5
del pool real, un 70 % dejaría fuera 2/3. Sin denominador nunca hay «casi».

## 6. Fallback

Sin ningún candidato: `FALLBACK_ACTION` = «Jugar» → `/jugar`. Con sesión y todo caído: `play-hub` → `/jugar`.

## 7. HOY (`todayItems`)

Máx. 5: objetivos diarios/semanales vivos sin reclamar (reclamables → casi completo → diarios → porcentaje → id),
Pick'ems pendientes, siguiente nodo de campaña, calibración ranked (provisional con partidas) y sobres. Si hay extras,
como mucho 3 objetivos. No repite el destino de la acción principal.

## 8. Efectos de lectura

Leer la foto **no** inserta, actualiza, borra ni llama RPC de escritura. No crea rating, no abre carril, no rota
misiones, no crea progreso de campaña ni equipo activo, no reclama, no concede créditos/sobres/cartas/XP, no abre ni
reserva sobres, no toca presencia. La única RPC observada es `app_content_distribution_snapshot` (lectura del catálogo
dentro de `listDecks`). Probado en `dailyLoop.service.test.ts` y `daily-loop-security:verify`.
