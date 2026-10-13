# FASE 24.7 — PRODUCTION LIVE PIPELINE ACTIVATION · 0045 + dry run real + sync real + autosync

**Estado:** PARCIAL, detenida a propósito antes del scheduler · **Fecha:** 2026-09-14
**Rama:** `arch/stabilization` · **Sin commit/push** · **Sin Docker local** · **Marketplace intacto**

> Lo que se afirma aquí se ha ejecutado y medido contra la base de datos real del VPS. Lo que no
> se ha ejecutado se dice como tal. Se paró antes de instalar el scheduler porque hacerlo exigía
> inventar un proceso de despliegue de DRLCards en el VPS que no existe (§15, §26).

| Bloque | Estado |
|---|---|
| CONSTRUIDO (24.6) | ✅ core, triggers, policy, lock, dry run, salud |
| MIGRADO (0045) | ✅ aplicada en la BD real, backup previo verificado |
| DESPLEGADO | ⚠️ el código corre en el PC contra la BD del VPS (vía documentada); en el VPS no hay app NEXUS |
| PROBADO EN PRODUCCIÓN | ✅ dry run (cero escrituras), sync real, idempotencia, Pick'ems reales, trigger, kill switch |
| ACTIVADO (autosync/timer) | ❌ NO: kill switch OFF, scheduler no instalado (decisión pendiente) |
| PENDIENTE DE EVENTO REAL | scoring, champion, advance, rewards: llegarán con los primeros resultados de Champions 2026 (24 sept) |

---

## 1. Precheck VPS (solo lectura)

- `hostname` VM-4b2a3727…, usuario `nexusadmin`, uptime 2 d 13 h, disco 20 G/493 G (4 %), RAM 7 G/64 G
  usados, carga 1,8. Docker 29.8. Sin Node en el host, sin pm2, sin unidades systemd de NEXUS.
- Stack Supabase de DRLCards: `/opt/nexus/projects/supabase-drlcards/compose.yml` → contenedores
  `supabase_*_DRLCards` (kong `127.0.0.1:54521`, db `127.0.0.1:54522`, PostgreSQL 17.6). `vector` y
  `edge_runtime` en `Restarting` (preexistente, ajeno a esta fase; kong/rest/db/auth `healthy`).
- Inventario del VPS (`/opt/nexus/NEXUS-INFRASTRUCTURE-MIGRATION.md`): la BD de DRLCards se migró
  desde el PC y se documenta como «dev stack» accesible por túnel SSH. **No existe app
  NEXUS/DRLCards desplegada en el VPS ni procedimiento de deploy para ella.** La app corre en el PC
  (`next start`) contra `http://127.0.0.1:54521` a través del túnel.
- Confirmación de entorno: única BD de DRLCards existente (Docker del PC desinstalado); 107 tablas
  `public`, 2 eventos (`demo-masters-madrid-2026`, `vlr-2976-emea-stage-2`), 67 partidos, 6
  preguntas, 9 perfiles, 29 MB. Esquema en 0044 (`coach_matches` existe); 0045 ausente.

## 2. Git / deploy inicial

PC: rama `arch/stabilization`, HEAD `48dac2a`, 573 ficheros sin commit (24.x). VPS: sin checkout
del repo. No se ha hecho commit, push, reset, stash ni checkout.

## 3. Backup

`/opt/nexus/backups/supabase-drlcards/pre-0045/backup_pre_0045_20260914T090638Z.dump` (+ `.sha256`),
`pg_dump -Fc` como usuario `supabase_admin` (mismo método que el backup diario del VPS), exit 0,
2 103 859 bytes, `pg_restore -l` → 1697 entradas TOC, incluye `TABLE DATA` de events/matches/
pickem_questions. Permisos 600. No se ha restaurado. Backups diarios previos intactos.

## 4. Precheck 0045

Migración leída entera: solo `ALTER … ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT` check, índices
parciales únicos + índices, `COMMENT`. Sin DROP, sin reescritura de datos. Ninguna de las 10
columnas, 4 índices ni la constraint existía. Datos: 67 partidos con 67 ids distintos; las columnas
nuevas nacen NULL, así que ningún check/FK/índice podía violarse. SHA-256 del fichero idéntico en
PC y VPS (`7904a19d…`).

## 5. Aplicación de 0045

`psql -v ON_ERROR_STOP=1 -1 -f -` en el contenedor `supabase_db_DRLCards`, base `postgres`:
inicio 09:07:08.851Z, fin 09:07:09.007Z (156 ms), exit 0. Único aviso: `NOTICE constraint
matches_no_self_progression does not exist, skipping` (el `drop … if exists` previo al `add`).
Solo esta migración; sin reset ni replay.

## 6. Verificación de esquema

10 columnas con tipo y nulabilidad esperados (`text`/`smallint`/`timestamptz`, todas NULL), 2 FK
`… REFERENCES matches(id) ON DELETE SET NULL`, 5 checks (slots ∈ {1,2}, evidence, confidence solo
CONFIRMED, no-autoarista), 2 índices únicos parciales + 2 índices. Smoke: events 2, matches 67 (0
con estructura), pickems 2/6/0/1, lectura de fila con las columnas nuevas OK.
`supabase_migrations.schema_migrations` solo registra 0001–0025: 0026–0044 ya estaban aplicadas a
mano sin registro, y registrar solo 0045 haría creer al CLI que 0026–0044 faltan. No se ha insertado.

## 7. Código desplegado

El código 24.6 está en el PC (working tree) y es el que ha ejecutado todo lo siguiente contra la BD
real por el túnel, que es la vía documentada de acceso. No se ha subido nada al VPS: no hay
runtime Node ni app allí y el brief prohíbe inventar un proceso de deploy.

## 8. Secretos

`.env.local` del PC (ignorado por Git): `SYNC_SECRET` generado con 32 bytes aleatorios (base64url,
43 caracteres) y `ESPORTS_AUTO_SYNC_ENABLED=false`. Sin `NEXT_PUBLIC_*`. El secreto no aparece en
logs (comprobado con grep sobre el log del servidor) ni en este informe.

## 9. Dry run en PRODUCCIÓN

`_fase24-7-live-target.ts 2766 --event vlr-2766` (core, modo manual, `dryRun`): fuente
`https://www.vlr.gg/event/2766`, 37 páginas, 16,5 s. Champions 2026 **upcoming**, 34 partidos en
fuente → 34 would create · 0 update · 0 finish · 0 inválidos · **20 aristas confirmadas · 8 nodos de
clasificación · 0 conflictos** · 0 candidatos a scoring. 106 «identidades sin resolver» = mapas
llamados «TBD» en partidos sin jugar (inertes: solo se escriben mapas de partidos terminados).
**Cero escrituras**: 18 tablas con recuento idéntico antes/después, `sync_state` sin tocar, lock no
adquirido, 0 notificaciones nuevas.

## 10. Primer sync real (09:10Z, sin Pick'ems)

Mismo instrumento con `--write`: lock adquirido, 18,9 s, 0 errores. Escrito: events 2→3
(`vlr-2766`, `vlr_url` persistida, 2026-09-24 → 10-18), matches 67→101 (34 upcoming), teams 24→37
(incluye el hueco `vlr-t-tbd`), players 84→145, stages 4→6, `sync_state` 1→4 (lock, salud, evento).
Estructura: 12 filas con `winner_to_match_id`, 8 con `winner_qualifies`, 20 `CONFIRMED`, 0 huecos
duplicados. Sin cambios en match_maps, stats, pickems, profiles, credit_transactions, notifications.

## 11. Segundo sync / idempotencia (09:11Z)

Mismo comando: estado `unchanged — sin cambios en la fuente`, +0 nuevos, 0 cambios, todas las tablas
con el mismo recuento (solo `sync_state` actualiza lock/salud). Tercer sync con `--pickems` (09:12Z):
Pick'em creado para `vlr-2766` (`open`, cierre 2026-10-18), **17 preguntas**: 8 `match_winner` +
8 `match_score` (solo los 8 partidos con equipos reales) + 1 `champion` con 16 opciones reales.
0 preguntas con «TBD», 0 duplicadas, 0 resueltas (correcto: nada ha terminado). Marcador de
convergencia escrito (`34:6ce4f87e`). Notificación `pickem_lifecycle` (info) registrada.

## 12. Estado real de `/pickems`

`next start -p 3005` con la build de 24.6 contra la BD real: `/pickems` 200, sin errores de consola.
Muestra Champions 2026 como **PRÓXIMAMENTE**, 0/34 partidos, 0/17 predicciones, «Siguiente cierre:
¿Quién será campeón?», cuadro Group Stage con 16 rondas (Apertura/Ganadores/Eliminación/Decisivo por
grupo), aristas confirmadas dibujadas hacia huecos «TBD» («20 conexiones · 20 de estructura confirmada
· 0 por resultado»), equipos y horas reales. Sin directo fingido. No se ha tocado ningún pick de usuario.

## 13. Seguridad del trigger

`POST /api/internal/esports/sync`: sin auth → 401; auth incorrecta → 401; cuerpo con `url` → 400;
auth correcta + `mode:"manual", dryRun:true, eventIds:["vlr-2766"]` → 200 con resultado (clase
`future`, sin cambios, lock no adquirido). El secreto no aparece en las respuestas ni en el log.

## 14. Kill switch

Con `ESPORTS_AUTO_SYNC_ENABLED=false`, el trigger en modo scheduled responde
`{"skipped":"disabled","enabled":false}` sin ejecutar nada (medido). La CLI
`npm run esports:autosync -- --dry-run --manual` descubre 2 eventos: `vlr-2766` (future, intervalo
21 600 s, siguiente 15:12Z) y `vlr-2976-emea-stage-2` (archivado, no se sondea).

## 15. Scheduler · NO INSTALADO (parada deliberada)

Para un timer en el VPS haría falta ejecutar el core allí, y en el VPS no hay Node, ni el repo, ni
un proceso de deploy de DRLCards; crear un stack Node nuevo con el working tree sin commitear sería
inventar un despliegue y una plataforma, cosas que el brief prohíbe, y además exigiría commit/push.
Opciones para decidir (ninguna ejecutada):

1. **Stack en el VPS** siguiendo el patrón de la casa (`/opt/nexus/projects/nexus-esports-sync/` con
   `compose.yml`, imagen `node:22-alpine`, repo sincronizado por `rsync`/`tar` como en «Actualizar una
   aplicación», `npm ci`, `EnvironmentFile` 600 con `NEXT_PUBLIC_SUPABASE_URL=http://supabase_kong_DRLCards:8000`
   en la red del stack Supabase) + `nexus-esports-sync.timer` (`OnUnitActiveSec=2min`) →
   `nexus-esports-sync.service` (`Type=oneshot`, `docker compose run --rm sync npm run esports:autosync`).
   Requiere: decidir qué se despliega (commit), y aceptar Node/repo en el VPS.
2. **Tarea programada en el PC** (`schtasks` cada 2 min → `npm run esports:autosync`) con el túnel
   abierto: mismo core, sin secreto HTTP, pero depende de que el PC y el túnel estén levantados.
3. **Desplegar la app NEXUS entera en el VPS** (decisión de producto más amplia).

En cualquier caso el orden es: instalar el mecanismo con el kill switch OFF → observar un ciclo
`skipped=disabled` → `ESPORTS_AUTO_SYNC_ENABLED=true` → observar dos ciclos (el primero sincroniza si
toca; el segundo debe decir «no toca» para `vlr-2766` hasta 6 h después) → vigilar salud.

## 16–17. Ciclos automáticos

No ejecutados (no hay scheduler). Lo equivalente medido a mano: dos pasadas consecutivas del core en
manual → la segunda `unchanged` con cero escrituras; la política asigna `future`/6 h a Champions
2026 y no sondea el evento archivado.

## 18. Lock

`sync_state['esports:autosync:lock']` = `idle` tras cada pasada; adquirido/liberado en las 3 pasadas
de escritura; en dry run no se toca. La prueba de dos triggers simultáneos se hizo en 24.6 con la BD
en memoria (una efectiva, una `locked`); no se ha repetido contra producción para no lanzar dos
descargas concurrentes a VLR sin necesidad.

## 19. Operations / salud

`sync_state['esports:autosync']`: status `ok`, `last_synced_at` 09:12:04Z, `lastDurationMs` 19064,
`consecutiveFailures` 0, `lastResult` (runId, 1 evento, 0 errores), memoria de `vlr-2766`. La
pantalla `/admin/operations` no se ha abierto (exige sesión admin en el navegador; no se han usado
credenciales); el bloque «Esports sync» lee esta fila y está cubierto por build y tests.

## 20. Logs / notificaciones

`notifications`: 2 `sync_error` antiguas (2026-09-03, sync anterior de EMEA Stage 2) y 2
`pickem_lifecycle` (info). **Ninguna** `SYNC_FAILED`, `SOURCE_PARSE_FAILED`, `SOURCE_SUSPICIOUS`,
`STRUCTURE_CONFLICT` ni `SCORING_FAILED` nuevas. Log del servidor sin 500/Unhandled; cero reintentos
en las 5 descargas de VLR (37 páginas cada una, ~17 s).

## 21. Recursos VPS

Tras las pasadas: carga 3,2 (compartida con ~40 contenedores de otros proyectos), RAM 7 G/64 G,
`supabase_db` 1 % CPU / 200 MiB, `kong` 17 % / 156 MiB durante la pasada, `rest` 1 %, 16 conexiones
a `postgres`. Sin degradación apreciable.

## 22. Rollback

- Autosync: `ESPORTS_AUTO_SYNC_ENABLED=false` (ya está así) + deshabilitar el timer si existiera.
- Datos de Champions 2026: son datos reales importados; no requieren rollback. Si hiciera falta
  volver al estado previo exacto: `pg_restore` del backup de §3 (procedimiento del propio
  `nexus-backup.sh`); no se recomienda salvo corrupción.
- 0045: columnas aditivas y NULL; no se revierte por reflejo.

## 23. Tests / gates

Código final (solo se añadió `scripts/_fase24-7-live-target.ts`): `npm test` 1235/1235 ✅ ·
typecheck web + scripts ✅ · build ✅ (24.6, sin cambios en `src/`) · security, pack, content,
distribution ✅ · importer-vlr 69/69 ✅ · competitive ✅ · lint del nuevo script ✅ · tests
autosync 67/67 ✅. `game-loop-verify` y `test:pickems` no se han lanzado contra la BD real (escriben
datos de prueba: prohibido en producción).

## 24. P2

Los de 24.6 (standings `qualified`, scoreboard sin cambio de marcador, índices no diferibles, salud
en `cursor`, `NEXT_PUBLIC_VLR_API` sin uso) + nuevos: `supabase_migrations.schema_migrations`
desincronizada (0026–0045 sin registrar); `vector`/`edge_runtime` del stack en `Restarting`;
mapas «TBD» del conector para partidos sin jugar (inertes); decisión de dónde corre el scheduler.

## 25. Estado FINAL

- 0045 APPLIED ✅ · BACKUP VERIFIED ✅ · SYNC_SECRET CONFIGURED (PC, server-side) ✅
- DRY RUN PASS (cero escrituras) ✅ · MANUAL REAL SYNC PASS ✅ · IDEMPOTENCY PASS ✅
- PICK'EMS REALES: Champions 2026 abierto con 17 preguntas ✅ · `/pickems` OK ✅
- TRIGGER PROTEGIDO ✅ · KILL SWITCH OFF y probado ✅
- CODE DEPLOYED ⚠️ (en el PC, no en el VPS) · AUTOSYNC ENABLED ❌ · TIMER ACTIVE ❌ (decisión pendiente)
- Marketplace, packs, duelos, economía: intactos. Sin commit ni push.

## 26. Archivos / configuración

VPS: `/opt/nexus/backups/supabase-drlcards/pre-0045/backup_pre_0045_20260914T090638Z.dump{,.sha256}`;
BD `postgres`: 0045 aplicada; filas nuevas en `events`, `matches`, `teams`, `players`, `stages`,
`pickem_events`, `pickem_questions`, `sync_state`, `notifications`. Nada más en el VPS (sin unit
files, sin cron, sin ficheros de código). PC: `.env.local` (`SYNC_SECRET`, `ESPORTS_AUTO_SYNC_ENABLED=false`),
`scripts/_fase24-7-live-target.ts`, `docs/product/qa/fase24-7/*.txt` (logs sin secretos), este informe.

**FASE 24.7 — INCOMPLETA (parada controlada antes del scheduler; todo lo demás demostrado).**
