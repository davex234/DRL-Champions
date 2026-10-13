
-- ── comprobaciones del estado 0056 (valores BEFORE fijados del precheck) ──
select 'chk_total|' || count(*) from public.agents;
select 'chk_miks|' || count(*) || '|' || coalesce(max(name), '') || '|' || coalesce(max(role), '') from public.agents where id = 'miks';
select 'chk_veto|' || count(*) || '|' || coalesce(max(id), '') || '|' || coalesce(max(name), '') || '|' || coalesce(max(role), '') || '|icon_null=' || bool_and(icon is null) from public.agents where id = 'veto';
select 'chk_others_digest|' || md5(string_agg(row_to_json(a)::text, ',' order by id)) from public.agents a where id not in ('veto', 'miks');
select 'chk_veto_refs|' || ((select count(*) from public.map_player_stats where agent_id = 'veto') + (select count(*) from public.player_stats where agent_id = 'veto')) || '|' || md5(coalesce((select string_agg(md5(row_to_json(m)::text), ',' order by md5(row_to_json(m)::text)) from public.map_player_stats m where agent_id = 'veto'), '') || '#' || coalesce((select string_agg(md5(row_to_json(p)::text), ',' order by md5(row_to_json(p)::text)) from public.player_stats p where agent_id = 'veto'), ''));
select 'chk_objects|' || (select count(*) from information_schema.tables where table_schema = 'public') || '|' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public');
select 'chk_cards|' || count(*) from public.content_cards;
do $chk$
declare
  v_total int; v_miks int; v_miks_role text; v_veto int; v_veto_role text; v_veto_name text; v_veto_icon_null boolean;
  v_others text; v_refs int; v_refs_digest text; v_tables int; v_funcs int; v_cards int;
begin
  select count(*) into v_total from public.agents;
  select count(*), max(role) into v_miks, v_miks_role from public.agents where id = 'miks';
  select count(*), max(role), max(name), bool_and(icon is null) into v_veto, v_veto_role, v_veto_name, v_veto_icon_null from public.agents where id = 'veto';
  select md5(string_agg(row_to_json(a)::text, ',' order by id)) into v_others from public.agents a where id not in ('veto', 'miks');
  v_refs := (select count(*) from public.map_player_stats where agent_id = 'veto') + (select count(*) from public.player_stats where agent_id = 'veto');
  v_refs_digest := md5(coalesce((select string_agg(md5(row_to_json(m)::text), ',' order by md5(row_to_json(m)::text)) from public.map_player_stats m where agent_id = 'veto'), '') || '#' || coalesce((select string_agg(md5(row_to_json(p)::text), ',' order by md5(row_to_json(p)::text)) from public.player_stats p where agent_id = 'veto'), ''));
  select count(*) into v_tables from information_schema.tables where table_schema = 'public';
  select count(*) into v_funcs from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
  select count(*) into v_cards from public.content_cards;
  if v_total <> 29 then raise exception 'FALLO total=%', v_total; end if;
  if v_miks <> 1 or v_miks_role <> 'controller' then raise exception 'FALLO miks=% role=%', v_miks, v_miks_role; end if;
  if v_veto <> 1 or v_veto_role <> 'sentinel' or v_veto_name <> 'Veto' or not v_veto_icon_null then raise exception 'FALLO veto=% role=% name=%', v_veto, v_veto_role, v_veto_name; end if;
  if v_others <> '8ad25e3c077174a4d62531529670debc' then raise exception 'FALLO otros 27 cambiaron: %', v_others; end if;
  if v_refs <> 6 or v_refs_digest <> '247f20d26be82515b38faebdca4623e1' then raise exception 'FALLO refs veto=% digest=%', v_refs, v_refs_digest; end if;
  if v_tables <> 120 or v_funcs <> 127 then raise exception 'FALLO objetos tablas=% funciones=%', v_tables, v_funcs; end if;
  if v_cards <> 331 then raise exception 'FALLO cartas=%', v_cards; end if;
  raise notice 'CHECKS_OK';
end
$chk$;
