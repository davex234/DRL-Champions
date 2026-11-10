-- 0058 v2 · PREFLIGHT (solo lectura). Todo debe salir «ok». Ejecutar con psql -At -v ON_ERROR_STOP=1.
begin read only;
select 'firma recompute_standings(text)',            case when to_regprocedure('public.recompute_standings(text)') is not null then 'ok' else 'FALLA' end;
select 'firma recompute_team_stats(text,text)',      case when to_regprocedure('public.recompute_team_stats(text,text)') is not null then 'ok' else 'FALLA' end;
select 'firma recompute_player_event_stats(text)',   case when to_regprocedure('public.recompute_player_event_stats(text)') is not null then 'ok' else 'FALLA' end;
select 'firma expire_offers()',                      case when to_regprocedure('public.expire_offers()') is not null then 'ok' else 'FALLA' end;
select 'firma _release_listing_offers(uuid,uuid)',   case when to_regprocedure('public._release_listing_offers(uuid,uuid)') is not null then 'ok' else 'FALLA' end;
select 'firma _check_wash(uuid,uuid)',               case when to_regprocedure('public._check_wash(uuid,uuid)') is not null then 'ok' else 'FALLA' end;
select 'firma _check_rate(text,integer)',            case when to_regprocedure('public._check_rate(text,integer)') is not null then 'ok' else 'FALLA' end;
select 'firma _check_price_band(text,bigint)',       case when to_regprocedure('public._check_price_band(text,bigint)') is not null then 'ok' else 'FALLA' end;
select 'firma _price_anchor(text)',                  case when to_regprocedure('public._price_anchor(text)') is not null then 'ok' else 'FALLA' end;
select 'firma _asset_refresh_best(text,text,text)',  case when to_regprocedure('public._asset_refresh_best(text,text,text)') is not null then 'ok' else 'FALLA' end;
select 'vistas actualizables = las conocidas',       case when (select string_agg(table_name, ',' order by table_name) from information_schema.views where table_schema = 'public' and (is_updatable = 'YES' or is_insertable_into = 'YES')) = 'card_photos,pickem_questions_public,v_content_cards_editadas' then 'ok' else 'REVISAR' end;
select 'política «crea tu perfil» presente',         case when exists (select 1 from pg_policy where polrelid = 'public.profiles'::regclass and polname = 'crea tu perfil') then 'ok' else 'ya retirada' end;
select 'trigger handle_new_user en auth.users',      case when exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'auth.users'::regclass and p.proname = 'handle_new_user') then 'ok' else 'FALLA' end;
select 'guardián de columnas de profiles',           case when exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_guard') then 'ok' else 'FALLA' end;
select 'service_role con BYPASSRLS',                 case when (select rolbypassrls from pg_roles where rolname = 'service_role') then 'ok' else 'FALLA' end;
rollback;
