# FASE 35.1 · Plan de rollback (preparado, NO ejecutado)

Backup previo verificado: `/opt/nexus/backups/supabase-drlcards/pre-0046-0051/backup_pre_0046_0051_20260915T115455Z.dump` (ver postflight). **No restaurar el backup completo por un problema menor**: devolvería la BD entera a 11:54:55Z y perdería TODO lo escrito después (partidas, cartas, créditos, telemetría, sync del worker).

Principios:
- Revertir en orden inverso (0051 → 0046) y solo la migración afectada: no hay dependencias cruzadas entre ellas.
- Cada bloque en una transacción con `set local lock_timeout = '5s'`.
- Antes de revertir, `select count(*)` de las tablas afectadas y exportar sus filas si hay datos que conservar.
- Preferir **forward fix** (nueva migración correctiva) cuando la migración ya tiene datos de usuarios.

## 0051 · Road to Champions

```sql
begin;
drop table if exists public.campaign_attempts;
drop table if exists public.campaign_progress;
commit;
```
**Pérdida de datos:** todo el progreso y los intentos de campaña desde la aplicación (0 filas a 12:02Z). Los créditos de primera victoria ya concedidos NO se revierten: viven en `credit_transactions` (ref `campaign:<campaña>:<nodo>`) y deben tratarse aparte si hiciera falta. Efecto en la app: vuelve a «TODAVÍA NO DISPONIBLE» (degradación ya probada).

## 0050 · Equipo activo

```sql
begin;
drop function if exists public.duel_deck_activate(uuid, uuid, timestamptz);
drop table if exists public.duel_active_deck;
commit;
```
**Pérdida de datos:** qué equipo tenía activo cada jugador (los equipos en `duel_decks` NO se tocan). La app vuelve a «equipo activo no disponible» (503 NOT_READY).

## 0049 · Personalización de perfil

```sql
begin;
drop function if exists public.player_profile_set(uuid, uuid[], text[], int);
drop table if exists public.player_profile_customization;
drop function if exists public._uuid_array_is_unique(uuid[]);
drop function if exists public._text_array_is_unique(text[]);
commit;
```
**Pérdida de datos:** vitrinas y logros destacados guardados. Cartas y logros intactos.

## 0048 · Social + PVP_PRIVATE

Requiere decidir qué hacer con las partidas privadas existentes: el CHECK antiguo no las admite.
```sql
begin;
-- 1) Solo si hay partidas privadas: exportarlas antes; esto las ELIMINA.
delete from public.duel_matches where mode = 'PVP_PRIVATE';
-- 2) Restricciones originales (0031)
alter table public.duel_matches drop constraint if exists duel_matches_mode_check;
alter table public.duel_matches add constraint duel_matches_mode_check check (mode in ('PVE','PVP'));
alter table public.duel_matches drop constraint if exists duel_matches_mode_shape;
alter table public.duel_matches add constraint duel_matches_mode_shape check (
  (mode = 'PVE' and player_b_id is null and deck_b_id is null)
  or (mode = 'PVP' and player_b_id is not null and deck_b_id is not null and player_b_id <> user_id));
-- 3) Funciones PvP: volver a ejecutar sus definiciones de 0035 (mode = 'PVP')
--    \i supabase/migrations/0035_pvp_turn_timeout.sql  (solo los tres CREATE OR REPLACE afectados + sus grants)
-- 4) Objetos sociales
drop function if exists public.social_friend_request(uuid,uuid), public.social_friend_respond(uuid,uuid,boolean),
  public.social_unfriend(uuid,uuid), public.social_block(uuid,uuid), public.social_unblock(uuid,uuid),
  public.social_challenge_expire_due(uuid), public.social_challenge_create(uuid,uuid,uuid,uuid,int),
  public.social_challenge_respond(uuid,uuid,boolean,uuid), public.social_challenge_mark_matched(uuid,uuid),
  public.social_challenge_fail(uuid), public.social_challenge_cancel(uuid,uuid);
drop table if exists public.duel_challenges;
drop table if exists public.duel_friendships;
drop index if exists public.duel_matches_private_a_idx, public.duel_matches_private_b_idx, public.profiles_username_lower_idx;
alter table public.profiles drop column if exists last_seen_at;
commit;
```
**Pérdida de datos:** amistades, bloqueos, retos, presencia (`last_seen_at`) y — si existen — partidas privadas. Rating y partidas PVE/PVP intactos. `drop column` es solo metadatos (sin reescritura).

## 0047 · Índices PvP

```sql
begin;
drop index if exists public.duel_pvp_ratings_ladder_idx, public.duel_matches_pvp_a_recent_idx, public.duel_matches_pvp_b_recent_idx;
commit;
```
**Pérdida de datos:** ninguna (solo rendimiento).

## 0046 · Flows de telemetría

El CHECK antiguo rechaza filas con los flows nuevos: hay que retirarlas antes.
```sql
begin;
-- Exportar primero si se quieren conservar; esto las ELIMINA.
delete from public.telemetry_events where flow in ('duel_play','progression','competitive','social','live_events','player_profile','deck_management','season','campaign');
alter table public.telemetry_events drop constraint if exists telemetry_events_flow_check;
alter table public.telemetry_events add constraint telemetry_events_flow_check
  check (flow is null or flow in ('deck_builder','pack_ceremony','pickem_form','market_listing_form'));
commit;
```
**Pérdida de datos:** eventos de telemetría con flows nuevos (0 filas a 12:04Z; el código aún no los emite).

## Último recurso: restauración completa

Solo ante corrupción grave demostrada y con decisión explícita. Restaurar sobre una base NUEVA para extraer datos, no sobre `postgres` en caliente:
```bash
docker exec supabase_db_DRLCards createdb -U postgres restore_check
docker exec -i supabase_db_DRLCards pg_restore -U postgres -d restore_check --no-owner < backup_pre_0046_0051_20260915T115455Z.dump
```
