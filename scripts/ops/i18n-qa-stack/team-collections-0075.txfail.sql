-- =============================================================================================================
-- 0075 · ERROR A MITAD DE LA LIQUIDACIÓN (stack de QA, Postgres real). Todo en UNA transacción que termina en ROLLBACK.
--
-- Un disparador temporal hace fallar el asiento del libro de XP DESPUÉS de que la función ya insertó la compleción y
-- el evento de temporada. Se comprueba que no queda NADA (ni compleción, ni evento, ni asiento, ni progreso): la
-- llamada es atómica. Después, sin el disparador, el reintento concede 300 XP una sola vez, y otro reintento, 0.
--
-- Variables (psql): :china (uuid de coll-tcchina), :plan_china_team, :season_levels, :season_config (de tc-0075-vars.sql).
-- =============================================================================================================
\set QUIET on
begin;
select set_config('qa.user', :'china', true), set_config('qa.plan', :'plan_china_team', true);
set local session_replication_role = replica;
insert into public.game_seasons (id, number, name, description, status, starts_at, ends_at, claim_until, max_level, config, checksum, published_at)
values ('qa-tc-txfail', 901, 'QA fallo a mitad', 'Solo stack de QA', 'PUBLISHED', now() - interval '1 day', now() + interval '30 days', now() + interval '40 days', :season_levels, :'season_config'::jsonb, 'qa', now());
delete from public.user_team_completions where user_id = current_setting('qa.user')::uuid;
set local session_replication_role = origin;

create function pg_temp.qa_boom() returns trigger language plpgsql as $$ begin raise exception 'FALLO_SIMULADO_QA'; end $$;
create trigger qa_boom before insert on public.season_xp_ledger for each row execute function pg_temp.qa_boom();

do $$
declare u uuid := current_setting('qa.user')::uuid; plan jsonb := current_setting('qa.plan')::jsonb; failed boolean := false; r jsonb;
begin
  if u is null then raise exception 'falta coll-tcchina'; end if;
  begin
    r := public.app_team_collections_settle(u, plan, '[]'::jsonb, 'qa-tc-txfail', 300);
  exception when others then
    if sqlerrm like '%FALLO_SIMULADO_QA%' then failed := true; else raise; end if;
  end;
  if not failed then raise exception 'FALLO: la liquidación no llegó al punto de fallo (%)', r; end if;
  if exists (select 1 from public.user_team_completions where user_id = u) then raise exception 'FALLO: quedó una compleción a medias'; end if;
  if exists (select 1 from public.season_events where user_id = u and season_id = 'qa-tc-txfail') then raise exception 'FALLO: quedó el evento de temporada'; end if;
  if exists (select 1 from public.season_xp_ledger where user_id = u and season_id = 'qa-tc-txfail') then raise exception 'FALLO: quedó un asiento de XP'; end if;
  if exists (select 1 from public.season_progress where user_id = u and season_id = 'qa-tc-txfail' and xp > 0) then raise exception 'FALLO: quedó progreso'; end if;
  raise notice 'OK · fallo a mitad: ni compleción, ni evento, ni asiento, ni progreso';
end $$;

drop trigger qa_boom on public.season_xp_ledger;

do $$
declare u uuid := current_setting('qa.user')::uuid; plan jsonb := current_setting('qa.plan')::jsonb; r jsonb;
begin
  r := public.app_team_collections_settle(u, plan, '[]'::jsonb, 'qa-tc-txfail', 300);
  if (r->>'xpGained')::int <> 300 then raise exception 'FALLO: el reintento dio % XP', r->>'xpGained'; end if;
  r := public.app_team_collections_settle(u, plan, '[]'::jsonb, 'qa-tc-txfail', 300);
  if (r->>'xpGained')::int <> 0 then raise exception 'FALLO: el segundo reintento dio % XP', r->>'xpGained'; end if;
  if (select coalesce(sum(amount), 0) from public.season_xp_ledger where user_id = u and season_id = 'qa-tc-txfail') <> 300 then raise exception 'FALLO: libro distinto de 300'; end if;
  raise notice 'OK · reintento sin fallo: 300 XP una vez; el siguiente, 0';
end $$;
\echo TXFAIL_0075_OK
rollback;
