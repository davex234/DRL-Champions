-- =============================================================================================================
-- 0075 + 0076 SOBRE UNA COPIA RESTAURADA DE PRODUCCIÓN (contenedor desechable, --network none). Una transacción con
-- ROLLBACK: lo que se prueba es que las funciones nuevas FUNCIONAN contra el esquema y los datos reales (firmas de
-- app_season_apply y app_admin_audit, restricciones de game_seasons, user_cosmetics, auditoría…), no solo que se crean.
-- Variables psql (de tc-0075-vars.sql): :plan_china_team, :plan_china, :season_config, :season_levels.
-- =============================================================================================================
\set QUIET on
begin;
select set_config('qa.team', :'plan_china_team', true), set_config('qa.region', :'plan_china', true);
-- Una cuenta real (la primera por id) y un admin real. Nada sale de esta transacción.
select set_config('qa.user', (select id::text from public.profiles where not is_admin order by id limit 1), true);
select set_config('qa.user', coalesce(nullif(current_setting('qa.user'), ''), (select id::text from public.profiles order by id limit 1)), true);
select set_config('qa.admin', (select id::text from public.profiles where is_admin order by id limit 1), true);
select set_config('qa.other', (select id::text from public.profiles where id::text <> current_setting('qa.user') order by id limit 1), true);
-- Temporada de ensayo, activa ahora y sin solaparse con temporada-2 (empieza el 30/11). Los disparadores de 0064 obligan
-- a publicar desde el panel: aquí se inserta sin ellos, solo dentro de esta transacción.
set local session_replication_role = replica;
insert into public.game_seasons (id, number, name, description, status, starts_at, ends_at, claim_until, max_level, config, checksum, published_at)
values ('qa-rehearsal-season', 902, 'QA-REHEARSAL', 'QA-REHEARSAL', 'PUBLISHED', now() - interval '1 day', now() + interval '20 days', now() + interval '25 days', :season_levels, :'season_config'::jsonb, 'qa', now());
set local session_replication_role = origin;

do $$
declare
  u uuid := current_setting('qa.user')::uuid; adm uuid := current_setting('qa.admin')::uuid; oth uuid := current_setting('qa.other')::uuid;
  team jsonb := current_setting('qa.team')::jsonb; region jsonb := current_setting('qa.region')::jsonb;
  cards text[]; missing int; r jsonb; n int; xp0 int;
begin
  select array_agg(x) into cards from jsonb_array_elements_text(team -> 0 -> 'cards') x;
  select count(*) into missing from unnest(cards) c where not exists (select 1 from public.content_cards k where k.card_id = c and k.lifecycle = 'PUBLISHED');
  if missing > 0 then raise exception 'FALLO: % cartas del plan no están publicadas en la copia de producción', missing; end if;
  raise notice 'OK 0 · el plan (catálogo del código) coincide con las cartas publicadas de producción';

  -- 1 · Incompleto: con lo que la cuenta tiene hoy, nada.
  r := public.app_team_collections_settle(u, team, '[]'::jsonb, null, 300);
  if r->'teams'->0->>'code' <> 'INCOMPLETE' or exists (select 1 from public.user_team_completions where user_id = u) then raise exception 'FALLO 1: %', r; end if;
  raise notice 'OK 1 · cuenta real sin el equipo completo: INCOMPLETE, nada guardado';

  -- 2 · Completo sin temporada activa (producción hoy): compleción guardada, XP pendientes.
  insert into public.user_cards (uid, user_id, card_id, origin, locked, obtained_at)
  select gen_random_uuid(), u, c, 'pack', false, now() from unnest(cards) c
   where not exists (select 1 from public.user_cards k where k.user_id = u and k.card_id = c);
  r := public.app_team_collections_settle(u, team, '[]'::jsonb, null, 300);
  if r->'teams'->0->>'code' <> 'COMPLETED' or (r->>'xpGained')::int <> 0 then raise exception 'FALLO 2: %', r; end if;
  if (select xp_granted_at is null and xp_amount is null from public.user_team_completions where user_id = u) is not true then raise exception 'FALLO 2: no quedó pendiente'; end if;
  raise notice 'OK 2 · sin temporada activa: compleción guardada y 300 XP pendientes';

  -- 3 · Empieza una temporada: los pendientes se cobran UNA vez con el app_season_apply real.
  select coalesce(sum(amount), 0) into xp0 from public.season_xp_ledger where user_id = u;
  r := public.app_team_collections_settle(u, team, '[]'::jsonb, 'qa-rehearsal-season', 300);
  if (r->>'xpGained')::int <> 300 or r->'teams'->0->>'code' <> 'XP_GRANTED' then raise exception 'FALLO 3: %', r; end if;
  for n in 1..3 loop r := public.app_team_collections_settle(u, team, '[]'::jsonb, 'qa-rehearsal-season', 300); end loop;
  if (r->>'xpGained')::int <> 0 then raise exception 'FALLO 3: reintento dio %', r->>'xpGained'; end if;
  if (select coalesce(sum(amount), 0) from public.season_xp_ledger where user_id = u) - xp0 <> 300 then raise exception 'FALLO 3: libro distinto de +300'; end if;
  if (select xp from public.season_progress where user_id = u and season_id = 'qa-rehearsal-season') <> 300 then raise exception 'FALLO 3: progreso'; end if;
  raise notice 'OK 3 · temporada activa: +300 XP una vez (libro y progreso reales); 3 reintentos, 0';

  -- 4 · Una clave duplicada en la base es imposible.
  begin
    insert into public.user_team_completions (user_id, team_id, cards) values (u, team -> 0 ->> 'id', 1);
    raise exception 'FALLO 4: se pudo duplicar la compleción';
  exception when unique_violation then null; end;
  raise notice 'OK 4 · la PK impide una segunda compleción del mismo equipo';

  -- 5 · Se desguazan las cartas: no se retira nada; volver a completar no paga otra vez.
  delete from public.user_cards where user_id = u and card_id = any (cards);
  r := public.app_team_collections_settle(u, team, '[]'::jsonb, 'qa-rehearsal-season', 300);
  if r->'teams'->0->>'code' <> 'ALREADY' or (select count(*) from public.user_team_completions where user_id = u) <> 1 then raise exception 'FALLO 5: %', r; end if;
  insert into public.user_cards (uid, user_id, card_id, origin, locked, obtained_at) select gen_random_uuid(), u, c, 'pack', false, now() from unnest(cards) c;
  r := public.app_team_collections_settle(u, team, '[]'::jsonb, 'qa-rehearsal-season', 300);
  if (r->>'xpGained')::int <> 0 then raise exception 'FALLO 5: volver a completar pagó %', r->>'xpGained'; end if;
  raise notice 'OK 5 · desguazar no retira; volver a completar no paga';

  -- 6 · Insignia regional (China) con user_cosmetics real: una vez, permanente.
  insert into public.user_cards (uid, user_id, card_id, origin, locked, obtained_at)
  select gen_random_uuid(), u, c, 'pack', false, now() from jsonb_array_elements_text(region -> 0 -> 'cards') c
   where not exists (select 1 from public.user_cards k where k.user_id = u and k.card_id = c);
  r := public.app_team_collections_settle(u, '[]'::jsonb, region, 'qa-rehearsal-season', 300);
  if r->'regions'->0->>'code' <> 'UNLOCKED' then raise exception 'FALLO 6: %', r; end if;
  r := public.app_team_collections_settle(u, '[]'::jsonb, region, 'qa-rehearsal-season', 300);
  if r->'regions'->0->>'code' <> 'ALREADY' then raise exception 'FALLO 6: repetición %', r; end if;
  if (select count(*) from public.user_cosmetics where user_id = u and cosmetic_id = 'insignia:regional:china') <> 1 then raise exception 'FALLO 6: cosmético'; end if;
  delete from public.user_cards where user_id = u and card_id in (select jsonb_array_elements_text(region -> 0 -> 'cards'));
  if (select count(*) from public.user_region_badges where user_id = u) <> 1 then raise exception 'FALLO 6: se perdió la insignia'; end if;
  raise notice 'OK 6 · insignia de China: una vez, con su cosmético, y sigue tras desguazar';

  -- 7 · Aislamiento: la otra cuenta real no ha recibido nada.
  if oth is not null and ((select count(*) from public.user_team_completions where user_id = oth) + (select count(*) from public.user_region_badges where user_id = oth)) <> 0 then raise exception 'FALLO 7'; end if;
  raise notice 'OK 7 · la otra cuenta no tiene nada';

  -- 8 · 0076 con el admin real y app_admin_audit real; una cuenta no admin no puede.
  if adm is null then raise exception 'FALLO 8: no hay admin en la copia'; end if;
  r := public.app_team_identity_save(adm, 'QA Ensayo', 'qa-ensayo', 'QA Ensayo', 'QAE', 'EMEA', 0);
  if r->>'code' <> 'OK' then raise exception 'FALLO 8: %', r; end if;
  if (select count(*) from public.content_audit_log where action = 'team_identity_create' and entity_id = 'qa-ensayo' and actor = adm) <> 1 then raise exception 'FALLO 8: auditoría'; end if;
  if exists (select 1 from public.profiles where id = u and not is_admin) then
    r := public.app_team_identity_save(u, 'QA Otro', 'qa-otro', 'QA Otro', 'QAO', 'EMEA', 0);
    if r->>'code' <> 'NOT_ADMIN' then raise exception 'FALLO 8: no admin %', r; end if;
  end if;
  r := public.app_team_identity_save(adm, 'QA Ensayo', 'qa-cambiada', 'QA Ensayo', 'QAE', 'EMEA', 1);
  if r->>'code' <> 'TEAM_ID_LOCKED' then raise exception 'FALLO 8: clave %', r; end if;
  raise notice 'OK 8 · 0076: alta auditada con el admin real, no admin rechazado, clave inmutable';
end $$;
\echo FUNCTIONAL_OK
rollback;
