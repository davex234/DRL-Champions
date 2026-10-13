-- ROLLBACK de 0071_pickems_bracket (F87 · Pick'ems 2.0). Quita los cuadros de predicción: ÁMBITOS, PICKS, FOTOS DE
-- LIQUIDACIÓN y RECLAMOS (tablas y su contenido) y sus RPC. NO toca el Pick'em de 0012 ni los datos esports reales.
-- Lo ya concedido por reclamos (asientos `pickem_bracket:*` del libro, sobres, insignias) NO se retira: es del jugador.
-- Antes de ejecutarlo, si hay datos: \copy (select * from public.pickem_bracket_picks) to '…csv' csv header (y el resto).
begin;
drop function if exists public.app_pickem_admin_settle(uuid, uuid, int, text);
drop function if exists public.app_pickem_admin_match(uuid, uuid, text, text, timestamptz, text);
drop function if exists public.app_pickem_admin_set_rewards(uuid, uuid, jsonb, text, text, int, boolean);
drop function if exists public.app_pickem_admin_set_status(uuid, uuid, text, int, text, text);
drop function if exists public.app_pickem_admin_save_draft(uuid, uuid, text, text, text, text, text[], jsonb, text, jsonb, int, text, int);
drop function if exists public.app_pickem_claim(uuid, uuid);
drop function if exists public.app_pickem_save_pick(uuid, uuid, text, text, int, text[]);
drop trigger if exists pickem_claims_guard on public.pickem_bracket_claims;
drop trigger if exists pickem_picks_guard on public.pickem_bracket_picks;
drop trigger if exists pickem_nodes_guard on public.pickem_bracket_matches;
drop trigger if exists pickem_brackets_guard on public.pickem_brackets;
drop table if exists public.pickem_bracket_claims;
drop table if exists public.pickem_bracket_picks;
drop table if exists public.pickem_bracket_entries;
drop table if exists public.pickem_bracket_matches;
drop table if exists public.pickem_brackets;
drop function if exists public._pickem_tier(jsonb, numeric, numeric, boolean);
drop function if exists public._pickem_audit(uuid, text, uuid, jsonb);
drop function if exists public._pickem_require_admin(uuid);
drop function if exists public._pickem_claims_guard();
drop function if exists public._pickem_picks_guard();
drop function if exists public._pickem_nodes_guard();
drop function if exists public._pickem_brackets_guard();
drop function if exists public.pickem_match_locked(uuid, text, timestamptz);
commit;
