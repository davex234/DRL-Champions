-- F59.1 · ORIGEN DE LA FILA veto — SOLO LECTURA.
select 'veto_xmin|' || xmin::text from public.agents where id = 'veto';
select 'jett_xmin|' || xmin::text from public.agents where id = 'jett';
select 'waylay_xmin|' || xmin::text from public.agents where id = 'waylay';
select 'mps_veto|' || count(*) from public.map_player_stats where agent_id = 'veto';
select 'ps_veto|' || count(*) from public.player_stats where agent_id = 'veto';
select 'players_agents_veto|' || count(*) from public.players where agents::text ilike '%veto%';
select 'players_agents_miks|' || count(*) from public.players where agents::text ilike '%miks%';
select 'mps_null_agent|' || count(*) from public.map_player_stats where agent_id is null;
select 'ps_null_agent|' || count(*) from public.player_stats where agent_id is null;
select 'audit_agents|' || count(*) from public.content_audit_log where entity_type = 'agent' or action ilike '%agent%';
