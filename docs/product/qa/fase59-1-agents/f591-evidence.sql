-- F59.1 · EVIDENCIA BEFORE DE VETO — SOLO LECTURA.
select 'veto_row|' || row_to_json(a)::text from public.agents a where id = 'veto';
select 'veto_icon_is_null|' || (icon is null) from public.agents where id = 'veto';
select 'icons_non_null_total|' || count(*) from public.agents where icon is not null;
select 'agents_total|' || count(*) from public.agents;
select 'digest_all|' || md5(string_agg(row_to_json(a)::text, ',' order by id)) from public.agents a;
select 'digest_others_excl_veto_miks|' || md5(string_agg(row_to_json(a)::text, ',' order by id)) from public.agents a where id not in ('veto', 'miks');
select 'count_others_excl_veto_miks|' || count(*) from public.agents where id not in ('veto', 'miks');
select 'mps_veto_row|' || md5(row_to_json(m)::text) || '|' || row_to_json(m)::text from public.map_player_stats m where agent_id = 'veto' order by row_to_json(m)::text;
select 'ps_veto_row|' || md5(row_to_json(p)::text) || '|' || row_to_json(p)::text from public.player_stats p where agent_id = 'veto' order by row_to_json(p)::text;
select 'veto_refs_digest|' || md5(coalesce((select string_agg(md5(row_to_json(m)::text), ',' order by md5(row_to_json(m)::text)) from public.map_player_stats m where agent_id = 'veto'), '') || '#' || coalesce((select string_agg(md5(row_to_json(p)::text), ',' order by md5(row_to_json(p)::text)) from public.player_stats p where agent_id = 'veto'), ''));
select 'veto_refs_count|' || (select count(*) from public.map_player_stats where agent_id = 'veto') + (select count(*) from public.player_stats where agent_id = 'veto');
select 'fk_to_agents|' || string_agg(conrelid::regclass::text || '.' || conname, ',' order by conrelid::regclass::text) from pg_constraint where confrelid = 'public.agents'::regclass and contype = 'f';
select 'public_tables|' || count(*) from information_schema.tables where table_schema = 'public';
select 'public_functions|' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
select 'content_cards|' || count(*) from public.content_cards;
