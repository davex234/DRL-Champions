# Fase 39 · Migración 0053 — Draft Gauntlet

`supabase/migrations/0053_draft_gauntlet.sql` · **APLICADA** en la BD del VPS el **2026-09-15 22:26Z** (una transacción,
`ON_ERROR_STOP`). **Sin registrar** en `supabase_migrations.schema_migrations` (P2 heredado: el registro sigue en
0001–0025; no se toca en esta fase).

## 1. Por qué hace falta

1. Una run debe sobrevivir a recarga, pestañas, cierre del navegador y reinicio de la app con sus ofertas **exactas**:
   React/`localStorage` no sirven y ninguna tabla existente guarda semilla, ofertas, elecciones, rivales y versión.
2. El combate del draft es la partida canónica (`duel_matches`) pero **no** puede ser `mode = 'PVE'`: el pago por
   partida, la campaña, el vestíbulo y las guardas de partida en curso leen `PVE`. Hace falta un modo propio y los
   CHECK de `duel_matches` no lo admitían.

## 2. Qué crea

| Objeto | Detalle |
|---|---|
| `duel_matches_mode_check` | `mode in ('PVE','PVP','PVP_PRIVATE','DRAFT_GAUNTLET')` |
| `duel_matches_mode_shape` | `DRAFT_GAUNTLET` con la forma de PvE (sin jugador B ni mazo B); PvP intacto |
| `draft_runs` | id, user_id, status (6 estados, CHECK), stage 1..5, version ≥ 1, seed 32 bits, rules_version, data_version, state jsonb objeto ≤ 32 KB, current_match_id (solo en `IN_MATCH`), created/updated/completed_at (`completed_at` ⇔ final) |
| `draft_runs_one_active` | índice único parcial `(user_id) where status in ('DRAFTING','READY','IN_MATCH')` |
| `draft_runs_user_idx` | `(user_id, created_at desc)` |
| `draft_run_matches` | PK `(run_id, stage)`, `match_id` único → `duel_matches(id) on delete set null`, difficulty, status `STARTED/SETTLED/ABANDONED`, result `WIN/LOSS/DRAW` (⇔ `SETTLED`), marcador 0..10 |
| RLS | activada en las dos tablas, **sin políticas** |
| Grants | `REVOKE ALL` a `anon` y `authenticated`; `GRANT ALL` a `service_role` |

Sin funciones, sin triggers, sin `SECURITY DEFINER`. No toca `user_cards`, economía, rating, campaña ni sobres.

## 3. Procedimiento seguido (2026-09-15, Fase 39)

> Honestidad sobre la evidencia: la aplicación se hizo en la sesión anterior de esta fase. Se conservan los SQL
> (`f39-precheck.sql`, `f39-rehearsal.sql`, `f39-probes.sql`, `f39-postflight.sql`) y el registro de resultado
> (fecha, backup, sha256, tamaño, tablas 91→93), pero **no la salida literal** de consola del ensayo. Por eso §4
> repite los probes contra el esquema aplicado y re-verifica el backup.

| Paso | Resultado |
|---|---|
| 1 Baseline verde | tests + verificadores de draft en verde antes de tocar la BD |
| 2 SQL inspeccionado | aditivo e idempotente (`if not exists`, `drop constraint if exists`) |
| 3 Identidad VPS | `212.95.40.144`, host `VM-4b2a3727…`, stack `supabase-drlcards` |
| 4 Identidad BD | contenedor `supabase_db_DRLCards`, base `postgres` |
| 5 Preflight de ausencia | `draft_runs`/`draft_run_matches` ausentes; 0052 y 0051 presentes; CHECK de modo sin `DRAFT_GAUNTLET` |
| 6 Huella previa | recuentos de `user_cards`, `credit_transactions`, `duel_matches`, campaña, rating, perfiles, favoritos; md5 de constraints; 91 tablas públicas |
| 7 Backup | `pg_dump -Fc` → `/opt/nexus/backups/supabase-drlcards/pre-0053/supabase-drlcards-pre0053-20260915T222534Z.dump` (2.191.205 bytes) |
| 8 sha256 | `03749239ec683e8fd3235eb23ba7a8c0a93dc14c2d8dee2eec9a94021d71c5d6` (**re-verificado 2026-09-16**) |
| 9 `pg_restore -l` | legible (re-verificado 2026-09-16: 1.807 entradas de TOC, **0** objetos `draft_run*` → es anterior a 0053) |
| 10 Reversión | documentada en la cabecera de 0053 (§4) |
| 11 Ensayo | `BEGIN → 0053 → probes → ROLLBACK` |
| 12–14 Probes | RLS, grants, CHECKs, índice de run única, PK/unique de combate, `set null`, cascada |
| 15 Aplicación | `psql -v ON_ERROR_STOP=1`, una transacción, exit 0 |
| 16 Postflight | tablas, RLS, 0 políticas, grants, 6 índices, CHECKs nuevos, 0 filas |
| 17 Huella posterior | recuentos iguales; tablas públicas 91 → 93 |

No se reinició nada (PostgREST recoge tablas nuevas con su event trigger).

## 4. Re-verificación en esta sesión (2026-09-16, sin persistir)

Probes re-ejecutados contra el esquema aplicado dentro de `BEGIN … ROLLBACK` (`f39-probes-rerun.sql`), añadiendo
pruebas con los **roles reales** (`set local role authenticated` con `request.jwt.claims` del propio usuario, y `anon`):

```
P_tables|t|t                         P_policies|0
P_rls|draft_run_matches|t            P_rls|draft_runs|t
P_grants_anon|f|f|f|f                P_grants_authenticated|f|f|f|f|f|f
P_grants_service_role|t|t|t|t
P_insert_run OK            P_one_active OK            P_status_check OK
P_final_needs_completed OK P_finished_plus_active OK  P_seed_range OK
P_state_bounded OK         P_match_only_in_match OK   P_duel_mode_draft_insert OK
P_duel_mode_shape OK       P_duel_mode_check OK       P_insert_stage OK
P_stage_pk OK              P_match_unique OK          P_settled_needs_result OK
P_stage_range OK           P_match_set_null OK        P_cascade OK
P_existing_rows_valid OK
P_auth_select_own OK (permission denied)   ← ni el DUEÑO lee su run con su token
P_auth_insert OK   P_auth_update OK   P_auth_matches_select OK   P_anon_select OK
ROLLBACK · post_rollback_rows|0|0
```

`P_definer_functions|1` es un **falso positivo** del patrón `%draft%`: `app_content_update_draft` (0041, gestor de
cartas del admin), anterior y ajena a esta fase.

Postflight actual: 93 tablas públicas, 68 políticas públicas, índices `draft_runs_one_active`, `draft_runs_pkey`,
`draft_runs_user_idx`, `draft_run_matches_pkey`, `draft_run_matches_match_id_key`, `draft_run_matches_user_idx`.

## 5. Reversión (manual, solo si no hay partidas DRAFT_GAUNTLET que conservar)

```sql
begin;
delete from public.duel_matches where mode = 'DRAFT_GAUNTLET';
drop table if exists public.draft_run_matches;
drop table if exists public.draft_runs;
alter table public.duel_matches drop constraint if exists duel_matches_mode_check;
alter table public.duel_matches add constraint duel_matches_mode_check check (mode in ('PVE','PVP','PVP_PRIVATE'));
alter table public.duel_matches drop constraint if exists duel_matches_mode_shape;
alter table public.duel_matches add constraint duel_matches_mode_shape check (
  (mode = 'PVE' and player_b_id is null and deck_b_id is null)
  or (mode in ('PVP','PVP_PRIVATE') and player_b_id is not null and deck_b_id is not null and player_b_id <> user_id));
commit;
```

Alternativa total: `pg_restore` del backup de §3.7.

## 6. Degradación sin la migración

El servicio detecta la tabla ausente (`42P01` / `PGRST205`): `GET` → 200 `available:false` («DRAFT GAUNTLET TODAVÍA NO
DISPONIBLE»), acciones → 503 `MIGRATION_PENDING`, cero escrituras (test S02).

## 7. Qué NO se tocó

`schema_migrations`, worker de Pick'ems, cron, importador VLR, Caddy, Cloudflare, Kong, Auth, Storage, Realtime,
firewall, SSH. Sin reinicios. (Re-verificado 2026-09-16: `db`/`kong` «Up 3 days (healthy)», `rest` «Up 3 days», una
entrada `run-sync` en el crontab de `nexusadmin`.)
