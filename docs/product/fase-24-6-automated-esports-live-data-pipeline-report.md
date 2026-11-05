# FASE 24.6 — AUTOMATED ESPORTS LIVE DATA PIPELINE · Sync automático, scoring Pick'ems y actualización autónoma de torneos

**Estado:** completada (pipeline construido, probado y validado; activación en producción NO realizada, a propósito) · **Fecha:** 2026-09-14
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** · **Sin Docker** · **Sin VPS** · **Migración 0045 NO aplicada** (compatibilidad pre/post comprobada y REPARADA) · **Auto-sync OFF por defecto**.

> Regla de la fase: el sync automático no puede ser más peligroso que el manual. Hay UNA lógica
> (`runEsportsSync`) que reutiliza el pipeline canónico que ya existía y ya estaba validado
> (`importer-vlr` → `snapshotToSource` → `syncTournament` → `runPickemLifecycle` →
> `app_score_pickem_event` → `services/rewards`). El trigger decide CUÁNDO; el core decide QUÉ.
> Nada se inventa, nada se borra por una fuente rara, y en dry run no se escribe ni un byte.

---

## 1. Arquitectura anterior

- Los datos esports solo cambiaban cuando alguien ejecutaba `POST /api/esports/sync` (fuente mock o
  un proxy `NEXT_PUBLIC_VLR_API` que nunca existió) o `scripts/vlr-sync.ts` (URL a mano). No había
  cron, worker ni scheduler para este pipeline.
- El stack «Tournament Automation» (`tournament-watcher/scheduler/autopipeline/runtime`) es un
  planificador EN MEMORIA sobre snapshots (para la generación de cartas), con `InMemoryLock`/`FileLock`
  y sin contacto con Supabase ni con Pick'ems: no servía como scheduler de la base de datos.
- `syncTournament` (orquestador canónico) era idempotente por UPSERT + RPC de recálculo y ya llamaba
  a `runPickemLifecycle` en cada pasada (scoring en cada sync, aunque no hubiera cambios).
- **Hallazgo pre-0045 (medido leyendo el código, no en BD):** `pickemLifecycle` seleccionaba
  `winner_qualifies, winner_qualifies_label, progression_confidence`; `lib/game/client.fetchMatches`
  seleccionaba las diez columnas de la 0045; y el orquestador hacía UPSERT de esas columnas. Sin la
  migración, PostgREST responde `42703` y: el ciclo de Pick'ems entero no se ejecutaba (ni preguntas,
  ni resolución, ni scoring), `/pickems` recibía una lista vacía de partidos, y un sync con cuadro
  confirmado fallaba entero. La compatibilidad «pre y post 0045» que declaraban 24.4/24.5 no se
  cumplía en el lado que lee/escribe la BD. Corregido en esta fase (§25).
- **Hallazgo REAL SOURCE:** el conector VLR convierte «TBD» en un equipo (`vlr-t-tbd`) porque aparece
  en las tarjetas de partido; 26 de los 34 partidos de Champions 2026 son hoy TBD vs TBD. Con el ciclo
  manual eso era inocuo; con el automático abriendo preguntas solo, «¿Quién gana TBD vs TBD?» y «TBD»
  como opción de campeón habrían nacido sin nadie delante. Corregido (§15, §16).

## 2. Arquitectura nueva

```
vlr.gg ──(fetcher: timeout · allowlist · reintento transitorio)──► importer-vlr (sin cambios)
        ──► snapshotToSource (adaptador canónico, + vlr_url)
        ──► validate: payload · transiciones · lista sospechosa · huella de resultados
        ──► syncTournament (canónico; fuente acotada a lo ACEPTADO)
              ├─ matches / structure (0045 si existe) / stats / recomputes
              └─ runPickemLifecycle SOLO si hace falta (+ reconcile de correcciones)
                    ├─ app_set_correct_option (RPC)
                    ├─ app_score_pickem_event (RPC, recalcula por diferencia)
                    └─ services/rewards.award (libro mayor idempotente)
        ──► marcador de convergencia (sync_state.cursor) · salud (sync_state) · notifications
        ──► 24.5 frontend refresca NEXUS (nunca VLR)
```

Capa nueva: `src/lib/esports/autosync/` (config · policy · validate · lock · health · sourceRef ·
runner · report · log) y `src/lib/esports/sync/schemaCompat.ts`. Los triggers son tres cables
finos sobre el mismo core: `POST /api/internal/esports/sync` (scheduled/manual), `POST /api/esports/sync`
con `source:"vlr"` (manual, legado) y `scripts/esports-autosync.ts` (cron/systemd) + `scripts/vlr-sync.ts`
(manual por URL, escritura por el core).

## 3. Core sync — `runEsportsSync(deps, opts)`

Entrada: `mode` (manual|scheduled), `dryRun`, `eventIds` (validados), `targets` (CLI), `force`,
`pickems`. Pasos: kill switch → lock (no en dry run) → salud/memoria → catálogos → descubrimiento de
eventos en BD → política → por evento: lo conocido → fuente → adaptador → corte sospechoso → diff y
transiciones → (dry run: informe) → «sin cambios» = cero escrituras → `syncTournament` con la fuente
acotada → marcador de convergencia → avisos → agregado → salud → lock liberado.

Resultado estructurado (`EsportsSyncRunResult`): `runId, mode, dryRun, startedAt, finishedAt,
durationMs, skipped?, lock, eventsChecked/Due/Synced/Changed/Failed/Skipped, matchesChecked/Created/
Updated/Finished/Rejected/Invalid, bracketChanges, qualificationsResolved, pickemsScored,
pickemsCorrected, usersScored, errors[], events[] (informe por evento), nextDueAt, health`.

## 4. Trigger manual

- `scripts/vlr-sync.ts` conserva su dry run de identidades y su protección de eventos; la ESCRITURA
  pasa ahora por `runEsportsSync({ mode: "manual", targets: [ref] })` reutilizando el snapshot ya
  descargado (sin segunda descarga).
- `POST /api/esports/sync` con `source: "vlr"` ejecuta el core en modo manual (descubrimiento en BD o
  `tournamentId` validado; `dryRun` opcional). `source: "mock"` sigue igual. Ya no depende de
  `NEXT_PUBLIC_VLR_API`.
- `POST /api/internal/esports/sync` con `mode: "manual"` ejecuta aunque el kill switch esté OFF.
- `/api/admin/tournaments` (`run_pickem_lifecycle`) no se toca y sigue funcionando.

## 5. Trigger scheduled

`POST /api/internal/esports/sync` (Bearer `SYNC_SECRET`) en modo `scheduled` (por defecto) y
`npm run esports:autosync` (una pasada; `--loop` para un servicio; `--dry-run`). Ambos: sin
`ESPORTS_AUTO_SYNC_ENABLED=true` responden `skipped: "disabled"` sin tocar nada. No aceptan URLs.

## 6. Política de frecuencia — `getEsportsSyncPolicy` (pura)

| clase | condición (datos de la BD) | intervalo por defecto | prioridad |
|---|---|---|---|
| live | algún `matches.status = live` | 2 min | 100 |
| active | algún terminado y otros por jugar, o ya empezado | 10 min | 80 |
| upcoming_soon | primer partido/fecha ≤ 48 h | 30 min | 60 |
| recently_finished | todo terminado, fin ≤ 72 h | 60 min | 40 |
| future | empieza más tarde (o sin datos) | 6 h | 20 |
| archived | terminado hace > 72 h | **no se sondea** | 0 |

Los números viven en un solo sitio (`config.ts`, `DEFAULT_AUTO_SYNC_CONFIG`) y se pueden ajustar por
entorno en segundos con suelo (nunca < 30 s a la fuente). El frontend 24.5 puede refrescar NEXUS
cada 20 s; VLR no se pide cada 20 s. `nextDueAt = últimoIntento + backoff(intervalo) ± jitter (10 %)`.

## 7. Eventos elegibles

Descubrimiento autónomo en BD: `events.source = 'vlr'` + referencia a la fuente
(`events.vlr_url` parseable, o id numérico / `vlr-<id>`). Sin referencia → omitido con motivo. Los
partidos del evento (`status`, `start_time`) deciden la clase. No depende de que nadie abra `/pickems`
ni de ninguna señal del frontend. Los archivados (Champions 2024) no se descargan nunca en el sondeo.
El adaptador persiste ahora `events.vlr_url` para que el siguiente descubrimiento sea trivial.

## 8. Lock (single-flight)

Lease en `sync_state` (tabla 0003, sin migración): fila `esports:autosync:lock` con
`status='running'`, dueño en `cursor`, inicio en `updated_at`. Adquisición = UN UPDATE condicional
(`status <> 'running' OR updated_at < now - ttl`) que devuelve fila solo al ganador: atómico en
PostgreSQL, válido con varias instancias. TTL por defecto 10 min (`ESPORTS_AUTO_SYNC_LOCK_TTL_S`):
si el proceso muere, el siguiente entra y lo hace constar (`recoveredStale`). Solo el dueño libera.
Sin Redis ni advisory locks de sesión (no sobreviven al pool de PostgREST). El dry run NO toma el
lock (no escribe ni el lease).

## 9. Idempotencia

- Datos: UPSERT canónico (sin cambios). Sin cambios relevantes y ciclo al día → **cero escrituras**.
- Preguntas: índice único `(pickem_event_id, match_id, kind)`; el corrector reescribe `correct_option`
  solo a partidos que el sync ha visto corregirse.
- Puntos: `app_score_pickem_event` recalcula desde cero y ajusta `profiles.points` por diferencia.
- Recompensas: `app_grant_reward` con ref `pickem:<evento>:<escalón>` por usuario.
- Marcador de convergencia: `sync_state['vlr:event:<id>'].cursor = huella de resultados` escrito solo
  tras un ciclo limpio; huella distinta o estado ≠ ok → el ciclo vuelve a correr.
- Pruebas: mismo resultado 5 veces → 1 resolución por pregunta, 20 puntos, 1 recompensa.

## 10. Backoff

Por evento: `intervalo × 2^fallos` con tope de 6 h; un éxito resetea. La memoria por evento
(`lastAttemptAt`, `lastSuccessAt`, `consecutiveFailures`) vive en la salud (§23). Un evento que
falla no retrasa a los demás.

## 11. Retry

Solo errores TRANSITORIOS (timeout, red, 5xx, 429): hasta 3 intentos con espera 1 s · 2 s. NUNCA
ante 4xx, host no permitido, parse («no parece un torneo») ni validación. Clasificación en
`classifySourceError`.

## 12. Partial failures

Cada evento se sincroniza y falla por su cuenta: `4 OK / 1 ERROR` se refleja en `eventsSynced`,
`eventsFailed`, `errors[]` y en la memoria por evento. `syncTournament` conserva su transacción por
torneo (RPC + upserts) y nunca lanza hacia el runner sin quedar registrado.

## 13. Source validation

`validateRawMatch`: id, equipos con identidad, misma-identidad solo permitida para huecos TBD,
fecha legible, marcadores enteros ≥ 0, ganador ∈ {A, B}, ganador coherente con marcador, `finished`
exige ganador o marcador y no admite huecos, sin progresión hacia sí mismo. Lo contradictorio se
descarta con motivo (`invalid[]`) y se informa; nunca se «arregla».
Lista sospechosa: vacía con partidos conocidos, o < 50 % de ≥ 4 conocidos → `SOURCE_SUSPICIOUS`,
sin escribir nada. El sync nunca borra filas.

## 14. Match transitions

| de → a | decisión |
|---|---|
| upcoming → live, upcoming → finished, live → finished | progreso (se aplica) |
| finished → finished con otro marcador/ganador | **corrección**: se aplica, se registra `RESULT_CORRECTED`, se reconcilia (§15) |
| live → upcoming | reversión (se aplica; no hay resultado que perder) |
| finished (con resultado) → upcoming/live | **regresión**: se RECHAZA, se conserva la fila, `MATCH_REGRESSION_REJECTED` |
| finished (sin resultado) → cualquiera | progreso (aquel «finished» no afirmaba nada) |

## 15. Scoring Pick'ems

Server-authoritative y sin motor paralelo: `app_set_correct_option` + `app_score_pickem_event`. El
ciclo corre solo si hace falta (primer sync, partidos nuevos/cambiados/terminados/corregidos, o ciclo
anterior incompleto); una pasada sin cambios no corrige nada. Correcciones de la fuente:
`LifecycleOptions.reconcileMatchIds` permite reescribir `correct_option` SOLO de esos partidos
(ganador y marcador exacto); los puntos se recalculan por diferencia; lo cobrado no se retira.
Nuevo en dominio: `isPlaceholderTeamName` — un hueco TBD/TBA/TBC no es predecible.

## 16. Champion

Sin cambios de motor: `syncChampionQuestion` / `correctChampionOption` resuelven la gran final por el
lifecycle existente (prueba 31: se resuelve una vez; repetir no la reescribe). Único ajuste: los huecos
TBD no entran en `eventParticipants` (no pueden ser campeón).

## 17. Advance

Sin cambios: `buildQualificationQuestions` (24.4, `winner_qualifies` CONFIRMED) y el corrector del
ganador real. Pruebas 19/32: una pregunta por partido con clasificación, resuelta con el ganador, dos
veces no cambia nada. No nace de un partido TBD vs TBD.

## 18. Rewards

`scorePickemEvent` → `services/rewards.award` (ruta única). Idempotencia por `(usuario, ref)`.
Pruebas 15/17/27–30/35: una recompensa por escalón aunque el resultado se procese cinco veces o se
corrija; tras una corrección que baja de escalón, no se retira lo cobrado (contrato de la Fase 10).

## 19. Bracket

Por partido: resultado, ganador, destino (`winner_to_*`, `loser_to_*`) y clasificación
(`winner_qualifies`) cuando la fuente lo confirma; upsert PARCIAL (solo columnas de estructura, solo
CONFIRMED, solo destinos presentes). Las aristas confirmadas no se reconstruyen si la fuente deja de
traer cuadro. Partidos TBD vs TBD se escriben (son estructura): 20 aristas y 8 nodos de clasificación
en Champions 2026 real.

## 20. Qualification

`standings.status='qualified'` sigue siendo lo que alimenta `correctAdvanceOption` para preguntas sin
partido (24.2) — el sync no lo escribe (P2 heredado). Las de partido (24.4) convergen con el ganador
real. `qualificationsResolved` del resultado cuenta las preguntas resueltas por pasada.

## 21. Dry run

`dryRun: true`: obtiene, parsea, normaliza, valida, compara e informa (`would create/update/finish`,
aristas, conflictos, «1 event would require scoring», avisos que SE REGISTRARÍAN). No escribe, no
corrige, no recompensa, no toma el lock, no persiste salud ni avisos (pruebas 44–50: cero escrituras y
cero RPC medidos con la BD en memoria). Con `sb: null` funciona solo con la fuente (instrumento REAL).

## 22. Security

- `POST /api/internal/esports/sync`: `Authorization: Bearer <SYNC_SECRET>` (o `x-sync-secret`),
  comparación en tiempo constante, mínimo 16 caracteres; sin secreto → 503 (fail closed); sin
  credencial → 401 sin ejecutar; la respuesta nunca contiene secretos ni entorno.
- Sin URLs: el cuerpo con `url/targets/source` → 400; `eventIds` validados (forma y ≤ 20).
- Host allowlist en el fetcher (`www.vlr.gg`); la URL se CONSTRUYE en el servidor desde un id
  numérico; una `vlr_url` que no sea de vlr.gg no es referencia válida (sin SSRF).
- Secretos solo servidor (`SYNC_SECRET` / `ESPORTS_SYNC_SECRET`); nada `NEXT_PUBLIC`; el log redacta
  cualquier campo que huela a secreto.
- `security:verify` verde.

## 23. Observability

Salud persistida en `sync_state['esports:autosync']` (`updated_at` = último intento, `last_synced_at`
= último éxito, `error`, y en `cursor` JSON: duración, resumen de la pasada, fallos consecutivos,
memoria por evento, `nextDueAt`). Avisos con código en `notifications` (0002): `SYNC_FAILED`,
`SOURCE_PARSE_FAILED`, `SOURCE_SUSPICIOUS`, `STRUCTURE_CONFLICT`, `MATCH_REGRESSION_REJECTED`,
`RESULT_CORRECTED`, `SCORING_FAILED` (+ `lock_stale_recovered` en log). Log estructurado
`[esports-sync] event=… status=…`. `/admin/operations` muestra un bloque «Esports sync» (último éxito
relativo, duración, eventos actualizados, fallos consecutivos, último error, siguiente prevista) vía
`OperationsSnapshot.esportsSync` — un `Block` más, sin rehacer Operations.

## 24. Kill switch / config

`ESPORTS_AUTO_SYNC_ENABLED` (default **false**, también en código). `ESPORTS_AUTO_SYNC_INTERVAL_{LIVE,
ACTIVE,UPCOMING,FUTURE,RECENT}_S`, `_TIMEOUT_S` (15), `_MAX_CONCURRENCY` (1, techo 4), `_LOCK_TTL_S`
(600), `_JITTER_RATIO` (0.1), `ESPORTS_SYNC_SECRET` (opcional; si no, `SYNC_SECRET`). Documentado en
`.env.example`. No se ha activado en ningún entorno.

## 25. Migración 0045

Revisada; sin bug de esquema (FK con `on delete set null`, check de autoarista, índices parciales
únicos por hueco, `progression_confidence` solo CONFIRMED). **No aplicada, no modificada.** Lo que sí
había que arreglar era el código que la daba por aplicada: `schemaCompat.ts` reconoce `42703`, sonda
una vez (con caché de 5 min) y degrada: el orquestador omite el upsert de estructura
(`structure.skipped: "pre-0045"`), el lifecycle reintenta sin las tres columnas, y `fetchMatches` del
cliente reintenta con las columnas base. Post-0045 todo se escribe (pruebas 60/61). Deuda anotada:
los índices parciales únicos no son diferibles; un recableado masivo de aristas confirmadas podría
chocar dentro de un mismo UPSERT (P2, no afecta a la activación).

## 26. Resultado REAL SOURCE dry-run (solo lectura, vlr.gg event 2766)

`docs/product/qa/fase24-6/real-source-dryrun-2766.txt` (2026-09-14T08:51Z). 11 páginas en 4,3 s, 0
errores, 0 reintentos. Evento «Valorant Champions 2026», estado fuente **upcoming**, 2026-09-24 →
2026-10-18; 17 «equipos» (16 + TBD), 80 jugadores, **34 partidos, todos upcoming** (primer partido
2026-09-24T05:00Z), cuadro presente con 12 aristas + 8 clasificaciones en la fuente. Política:
clase **future**, intervalo 21 600 s, prioridad 20. Dry run: 34 would create · 0 update · 0 finish ·
0 invalid · **20 confirmed edges · 8 qualification nodes · 0 conflicts** · «1 event would require
lifecycle». Escrituras: ninguna (sb=null, dryRun, lock no adquirido). No hay directo: no se falsea.

## 27. Tests

67 nuevos (1168 → **1235/1235** verdes). `policy.test` (1–10 + config/jitter/plan), `validate.test`
(validación, transiciones, diff, sospechosa, huella, TBD), `sourceRef.test` (24–26, 40, 41, allowlist),
`runner.test` (11–23, 27–36, 44–51, 60–61, descubrimiento, salud, TBD) con `FakeDb` (PostgREST y RPC
del dominio en memoria), `esportsSyncTrigger.test` (37–43, 29, contrato de la ruta). Regresión
(52–59): las suites existentes de Pick'ems, bracket 24.4, live 24.5, leaderboard, rewards y sync
siguen verdes sin modificarlas. Instrumento `_fase24-6-qa-autosync.ts`: 11/11 escenarios
(`docs/product/qa/fase24-6/qa-autosync.md`).

Gates: typecheck ✅ (web + scripts) · build ✅ · security ✅ · pack ✅ · content ✅ ·
distribution ✅ · importer-vlr 69/69 ✅ · competitive ✅ · lint ✅ (eslint sobre todo lo tocado;
`next lint` sigue roto en Next 16, como estaba). `game-loop-verify` y `test:pickems` exigen Supabase
local (ECONNREFUSED 54521, sin Docker): no ejecutados, no son fallo de código.

## 28. P2

1. `standings.status='qualified'` no lo escribe el sync (heredado 24.2): las preguntas `advance` sin
   partido quedan pendientes salvo intervención.
2. Corrección de scoreboard/mapas de un partido ya terminado sin cambio de marcador no se reimporta
   (el corte «sin cambios» solo mira estado/marcador/ganador).
3. Índices parciales únicos de la 0045 no diferibles (recableado masivo de aristas confirmadas).
4. Salud en `sync_state.cursor` como JSON: suficiente hoy; tabla propia si crece.
5. `NEXT_PUBLIC_VLR_API`/`vlrSource` quedan sin uso (proxy que nunca existió): retirar en limpieza.
6. Sin evidencia contra BD real en este entorno (sin Docker): la validación E2E con Postgres queda
   para la activación controlada.

## 29. Pasos exactos para futura activación (fase aparte, controlada)

1. Aplicar `0045_match_progression.sql` en el Supabase objetivo (psql). Verificar con
   `select to_regclass('public.matches')` + `\d matches` que existen las columnas.
2. Comprobar `SYNC_SECRET` (≥ 16 caracteres) en el entorno del servidor; opcionalmente
   `ESPORTS_SYNC_SECRET` dedicado. Nunca `NEXT_PUBLIC_*`.
3. Dry run real con BD: `npm run esports:autosync -- --dry-run --manual` (o
   `POST /api/internal/esports/sync` con `{ "mode": "manual", "dryRun": true }`). Leer el informe:
   would create/update, aristas, «would require scoring». Cero escrituras.
4. Primer sync manual acotado: `npm run vlr:sync -- https://www.vlr.gg/event/2766 --event vlr-2766 --write`
   (sin Pick'ems) y revisar `/pickems`; después `--pickems`.
5. Activar el scheduler: `ESPORTS_AUTO_SYNC_ENABLED=true` y programar el trigger:
   systemd timer / cron cada 2 min → `curl -X POST -H "Authorization: Bearer $SYNC_SECRET"
   https://<host>/api/internal/esports/sync` (el core decide si toca; los que no tocan no cuestan
   nada), o `npm run esports:autosync -- --loop` como servicio.
6. Vigilar `/admin/operations` → «Esports sync» (último éxito, fallos consecutivos) y
   `notifications` con códigos `SYNC_FAILED` / `SOURCE_*` / `SCORING_FAILED`.
7. Kill switch de emergencia: `ESPORTS_AUTO_SYNC_ENABLED=false` (el trigger responde `disabled`).

## Archivos

**Creados:** `src/lib/esports/autosync/{config,policy,validate,lock,health,sourceRef,runner,report,log,index}.ts`,
`src/lib/esports/autosync/testing/fakeSupabase.ts`, `src/lib/esports/autosync/{policy,validate,sourceRef,runner}.test.ts`,
`src/lib/esports/sync/schemaCompat.ts`, `src/server/services/esportsSyncTrigger.ts` (+ `.test.ts`),
`src/app/api/internal/esports/sync/route.ts`, `scripts/esports-autosync.ts`,
`scripts/_fase24-6-qa-autosync.ts`, `scripts/_fase24-6-real-source-dryrun.ts`,
`docs/product/qa/fase24-6/{qa-autosync.md,real-source-dryrun-2766.txt}`, este informe.

**Modificados:** `src/lib/esports/sync/orchestrator.ts` (pre-0045, `lifecycle` opts, `pickem.corrected/notes`),
`src/lib/esports/sync/vlrSnapshotSource.ts` (`sourceUrl` → `events.vlr_url`),
`src/server/services/pickemLifecycle.ts` (pre-0045, `LifecycleOptions.reconcileMatchIds`, `corrected`),
`src/lib/game/client.ts` (`fetchMatches` pre-0045), `src/domain/pickems/questions.ts` (`isPlaceholderTeamName`),
`src/domain/pickems/tournament.ts` (TBD no es participante), `src/server/services/operations.ts` +
`src/app/admin/operations/page.tsx` (bloque Esports sync), `src/app/api/esports/sync/route.ts` (vlr → core),
`scripts/vlr-sync.ts` (escritura por el core), `package.json` (`esports:autosync[:dry-run]`), `.env.example`.

**No tocado:** Marketplace, packs, RNG, minting, colección, inventario, Duelos, PvP, matchmaking,
rating, settlement, Trainer, teamIdentities, Team Packs, economía, XP/level, migraciones (0045 intacta).

**FASE 24.6 — CERRADA** (activación pendiente y deliberadamente fuera de esta fase).
