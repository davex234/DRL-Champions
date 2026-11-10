
-- ══ F60 · SMOKE DENTRO DE LA TRANSACCIÓN (todo se deshace con el ROLLBACK final) ══
-- Admin SINTÉTICO creado y destruido en esta misma transacción: no se usa ninguna cuenta real.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('f6000000-0000-4000-8000-00000000f060', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'f60-smoke@example.invalid', '', now(), now());
update public.profiles set is_admin = true where id = 'f6000000-0000-4000-8000-00000000f060';
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('f6000000-0000-4000-8000-00000000f061', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'f60-smoke-user@example.invalid', '', now(), now());

do $smoke$
declare
  a uuid := 'f6000000-0000-4000-8000-00000000f060';
  u uuid := 'f6000000-0000-4000-8000-00000000f061';
  r jsonb; ok boolean;
  ab jsonb := '[{"slot":"C","name":"Uno QA"},{"slot":"Q","name":"Dos QA"},{"slot":"E","name":"Tres QA"},{"slot":"X","name":"Cuatro QA"}]';
begin
  -- Agente: alta en borrador
  r := public.app_admin_agent_save(a, 'qaf60smoke', jsonb_build_object('name', 'QA Smoke', 'role', 'initiator', 'code', 'QAS', 'abilities', ab), null, 'smoke');
  if r->>'lifecycle' <> 'DRAFT' or (r->>'version')::int <> 1 then raise exception 'SMOKE agent create %', r; end if;
  -- No admin ⇒ NOT_ADMIN
  ok := false; begin perform public.app_admin_agent_save(u, 'qaf60smoke2', '{"name":"X","role":"duelist"}', null, 's'); exception when others then ok := sqlerrm like '%NOT_ADMIN%'; end;
  if not ok then raise exception 'SMOKE not admin'; end if;
  -- Campo no permitido ⇒ BAD_FIELD
  ok := false; begin perform public.app_admin_agent_save(a, 'qaf60smoke', '{"lifecycle":"PUBLISHED"}', 1, 's'); exception when others then ok := sqlerrm like '%BAD_FIELD%'; end;
  if not ok then raise exception 'SMOKE bad field'; end if;
  -- Edición con versión buena y luego con versión vieja ⇒ STALE_CONTENT
  r := public.app_admin_agent_save(a, 'qaf60smoke', '{"name":"QA Smoke 2"}', 1, 'smoke edit');
  if (r->>'version')::int <> 2 then raise exception 'SMOKE agent edit %', r; end if;
  ok := false; begin perform public.app_admin_agent_save(a, 'qaf60smoke', '{"name":"pisada"}', 1, 's'); exception when others then ok := sqlerrm like '%STALE_CONTENT%'; end;
  if not ok then raise exception 'SMOKE stale'; end if;
  -- Publicar sin arte ⇒ CONTENT_INCOMPLETE
  ok := false; begin perform public.app_admin_agent_lifecycle(a, 'qaf60smoke', 'PUBLISHED', 2, 'smoke publish'); exception when others then ok := sqlerrm like '%CONTENT_INCOMPLETE%'; end;
  if not ok then raise exception 'SMOKE publish gate'; end if;
  -- Retirar un borrador ⇒ BAD_TRANSITION
  ok := false; begin perform public.app_admin_agent_lifecycle(a, 'qaf60smoke', 'RETIRED', 2, 'smoke retire'); exception when others then ok := sqlerrm like '%BAD_TRANSITION%'; end;
  if not ok then raise exception 'SMOKE transition'; end if;
  -- Borrar un agente CON referencias (veto: 6 stats) ⇒ nunca: no es borrador
  ok := false; begin perform public.app_admin_agent_delete_draft(a, 'veto', (select version from public.agents where id = 'veto'), 'smoke del'); exception when others then ok := sqlerrm like '%NOT_A_DRAFT%'; end;
  if not ok then raise exception 'SMOKE delete published'; end if;
  r := public.app_admin_agent_references('veto');
  if (r->>'mapPlayerStats')::int <> 4 or (r->>'playerStats')::int <> 2 then raise exception 'SMOKE veto refs %', r; end if;
  -- Borrar el borrador sin referencias ⇒ ok
  r := public.app_admin_agent_delete_draft(a, 'qaf60smoke', 2, 'smoke cleanup');
  if exists (select 1 from public.agents where id = 'qaf60smoke') then raise exception 'SMOKE delete draft'; end if;

  -- Sobre CMS: borrador desde plantilla, publicar sin arte/pool/simulación ⇒ CONTENT_INCOMPLETE, borrar ⇒ sin residuos
  r := public.app_admin_pack_save(a, 'cms-qa-smoke', '{"name":"QA Smoke Pack","template_pack_id":"estandar","price":1000,"card_count":5}', null, 'smoke');
  if r->>'lifecycle' <> 'DRAFT' then raise exception 'SMOKE pack create %', r; end if;
  ok := false; begin perform public.app_admin_pack_lifecycle(a, 'cms-qa-smoke', 'ACTIVE', 1, 'smoke'); exception when others then ok := sqlerrm like '%CONTENT_INCOMPLETE%'; end;
  if not ok then raise exception 'SMOKE pack gate'; end if;
  ok := false; begin perform public.app_admin_pack_save(a, 'cms-bad id', '{"name":"XXX","template_pack_id":"estandar","price":1,"card_count":1}', null, 's'); exception when others then ok := true; end;
  if not ok then raise exception 'SMOKE pack id format'; end if;
  r := public.app_admin_pack_references('estandar');
  if (r->>'poolBindings')::int < 1 then raise exception 'SMOKE estandar refs %', r; end if;
  r := public.app_admin_pack_delete_draft(a, 'cms-qa-smoke', 1, 'smoke cleanup');
  if exists (select 1 from public.content_packs) then raise exception 'SMOKE pack residue'; end if;

  -- Carta: la presentación sólo se escribe en borrador (una publicada del catálogo ⇒ NOT_A_DRAFT)
  ok := false; begin perform public.app_admin_card_set_presentation(a, (select card_id from public.content_cards order by ordinal limit 1),
    '{"role":"Duelista","printed":{"ovr":80,"stats":{"dmg":80,"scr":80,"fks":80,"hs":80,"ast":80,"clu":80}},"team":"QA"}', 0, 's');
    exception when others then ok := sqlerrm like '%NOT_A_DRAFT%'; end;
  if not ok then raise exception 'SMOKE card presentation published'; end if;
  r := public.app_admin_card_references((select card_id from public.content_cards order by ordinal limit 1));
  if r ? 'copies' is false then raise exception 'SMOKE card refs %', r; end if;

  -- Jugador: alta y edición con versión vieja ⇒ STALE_CONTENT
  r := public.app_admin_player_save(a, 'qaf60player', '{"nick":"QAF60","region":"EMEA","role":"Flex","stats":{"dmg":50,"scr":50,"com":50,"hs":50,"ast":50,"clu":50}}', null, 'smoke');
  ok := false; begin perform public.app_admin_player_save(a, 'qaf60player', '{"nick":"pisada"}', 7, 's'); exception when others then ok := sqlerrm like '%STALE_CONTENT%'; end;
  if not ok then raise exception 'SMOKE player stale'; end if;

  -- Carta del panel: alta ATÓMICA (definición + presentación con arte) y borrado del borrador sin residuos
  insert into public.assets (id, kind, name, subject_type, status, bucket, storage_path)
  values ('f6000000-0000-4000-8000-0000000a55e7', 'card_artwork', 'smoke.png', 'card', 'approved', 'assets', 'cms/card_artwork/smoke/original.png');
  r := public.app_admin_card_create_draft(a,
    jsonb_build_object('player_id', 'qaf60player', 'variant_id', 'moments', 'ovr', 88, 'stats', '{"dmg":50,"scr":50,"com":50,"hs":50,"ast":50,"clu":50}'::jsonb,
      'combat', '{"stronghold":50,"gamesense":50,"entryfrag":50}'::jsonb, 'stat_boost', 0, 'rarity_rank', 1, 'rarity_bucket', 'common',
      'data_version', 'smoke', 'source', 'editorial', 'generated_at', now()::text, 'checksum', 'smoke'),
    '{"role":"Flex","printed":{"ovr":88,"stats":{"dmg":80,"scr":80,"fks":80,"hs":80,"ast":80,"clu":80}},"team":"QA","imageAssetId":"f6000000-0000-4000-8000-0000000a55e7","imagePath":"cms/card_artwork/smoke/original.png"}',
    'smoke alta');
  if r->>'cardId' <> 'qaf60player__moments' or (select lifecycle from public.content_cards where card_id = 'qaf60player__moments') <> 'DRAFT' then raise exception 'SMOKE card create %', r; end if;
  -- imagePath que no es la del asset ⇒ BAD_ASSET
  ok := false; begin perform public.app_admin_card_set_presentation(a, 'qaf60player__moments',
    '{"role":"Flex","printed":{"ovr":88,"stats":{"dmg":80,"scr":80,"fks":80,"hs":80,"ast":80,"clu":80}},"team":"QA","imageAssetId":"f6000000-0000-4000-8000-0000000a55e7","imagePath":"../../otra"}', 1, 's');
    exception when others then ok := sqlerrm like '%BAD_ASSET%'; end;
  if not ok then raise exception 'SMOKE imagePath'; end if;
  -- Trigger: una carta del panel sin presentación no se publica
  perform public.app_content_create_card(jsonb_build_object('player_id', 'qaf60player', 'variant_id', 'record-breaker', 'ovr', 80, 'stats', '{"dmg":50,"scr":50,"com":50,"hs":50,"ast":50,"clu":50}'::jsonb, 'combat', '{"stronghold":50,"gamesense":50,"entryfrag":50}'::jsonb,
    'stat_boost', 0, 'rarity_rank', 1, 'rarity_bucket', 'common', 'data_version', 'smoke', 'source', 'editorial', 'generated_at', now()::text, 'checksum', 'smoke'), 'smoke', a);
  ok := false; begin perform public.app_content_set_lifecycle('qaf60player__record-breaker', 'PUBLISHED', 'smoke', a); exception when others then ok := sqlerrm like '%CONTENT_INCOMPLETE%'; end;
  if not ok then raise exception 'SMOKE publish guard'; end if;
  r := public.app_admin_card_delete_draft(a, 'qaf60player__moments', 1, 'smoke cleanup');
  if exists (select 1 from public.content_cards where card_id = 'qaf60player__moments') or exists (select 1 from public.content_card_versions where card_id = 'qaf60player__moments') then
    raise exception 'SMOKE card residue';
  end if;

  -- Evento v2: descripción e imagen llegan a public.events
  insert into public.admin_event_drafts (id, name, description, type, region, starts_at, ends_at, created_by)
  values ('f6000000-0000-4000-8000-0000000e0e17', 'Smoke Evento', 'Descripción smoke', 'regional', 'EMEA', now() + interval '1 day', now() + interval '3 days', a);
  r := public.app_admin_publish_event_v2('f6000000-0000-4000-8000-0000000e0e17', a, null, 'http://img.local/x.png');
  if not exists (select 1 from public.events where id = r->>'event_id' and description = 'Descripción smoke' and logo = 'http://img.local/x.png') then raise exception 'SMOKE event v2 %', r; end if;

  -- La auditoría sigue siendo de sólo inserción
  ok := false; begin update public.content_audit_log set action = action where id = (select max(id) from public.content_audit_log); exception when others then ok := true; end;
  if not ok then raise exception 'SMOKE audit append-only'; end if;
  raise notice 'SMOKE_OK';
end
$smoke$;
select 'smoke_audit_rows|' || count(*) from public.content_audit_log where actor = 'f6000000-0000-4000-8000-00000000f060';

-- Un BORRADOR no es visible para la lectura anónima (política nueva)
select public.app_admin_agent_save('f6000000-0000-4000-8000-00000000f060', 'qaf60anon', '{"name":"QA Anon","role":"duelist"}', null, 'smoke anon') is not null as created;
set local role anon;
select 'anon_sees_draft|' || count(*) from public.agents where id = 'qaf60anon';
select 'anon_sees_published|' || count(*) from public.agents;
reset role;
