
-- ══ F60 · COMPROBACIONES DEL ESTADO 0057 (valores BEFORE del precheck) ══
select 'chk_agents|' || count(*) || '|published=' || count(*) filter (where lifecycle = 'PUBLISHED') || '|complete=' || count(*) filter (where code is not null and jsonb_array_length(abilities) = 4) from public.agents;
select 'chk_agents_identity_digest|' || md5(string_agg(id || ':' || name || ':' || role || ':' || coalesce(icon, '∅'), ',' order by id)) from public.agents;
select 'chk_cards_digest|' || md5(string_agg(card_id || ':' || lifecycle || ':' || definition_version || ':' || ovr, ',' order by card_id)) || '|presentation_nonnull=' || count(*) filter (where presentation is not null) from public.content_cards;
select 'chk_players|' || count(*) || '|' || md5(string_agg(id || ':' || nick || ':' || team || ':' || status, ',' order by id)) from public.content_players;
select 'chk_content_packs|' || count(*) from public.content_packs;
select 'chk_entity_versions|' || string_agg(entity || '=' || version, ',' order by entity) from public.content_entity_version;
select 'chk_probe|' || (select string_agg(key || '=' || value, ',' order by key) from jsonb_each_text(public.app_admin_schema_probe()));
select 'chk_policy|' || string_agg(policyname || '=' || coalesce(qual, ''), ',') from pg_policies where schemaname = 'public' and tablename = 'agents';
select 'chk_objects|' || (select count(*) from information_schema.tables where table_schema = 'public') || '|' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public');
do $chk$
declare v_n int; v_pub int; v_complete int; v_dig text; v_cards text; v_pres int; v_probe_false int;
begin
  select count(*), count(*) filter (where lifecycle = 'PUBLISHED'), count(*) filter (where code is not null and jsonb_array_length(abilities) = 4)
    into v_n, v_pub, v_complete from public.agents;
  if v_n <> 29 or v_pub <> 29 or v_complete <> 29 then raise exception 'FALLO agentes n=% pub=% completos=%', v_n, v_pub, v_complete; end if;
  select md5(string_agg(id || ':' || name || ':' || role || ':' || coalesce(icon, '∅'), ',' order by id)) into v_dig from public.agents;
  if v_dig <> '30e7c54247e3802e9d46ed1120359683' then raise exception 'FALLO identidad de agentes cambió %', v_dig; end if;
  select md5(string_agg(card_id || ':' || lifecycle || ':' || definition_version || ':' || ovr, ',' order by card_id)), count(*) filter (where presentation is not null)
    into v_cards, v_pres from public.content_cards;
  if v_cards <> '99f51d86a088f2426b6d5bd90b617356' or v_pres <> 0 then raise exception 'FALLO cartas cambiaron %/%', v_cards, v_pres; end if;
  if (select md5(string_agg(id || ':' || nick || ':' || team || ':' || status, ',' order by id)) from public.content_players) <> '6839a1797b3f7c600d78597796e73d75' then
    raise exception 'FALLO jugadores cambiaron';
  end if;
  if (select count(*) from public.content_packs) <> 0 then raise exception 'FALLO content_packs no vacía'; end if;
  select count(*) into v_probe_false from jsonb_each_text(public.app_admin_schema_probe()) where value <> 'true';
  if v_probe_false <> 0 then raise exception 'FALLO sonda % claves en false', v_probe_false; end if;
  if (select count(*) from public.content_cards) <> 331 then raise exception 'FALLO 331'; end if;
  raise notice 'CHECKS_OK';
end
$chk$;
