BEGIN;
-- 0057 · F60 ADMIN CONTENT MANAGEMENT SYSTEM — esquema para gestionar CONTENIDO desde /admin sin tocar código.
--
-- Aditiva: sólo añade columnas, tablas, índices, restricciones y funciones. No borra ni reescribe datos existentes,
-- salvo UN relleno de contenido imprescindible para tener una sola fuente de verdad de agentes (§2: `code` y
-- `abilities` de los 29 agentes, copiados del roster verificado `src/domain/tactics/valorantRoster.ts`).
--
--   §0  Versión por entidad (latido para las cachés del runtime: publicar ⇒ el juego lo ve sin reiniciar).
--   §1  Assets: tipos nuevos (cara/cuerpo de agente, arte de sobre, de evento y de mapa).
--   §2  Agentes: la BD pasa a ser LA fuente (ciclo DRAFT/PUBLISHED/RETIRED, código, habilidades, arte, versión).
--   §3  Sobres CMS: `content_packs` — sobres nuevos que heredan la economía de un sobre existente (plantilla).
--   §4  Cartas: presentación impresa (rol de carta, OVR/6 stats impresas, equipo impreso, arte) para altas CMS.
--   §5  Jugadores: alta/edición con concurrencia y auditoría.
--   §6  Eventos: descripción e imagen llegan por fin a `public.events` al publicar.
--   §7  Sonda de esquema v2 (el estado REAL de 0056/0057, no la existencia del fichero).
--
-- Todas las RPC: security definer, sólo service_role, comprueban `profiles.is_admin` del actor, validan una lista
-- blanca de campos, usan concurrencia optimista y escriben en `content_audit_log` (append-only, 0055) en la MISMA
-- transacción que el cambio.
--
-- Deshacer (esquema): ver `docs/product/fase-60-admin-cms.md` §Rollback. Las columnas nuevas son anulables o con
-- valor por defecto: el código anterior sigue funcionando con ellas presentes.


-- ════════════════════════════════════════════════════════════════════════════
-- §0 · VERSIÓN POR ENTIDAD
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.content_entity_version (
  entity     text primary key check (entity in ('agents', 'packs', 'players')),
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.content_entity_version (entity) values ('agents'), ('packs'), ('players')
on conflict (entity) do nothing;
alter table public.content_entity_version enable row level security;
revoke all on public.content_entity_version from public, anon, authenticated;
grant select on public.content_entity_version to service_role;

create or replace function public._bump_entity(p_entity text)
returns bigint language sql security definer set search_path = public as $fn$
  update public.content_entity_version set version = version + 1, updated_at = now()
   where entity = p_entity returning version;
$fn$;

create or replace function public._require_admin(p_actor uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
end; $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §1 · ASSETS: TIPOS NUEVOS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.assets drop constraint if exists assets_subject_type_check;
alter table public.assets add constraint assets_subject_type_check
  check (subject_type = any (array[
    'player'::text, 'team'::text, 'league'::text, 'tournament'::text,
    'country'::text, 'role'::text, 'variant'::text, 'none'::text,
    'card'::text,
    'agent'::text, 'pack'::text, 'event'::text, 'map'::text
  ]));
alter table public.assets drop constraint if exists assets_kind_check;
alter table public.assets add constraint assets_kind_check
  check (kind = any (array[
    'player_photo'::text, 'team_logo'::text, 'league_logo'::text, 'tournament_logo'::text,
    'flag'::text, 'role'::text, 'card_template'::text, 'background'::text,
    'animation'::text, 'effect'::text,
    'card_artwork'::text,
    'agent_face'::text, 'agent_full'::text, 'pack_art'::text, 'event_art'::text, 'map_art'::text
  ]));
create index if not exists assets_checksum_kind_idx on public.assets (kind, checksum) where checksum is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- §2 · AGENTES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.agents add column if not exists code          text;
alter table public.agents add column if not exists abilities     jsonb not null default '[]'::jsonb;
alter table public.agents add column if not exists lifecycle     text not null default 'PUBLISHED';
alter table public.agents add column if not exists face_asset_id uuid references public.assets(id) on delete restrict;
alter table public.agents add column if not exists full_asset_id uuid references public.assets(id) on delete restrict;
alter table public.agents add column if not exists origin        text not null default 'seed';
alter table public.agents add column if not exists version       int  not null default 1;
alter table public.agents add column if not exists created_at    timestamptz not null default now();
alter table public.agents add column if not exists updated_at    timestamptz not null default now();
alter table public.agents add column if not exists created_by    uuid references auth.users(id) on delete set null;
alter table public.agents add column if not exists updated_by    uuid references auth.users(id) on delete set null;
alter table public.agents add column if not exists published_at  timestamptz;
alter table public.agents add column if not exists retired_at    timestamptz;

-- Relleno de contenido (única fuente de verdad): código y habilidades de los 29 del roster verificado.
-- Sólo donde falten: re-ejecutar no pisa nada editado después desde el panel.
update public.agents a
   set code = v.code, abilities = v.abilities
  from (values
  ('astra', 'AST', '[{"slot":"C","name":"Gravity Well"},{"slot":"Q","name":"Nova Pulse"},{"slot":"E","name":"Nebula / Dissipate"},{"slot":"X","name":"Astral Form / Cosmic Divide"}]'::jsonb),
  ('breach', 'BRE', '[{"slot":"C","name":"Aftershock"},{"slot":"Q","name":"Flashpoint"},{"slot":"E","name":"Fault Line"},{"slot":"X","name":"Rolling Thunder"}]'::jsonb),
  ('brimstone', 'BRI', '[{"slot":"C","name":"Stim Beacon"},{"slot":"Q","name":"Incendiary"},{"slot":"E","name":"Sky Smoke"},{"slot":"X","name":"Orbital Strike"}]'::jsonb),
  ('chamber', 'CHA', '[{"slot":"C","name":"Trademark"},{"slot":"Q","name":"Headhunter"},{"slot":"E","name":"Rendezvous"},{"slot":"X","name":"Tour De Force"}]'::jsonb),
  ('clove', 'CLO', '[{"slot":"C","name":"Pick-me-up"},{"slot":"Q","name":"Meddle"},{"slot":"E","name":"Ruse"},{"slot":"X","name":"Not Dead Yet"}]'::jsonb),
  ('cypher', 'CYP', '[{"slot":"C","name":"Trapwire"},{"slot":"Q","name":"Cyber Cage"},{"slot":"E","name":"Spycam"},{"slot":"X","name":"Neural Theft"}]'::jsonb),
  ('deadlock', 'DEA', '[{"slot":"C","name":"Barrier Mesh"},{"slot":"Q","name":"Sonic Sensor"},{"slot":"E","name":"GravNet"},{"slot":"X","name":"Annihilation"}]'::jsonb),
  ('fade', 'FAD', '[{"slot":"C","name":"Prowler"},{"slot":"Q","name":"Seize"},{"slot":"E","name":"Haunt"},{"slot":"X","name":"Nightfall"}]'::jsonb),
  ('gekko', 'GEK', '[{"slot":"C","name":"Mosh Pit"},{"slot":"Q","name":"Wingman"},{"slot":"E","name":"Dizzy"},{"slot":"X","name":"Thrash"}]'::jsonb),
  ('harbor', 'HAR', '[{"slot":"C","name":"Storm Surge"},{"slot":"Q","name":"High Tide"},{"slot":"E","name":"Cove"},{"slot":"X","name":"Reckoning"}]'::jsonb),
  ('iso', 'ISO', '[{"slot":"C","name":"Contingency"},{"slot":"Q","name":"Undercut"},{"slot":"E","name":"Double Tap"},{"slot":"X","name":"Kill Contract"}]'::jsonb),
  ('jett', 'JET', '[{"slot":"C","name":"Cloudburst"},{"slot":"Q","name":"Updraft"},{"slot":"E","name":"Tailwind"},{"slot":"X","name":"Blade Storm"}]'::jsonb),
  ('kayo', 'KAY', '[{"slot":"C","name":"FRAG/ment"},{"slot":"Q","name":"FLASH/drive"},{"slot":"E","name":"ZERO/point"},{"slot":"X","name":"NULL/cmd"}]'::jsonb),
  ('killjoy', 'KIL', '[{"slot":"C","name":"Nanoswarm"},{"slot":"Q","name":"ALARMBOT"},{"slot":"E","name":"TURRET"},{"slot":"X","name":"Lockdown"}]'::jsonb),
  ('miks', 'MIK', '[{"slot":"C","name":"M-pulse"},{"slot":"Q","name":"Harmonize"},{"slot":"E","name":"Waveform"},{"slot":"X","name":"Bassquake"}]'::jsonb),
  ('neon', 'NEO', '[{"slot":"C","name":"Fast Lane"},{"slot":"Q","name":"Relay Bolt"},{"slot":"E","name":"High Gear"},{"slot":"X","name":"Overdrive"}]'::jsonb),
  ('omen', 'OME', '[{"slot":"C","name":"Shrouded Step"},{"slot":"Q","name":"Paranoia"},{"slot":"E","name":"Dark Cover"},{"slot":"X","name":"From the Shadows"}]'::jsonb),
  ('phoenix', 'PHO', '[{"slot":"C","name":"Blaze"},{"slot":"Q","name":"Hot Hands"},{"slot":"E","name":"Curveball"},{"slot":"X","name":"Run it Back"}]'::jsonb),
  ('raze', 'RAZ', '[{"slot":"C","name":"Boom Bot"},{"slot":"Q","name":"Blast Pack"},{"slot":"E","name":"Paint Shells"},{"slot":"X","name":"Showstopper"}]'::jsonb),
  ('reyna', 'REY', '[{"slot":"C","name":"Leer"},{"slot":"Q","name":"Devour"},{"slot":"E","name":"Dismiss"},{"slot":"X","name":"Empress"}]'::jsonb),
  ('sage', 'SAG', '[{"slot":"C","name":"Barrier Orb"},{"slot":"Q","name":"Slow Orb"},{"slot":"E","name":"Healing Orb"},{"slot":"X","name":"Resurrection"}]'::jsonb),
  ('skye', 'SKY', '[{"slot":"C","name":"Regrowth"},{"slot":"Q","name":"Trailblazer"},{"slot":"E","name":"Guiding Light"},{"slot":"X","name":"Seekers"}]'::jsonb),
  ('sova', 'SOV', '[{"slot":"C","name":"Owl Drone"},{"slot":"Q","name":"Shock Bolt"},{"slot":"E","name":"Recon Bolt"},{"slot":"X","name":"Hunter''s Fury"}]'::jsonb),
  ('tejo', 'TEJ', '[{"slot":"C","name":"Stealth Drone"},{"slot":"Q","name":"Special Delivery"},{"slot":"E","name":"Guided Salvo"},{"slot":"X","name":"Armageddon"}]'::jsonb),
  ('veto', 'VET', '[{"slot":"C","name":"Crosscut"},{"slot":"Q","name":"Chokehold"},{"slot":"E","name":"Interceptor"},{"slot":"X","name":"Evolution"}]'::jsonb),
  ('viper', 'VIP', '[{"slot":"C","name":"Snake Bite"},{"slot":"Q","name":"Poison Cloud"},{"slot":"E","name":"Toxic Screen"},{"slot":"X","name":"Viper''s Pit"}]'::jsonb),
  ('vyse', 'VYS', '[{"slot":"C","name":"Razorvine"},{"slot":"Q","name":"Shear"},{"slot":"E","name":"Arc Rose"},{"slot":"X","name":"Steel Garden"}]'::jsonb),
  ('waylay', 'WAY', '[{"slot":"C","name":"Saturate"},{"slot":"Q","name":"Lightspeed"},{"slot":"E","name":"Refract"},{"slot":"X","name":"Convergent Paths"}]'::jsonb),
  ('yoru', 'YOR', '[{"slot":"C","name":"FAKEOUT"},{"slot":"Q","name":"BLINDSIDE"},{"slot":"E","name":"GATECRASH"},{"slot":"X","name":"DIMENSIONAL DRIFT"}]'::jsonb)
  ) as v(id, code, abilities)
 where a.id = v.id and a.code is null;

alter table public.agents drop constraint if exists agents_lifecycle_check;
alter table public.agents add constraint agents_lifecycle_check check (lifecycle in ('DRAFT', 'PUBLISHED', 'RETIRED'));
alter table public.agents drop constraint if exists agents_origin_check;
alter table public.agents add constraint agents_origin_check check (origin in ('seed', 'admin'));
alter table public.agents drop constraint if exists agents_id_format_check;
alter table public.agents add constraint agents_id_format_check check (id ~ '^[a-z0-9]{2,24}$');
alter table public.agents drop constraint if exists agents_name_check;
alter table public.agents add constraint agents_name_check check (char_length(btrim(name)) between 2 and 24);
alter table public.agents drop constraint if exists agents_code_check;
alter table public.agents add constraint agents_code_check check (code is null or code ~ '^[A-Z0-9/]{2,4}$');
alter table public.agents drop constraint if exists agents_abilities_check;
alter table public.agents add constraint agents_abilities_check check (jsonb_typeof(abilities) = 'array' and jsonb_array_length(abilities) <= 4);
-- Lo que se juega tiene que estar completo: código y las cuatro habilidades (C/Q/E/X).
alter table public.agents drop constraint if exists agents_published_complete_check;
alter table public.agents add constraint agents_published_complete_check
  check (lifecycle = 'DRAFT' or (code is not null and jsonb_array_length(abilities) = 4));

-- Un borrador no es público: la lectura anónima (0003) deja de ver DRAFT. El worker usa service_role.
drop policy if exists "lectura publica agents" on public.agents;
create policy "lectura publica agents" on public.agents for select using (lifecycle <> 'DRAFT');

create or replace function public._agent_json(a public.agents)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object('id', a.id, 'name', a.name, 'role', a.role, 'code', a.code, 'abilities', a.abilities,
    'lifecycle', a.lifecycle, 'faceAssetId', a.face_asset_id, 'fullAssetId', a.full_asset_id, 'version', a.version);
$fn$;

create or replace function public._validate_agent_asset(p_asset uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_asset is null then return; end if;
  if not exists (select 1 from public.assets where id = p_asset and kind = p_kind and status = 'approved') then
    raise exception 'BAD_ASSET' using errcode = 'P0001';
  end if;
end; $fn$;

-- Alta (p_expected_version null) o edición (p_expected_version = versión en pantalla). Campos permitidos:
-- name, role, code, abilities, face_asset_id, full_asset_id. Nada más (mass assignment).
create or replace function public.app_admin_agent_save(
  p_actor uuid, p_id text, p_patch jsonb, p_expected_version int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old public.agents; v_new public.agents; v_key text; v_ab jsonb; v_slots text;
begin
  perform public._require_admin(p_actor);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'BAD_FIELD' using errcode = 'P0001'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'role', 'code', 'abilities', 'face_asset_id', 'full_asset_id') then
      raise exception 'BAD_FIELD' using errcode = 'P0001';
    end if;
  end loop;
  if p_patch ? 'role' and (p_patch->>'role') not in ('duelist', 'initiator', 'sentinel', 'controller') then
    raise exception 'BAD_ROLE' using errcode = 'P0001';
  end if;
  if p_patch ? 'abilities' then
    v_ab := p_patch->'abilities';
    if jsonb_typeof(v_ab) <> 'array' or jsonb_array_length(v_ab) <> 4 then raise exception 'BAD_ABILITIES' using errcode = 'P0001'; end if;
    select string_agg(e->>'slot', '' order by ord) into v_slots from jsonb_array_elements(v_ab) with ordinality as t(e, ord);
    if v_slots <> 'CQEX' or exists (select 1 from jsonb_array_elements(v_ab) e
                                     where char_length(btrim(coalesce(e->>'name', ''))) not between 2 and 48
                                        or (select count(*) from jsonb_object_keys(e)) <> 2) then
      raise exception 'BAD_ABILITIES' using errcode = 'P0001';
    end if;
  end if;
  if p_patch ? 'face_asset_id' then perform public._validate_agent_asset((p_patch->>'face_asset_id')::uuid, 'agent_face'); end if;
  if p_patch ? 'full_asset_id' then perform public._validate_agent_asset((p_patch->>'full_asset_id')::uuid, 'agent_full'); end if;

  select * into v_old from public.agents where id = p_id for update;
  if v_old.id is null then
    if p_expected_version is not null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
    if p_id is null or p_id !~ '^[a-z0-9]{2,24}$' then raise exception 'BAD_ID' using errcode = 'P0001'; end if;
    insert into public.agents (id, name, role, code, abilities, face_asset_id, full_asset_id, lifecycle, origin, version, created_by, updated_by)
    values (p_id, btrim(p_patch->>'name'), p_patch->>'role', p_patch->>'code', coalesce(p_patch->'abilities', '[]'::jsonb),
            (p_patch->>'face_asset_id')::uuid, (p_patch->>'full_asset_id')::uuid, 'DRAFT', 'admin', 1, p_actor, p_actor)
    returning * into v_new;
  else
    if p_expected_version is null or v_old.version <> p_expected_version then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
    update public.agents set
      name          = case when p_patch ? 'name' then btrim(p_patch->>'name') else name end,
      role          = case when p_patch ? 'role' then p_patch->>'role' else role end,
      code          = case when p_patch ? 'code' then p_patch->>'code' else code end,
      abilities     = case when p_patch ? 'abilities' then p_patch->'abilities' else abilities end,
      face_asset_id = case when p_patch ? 'face_asset_id' then (p_patch->>'face_asset_id')::uuid else face_asset_id end,
      full_asset_id = case when p_patch ? 'full_asset_id' then (p_patch->>'full_asset_id')::uuid else full_asset_id end,
      version = version + 1, updated_at = now(), updated_by = p_actor
    where id = p_id returning * into v_new;
  end if;

  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, case when v_old.id is null then 'agent_create' else 'agent_update' end, 'agent', p_id,
          jsonb_build_object('reason', p_reason, 'before', case when v_old.id is null then null else public._agent_json(v_old) end,
                             'after', public._agent_json(v_new)));
  perform public._bump_entity('agents');
  return public._agent_json(v_new);
end; $fn$;

create or replace function public.app_admin_agent_lifecycle(
  p_actor uuid, p_id text, p_to text, p_expected_version int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old public.agents; v_new public.agents;
begin
  perform public._require_admin(p_actor);
  if p_reason is null or char_length(btrim(p_reason)) < 4 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v_old from public.agents where id = p_id for update;
  if v_old.id is null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if p_expected_version is null or v_old.version <> p_expected_version then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
  if not ((v_old.lifecycle = 'DRAFT' and p_to = 'PUBLISHED') or (v_old.lifecycle = 'PUBLISHED' and p_to = 'RETIRED')
       or (v_old.lifecycle = 'RETIRED' and p_to = 'PUBLISHED')) then
    raise exception 'BAD_TRANSITION' using errcode = 'P0001';
  end if;
  -- Publicar un agente NUEVO exige su arte (los 29 sembrados usan el arte estático de F59).
  if p_to = 'PUBLISHED' and v_old.origin = 'admin' and (v_old.face_asset_id is null or v_old.full_asset_id is null) then
    raise exception 'CONTENT_INCOMPLETE' using errcode = 'P0001';
  end if;
  if p_to = 'PUBLISHED' and (v_old.code is null or jsonb_array_length(v_old.abilities) <> 4) then
    raise exception 'CONTENT_INCOMPLETE' using errcode = 'P0001';
  end if;
  update public.agents set lifecycle = p_to, version = version + 1, updated_at = now(), updated_by = p_actor,
    published_at = case when p_to = 'PUBLISHED' then coalesce(published_at, now()) else published_at end,
    retired_at   = case when p_to = 'RETIRED' then now() when p_to = 'PUBLISHED' then null else retired_at end
  where id = p_id returning * into v_new;
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'agent_' || lower(p_to), 'agent', p_id,
          jsonb_build_object('reason', p_reason, 'before', public._agent_json(v_old), 'after', public._agent_json(v_new)));
  perform public._bump_entity('agents');
  return public._agent_json(v_new);
end; $fn$;

-- Referencias REALES a un agente (inspector de dependencias).
create or replace function public.app_admin_agent_references(p_id text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'mapPlayerStats', (select count(*) from public.map_player_stats where agent_id = p_id),
    'playerStats',    (select count(*) from public.player_stats where agent_id = p_id),
    'compositions',   (select count(*) from public.user_compositions where p_id = any(agent_ids)),
    'strats',         (select count(*) from public.user_strats where plan::text like '%"agentId": "' || p_id || '"%' or plan::text like '%"agentId":"' || p_id || '"%'));
$fn$;

-- Borrado DURO: sólo borradores sin ninguna referencia. Lo demás se retira.
create or replace function public.app_admin_agent_delete_draft(
  p_actor uuid, p_id text, p_expected_version int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old public.agents; v_refs jsonb;
begin
  perform public._require_admin(p_actor);
  if p_reason is null or char_length(btrim(p_reason)) < 4 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v_old from public.agents where id = p_id for update;
  if v_old.id is null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_old.version <> p_expected_version then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
  if v_old.lifecycle <> 'DRAFT' then raise exception 'NOT_A_DRAFT' using errcode = 'P0001'; end if;
  v_refs := public.app_admin_agent_references(p_id);
  if (v_refs->>'mapPlayerStats')::int + (v_refs->>'playerStats')::int + (v_refs->>'compositions')::int + (v_refs->>'strats')::int > 0 then
    raise exception 'HAS_REFERENCES' using errcode = 'P0001';
  end if;
  delete from public.agents where id = p_id;
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'agent_delete_draft', 'agent', p_id,
          jsonb_build_object('reason', p_reason, 'before', public._agent_json(v_old), 'after', null, 'references', v_refs));
  perform public._bump_entity('agents');
  return jsonb_build_object('deleted', p_id);
end; $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3 · SOBRES CMS
-- ════════════════════════════════════════════════════════════════════════════
-- Un sobre creado desde el panel HEREDA la economía de un sobre existente (`template_pack_id`: precio, nº de cartas,
-- pesos, garantías y tabla de clases F57.3). El panel decide identidad, arte, visibilidad y POOL (elegibilidad), no
-- una economía nueva. Precio y nº de cartas se guardan (histórico estable) y el servidor exige que coincidan con la
-- plantilla; tras publicar ya no se pueden cambiar (ECONOMY_FROZEN).
create table if not exists public.content_packs (
  id               text primary key check (id ~ '^cms-[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 48),
  name             text not null check (char_length(btrim(name)) between 3 and 60),
  description      text not null default '' check (char_length(description) <= 400),
  template_pack_id text not null check (template_pack_id ~ '^[a-z0-9-]{2,40}$'),
  price            int  not null check (price >= 0),
  card_count       int  not null check (card_count between 1 and 10),
  art_asset_id     uuid references public.assets(id) on delete restrict,
  accent           text check (accent is null or accent ~ '^#[0-9a-fA-F]{6}$'),
  lifecycle        text not null default 'DRAFT' check (lifecycle in ('DRAFT', 'ACTIVE', 'RETIRED')),
  available_from   timestamptz,
  available_to     timestamptz,
  sim_summary      jsonb,
  version          int  not null default 1,
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz,
  retired_at       timestamptz,
  constraint content_packs_window_check check (available_to is null or available_from is null or available_to > available_from)
);
create index if not exists content_packs_lifecycle_idx on public.content_packs (lifecycle);
alter table public.content_packs enable row level security;
revoke all on public.content_packs from public, anon, authenticated;
grant select, insert, update, delete on public.content_packs to service_role;

create or replace function public._pack_json(p public.content_packs)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'templatePackId', p.template_pack_id,
    'price', p.price, 'cardCount', p.card_count, 'artAssetId', p.art_asset_id, 'accent', p.accent, 'lifecycle', p.lifecycle,
    'availableFrom', p.available_from, 'availableTo', p.available_to, 'version', p.version);
$fn$;

create or replace function public.app_admin_pack_save(
  p_actor uuid, p_id text, p_patch jsonb, p_expected_version int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old public.content_packs; v_new public.content_packs; v_key text;
begin
  perform public._require_admin(p_actor);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'BAD_FIELD' using errcode = 'P0001'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'description', 'template_pack_id', 'price', 'card_count', 'art_asset_id', 'accent',
                     'available_from', 'available_to', 'sim_summary') then
      raise exception 'BAD_FIELD' using errcode = 'P0001';
    end if;
  end loop;
  if p_patch ? 'art_asset_id' and p_patch->>'art_asset_id' is not null
     and not exists (select 1 from public.assets where id = (p_patch->>'art_asset_id')::uuid and kind = 'pack_art' and status = 'approved') then
    raise exception 'BAD_ASSET' using errcode = 'P0001';
  end if;

  select * into v_old from public.content_packs where id = p_id for update;
  if v_old.id is null then
    if p_expected_version is not null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
    insert into public.content_packs (id, name, description, template_pack_id, price, card_count, art_asset_id, accent,
                                      available_from, available_to, created_by, updated_by)
    values (p_id, btrim(p_patch->>'name'), coalesce(p_patch->>'description', ''), p_patch->>'template_pack_id',
            (p_patch->>'price')::int, (p_patch->>'card_count')::int, (p_patch->>'art_asset_id')::uuid, p_patch->>'accent',
            (p_patch->>'available_from')::timestamptz, (p_patch->>'available_to')::timestamptz, p_actor, p_actor)
    returning * into v_new;
  else
    if p_expected_version is null or v_old.version <> p_expected_version then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
    -- Economía congelada tras publicar: plantilla, precio y nº de cartas sólo cambian en borrador.
    if v_old.lifecycle <> 'DRAFT' and (
         (p_patch ? 'template_pack_id' and p_patch->>'template_pack_id' is distinct from v_old.template_pack_id)
      or (p_patch ? 'price' and (p_patch->>'price')::int is distinct from v_old.price)
      or (p_patch ? 'card_count' and (p_patch->>'card_count')::int is distinct from v_old.card_count)) then
      raise exception 'ECONOMY_FROZEN' using errcode = 'P0001';
    end if;
    update public.content_packs set
      name             = case when p_patch ? 'name' then btrim(p_patch->>'name') else name end,
      description      = case when p_patch ? 'description' then coalesce(p_patch->>'description', '') else description end,
      template_pack_id = case when p_patch ? 'template_pack_id' then p_patch->>'template_pack_id' else template_pack_id end,
      price            = case when p_patch ? 'price' then (p_patch->>'price')::int else price end,
      card_count       = case when p_patch ? 'card_count' then (p_patch->>'card_count')::int else card_count end,
      art_asset_id     = case when p_patch ? 'art_asset_id' then (p_patch->>'art_asset_id')::uuid else art_asset_id end,
      accent           = case when p_patch ? 'accent' then p_patch->>'accent' else accent end,
      available_from   = case when p_patch ? 'available_from' then (p_patch->>'available_from')::timestamptz else available_from end,
      available_to     = case when p_patch ? 'available_to' then (p_patch->>'available_to')::timestamptz else available_to end,
      sim_summary      = case when p_patch ? 'sim_summary' then p_patch->'sim_summary' else sim_summary end,
      version = version + 1, updated_at = now(), updated_by = p_actor
    where id = p_id returning * into v_new;
  end if;
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, case when v_old.id is null then 'pack_create' else 'pack_update' end, 'pack', p_id,
          jsonb_build_object('reason', p_reason, 'before', case when v_old.id is null then null else public._pack_json(v_old) end,
                             'after', public._pack_json(v_new)));
  perform public._bump_entity('packs');
  return public._pack_json(v_new);
end; $fn$;

-- Pool publicable para un sobre: al menos un pool ACTIVE enlazado y habilitado, y si es EXPLICIT/MIXED con alguna
-- entrada INCLUDE. La SIMULACIÓN (servidor) comprueba además que cada clase tenga cartas; aquí es la red mínima.
create or replace function public._pack_has_usable_pool(p_pack text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.content_pack_pools b join public.content_pools p on p.id = b.pool_id
     where b.pack_id = p_pack and b.enabled and p.lifecycle = 'ACTIVE'
       and (p.mode = 'RULE' or exists (select 1 from public.content_pool_entries e where e.pool_id = p.id and e.mode = 'INCLUDE')));
$fn$;

create or replace function public.app_admin_pack_lifecycle(
  p_actor uuid, p_id text, p_to text, p_expected_version int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old public.content_packs; v_new public.content_packs;
begin
  perform public._require_admin(p_actor);
  if p_reason is null or char_length(btrim(p_reason)) < 4 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v_old from public.content_packs where id = p_id for update;
  if v_old.id is null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if p_expected_version is null or v_old.version <> p_expected_version then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
  if not ((v_old.lifecycle = 'DRAFT' and p_to = 'ACTIVE') or (v_old.lifecycle = 'ACTIVE' and p_to = 'RETIRED')
       or (v_old.lifecycle = 'RETIRED' and p_to = 'ACTIVE')) then
    raise exception 'BAD_TRANSITION' using errcode = 'P0001';
  end if;
  if p_to = 'ACTIVE' and (v_old.art_asset_id is null or v_old.sim_summary is null or not public._pack_has_usable_pool(p_id)) then
    raise exception 'CONTENT_INCOMPLETE' using errcode = 'P0001';
  end if;
  update public.content_packs set lifecycle = p_to, version = version + 1, updated_at = now(), updated_by = p_actor,
    published_at = case when p_to = 'ACTIVE' then coalesce(published_at, now()) else published_at end,
    retired_at   = case when p_to = 'RETIRED' then now() when p_to = 'ACTIVE' then null else retired_at end
  where id = p_id returning * into v_new;
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'pack_' || lower(p_to), 'pack', p_id,
          jsonb_build_object('reason', p_reason, 'before', public._pack_json(v_old), 'after', public._pack_json(v_new)));
  perform public._bump_entity('packs');
  return public._pack_json(v_new);
end; $fn$;

-- Referencias REALES a un sobre (código o CMS).
create or replace function public.app_admin_pack_references(p_id text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'inventories',   (select count(*) from public.user_packs where pack_id = p_id and qty > 0),
    'inventoryUnits',(select coalesce(sum(qty), 0) from public.user_packs where pack_id = p_id),
    'purchases',     (select count(*) from public.credit_transactions where reason = 'buy_pack:' || p_id),
    'opens',         (select count(*) from public.economy_ops where kind = 'open_pack' and result->>'packId' = p_id),
    'poolBindings',  (select count(*) from public.content_pack_pools where pack_id = p_id));
$fn$;

-- Borrado DURO de un borrador sin historia. Se lleva sus enlaces y su pool dedicado `pack-<id>` si es DRAFT y no lo
-- usa nadie más: así un borrador de prueba no deja residuos.
create or replace function public.app_admin_pack_delete_draft(
  p_actor uuid, p_id text, p_expected_version int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old public.content_packs; v_refs jsonb; v_pool text := 'pack-' || p_id; v_pool_deleted boolean := false;
begin
  perform public._require_admin(p_actor);
  if p_reason is null or char_length(btrim(p_reason)) < 4 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v_old from public.content_packs where id = p_id for update;
  if v_old.id is null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_old.version <> p_expected_version then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
  if v_old.lifecycle <> 'DRAFT' then raise exception 'NOT_A_DRAFT' using errcode = 'P0001'; end if;
  v_refs := public.app_admin_pack_references(p_id);
  if (v_refs->>'inventories')::int + (v_refs->>'purchases')::int + (v_refs->>'opens')::int > 0 then
    raise exception 'HAS_REFERENCES' using errcode = 'P0001';
  end if;
  delete from public.content_pack_pools where pack_id = p_id;
  if exists (select 1 from public.content_pools where id = v_pool and lifecycle = 'DRAFT')
     and not exists (select 1 from public.content_pack_pools where pool_id = v_pool) then
    delete from public.content_pool_entries where pool_id = v_pool;
    delete from public.content_pools where id = v_pool;
    v_pool_deleted := true;
  end if;
  delete from public.content_packs where id = p_id;
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'pack_delete_draft', 'pack', p_id,
          jsonb_build_object('reason', p_reason, 'before', public._pack_json(v_old), 'after', null,
                             'references', v_refs, 'poolDeleted', v_pool_deleted));
  perform public._bump_entity('packs');
  perform public._bump_distribution(null);
  return jsonb_build_object('deleted', p_id, 'poolDeleted', v_pool_deleted);
end; $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4 · CARTAS: PRESENTACIÓN IMPRESA DE LAS ALTAS CMS
-- ════════════════════════════════════════════════════════════════════════════
-- Las 331 cartas diseñadas llevan lo impreso en el manifiesto de código (derivado de su propia imagen: LA CARTA ES EL
-- ASSET) y aquí quedan en NULL: no se tocan. Una carta NUEVA del panel guarda aquí su rol de carta, OVR y seis stats
-- impresas, su equipo impreso (autoritativo, no cambia con el equipo actual del jugador) y su arte (asset).
alter table public.content_cards add column if not exists presentation     jsonb;
alter table public.content_cards add column if not exists presentation_rev int not null default 0;
alter table public.content_cards drop constraint if exists content_cards_presentation_check;
alter table public.content_cards add constraint content_cards_presentation_check
  check (presentation is null or jsonb_typeof(presentation) = 'object');

create or replace function public.app_admin_card_set_presentation(
  p_actor uuid, p_card_id text, p_presentation jsonb, p_expected_rev int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old public.content_cards; v_key text; v_stat text; v_asset uuid;
begin
  perform public._require_admin(p_actor);
  if p_presentation is null or jsonb_typeof(p_presentation) <> 'object' then raise exception 'BAD_FIELD' using errcode = 'P0001'; end if;
  for v_key in select jsonb_object_keys(p_presentation) loop
    if v_key not in ('role', 'printed', 'team', 'imageAssetId', 'imagePath') then raise exception 'BAD_FIELD' using errcode = 'P0001'; end if;
  end loop;
  if (p_presentation->>'role') not in ('Duelista', 'Iniciador', 'Centinela', 'Controlador', 'Flex') then
    raise exception 'BAD_ROLE' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_presentation->'printed') <> 'object'
     or coalesce((p_presentation->'printed'->>'ovr')::int, -1) not between 40 and 99 then
    raise exception 'BAD_STATS' using errcode = 'P0001';
  end if;
  foreach v_stat in array array['dmg', 'scr', 'fks', 'hs', 'ast', 'clu'] loop
    if coalesce((p_presentation->'printed'->'stats'->>v_stat)::int, -1) not between 1 and 99 then
      raise exception 'BAD_STATS' using errcode = 'P0001';
    end if;
  end loop;
  if char_length(coalesce(p_presentation->>'team', '')) not between 2 and 12 then raise exception 'BAD_TEAM' using errcode = 'P0001'; end if;
  v_asset := (p_presentation->>'imageAssetId')::uuid;
  -- El arte es un asset aprobado de tipo carta, y `imagePath` es EXACTAMENTE su ruta en Storage (nada que invente el cliente).
  if v_asset is not null and not exists (select 1 from public.assets where id = v_asset and kind = 'card_artwork' and status = 'approved'
                                          and storage_path is not distinct from p_presentation->>'imagePath') then
    raise exception 'BAD_ASSET' using errcode = 'P0001';
  end if;
  if v_asset is null and p_presentation ? 'imagePath' then raise exception 'BAD_ASSET' using errcode = 'P0001'; end if;

  select * into v_old from public.content_cards where card_id = p_card_id for update;
  if v_old.card_id is null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_old.presentation_rev <> coalesce(p_expected_rev, -1) then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
  -- Sólo en borrador: lo impreso de una carta publicada no cambia (sus ejemplares ya repartidos lo llevan).
  if v_old.lifecycle not in ('DRAFT', 'REVIEW') then raise exception 'NOT_A_DRAFT' using errcode = 'P0001'; end if;

  update public.content_cards set presentation = p_presentation, presentation_rev = presentation_rev + 1 where card_id = p_card_id;
  insert into public.content_audit_log (actor, action, card_id, entity_type, entity_id, detail)
  values (p_actor, 'card_presentation', p_card_id, 'card', p_card_id,
          jsonb_build_object('reason', p_reason, 'before', v_old.presentation, 'after', p_presentation));
  return jsonb_build_object('cardId', p_card_id, 'presentationRev', v_old.presentation_rev + 1, 'catalogVersion', public._bump_catalog());
end; $fn$;

-- Red en la BD: una carta de ORIGEN PANEL no puede pasar a PUBLISHED sin su presentación completa (arte incluido),
-- entre por la RPC que entre. Las del catálogo diseñado (origin seed) no se ven afectadas.
create or replace function public._content_card_publish_guard()
returns trigger language plpgsql as $fn$
begin
  if new.lifecycle = 'PUBLISHED' and old.lifecycle is distinct from 'PUBLISHED' and new.origin = 'admin'
     and (new.presentation is null or new.presentation->>'imageAssetId' is null or new.presentation->>'imagePath' is null
          or new.presentation->'printed' is null) then
    raise exception 'CONTENT_INCOMPLETE' using errcode = 'P0001';
  end if;
  return new;
end; $fn$;
drop trigger if exists content_card_publish_guard on public.content_cards;
create trigger content_card_publish_guard before update of lifecycle on public.content_cards
  for each row execute function public._content_card_publish_guard();

-- Referencias REALES a una carta.
create or replace function public.app_admin_card_references(p_id text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'copies',      (select count(*) from public.user_cards where card_id = p_id),
    'owners',      (select count(distinct user_id) from public.user_cards where card_id = p_id),
    'decks',       (select count(*) from public.duel_decks d where exists (
                      select 1 from public.user_cards u where u.uid = any(d.card_uids) and u.card_id = p_id)),
    'pools',       (select count(distinct pool_id) from public.content_pool_entries where card_id = p_id),
    'favorites',   (select count(*) from public.user_card_favorites where card_id = p_id),
    'listings',    (select count(*) from public.market_listings where card_id = p_id),
    'versions',    (select count(*) from public.content_card_versions where card_id = p_id));
$fn$;

-- Alta CMS ATÓMICA: la definición (misma RPC de 0040, valores derivados por el servidor con el OVR IMPRESO) y su
-- presentación en UNA transacción. Nunca queda una carta del panel a medias.
create or replace function public.app_admin_card_create_draft(
  p_actor uuid, p_def jsonb, p_presentation jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r jsonb; v_id text;
begin
  perform public._require_admin(p_actor);
  if p_reason is null or char_length(btrim(p_reason)) < 4 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  r := public.app_content_create_card(p_def, p_reason, p_actor);
  v_id := r->>'cardId';
  perform public.app_admin_card_set_presentation(p_actor, v_id, p_presentation, 0, p_reason);
  return r || jsonb_build_object('presentationRev', 1);
end; $fn$;

-- Borrado DURO de un borrador del panel sin ninguna historia (ni ejemplares, ni pools, ni favoritos, ni mercado).
-- Auditado; lo que tiene historia se RETIRA (`app_content_set_lifecycle`).
create or replace function public.app_admin_card_delete_draft(
  p_actor uuid, p_card_id text, p_expected_rev int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v public.content_cards; v_refs jsonb;
begin
  perform public._require_admin(p_actor);
  if p_reason is null or char_length(btrim(p_reason)) < 4 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v from public.content_cards where card_id = p_card_id for update;
  if v.card_id is null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v.presentation_rev <> coalesce(p_expected_rev, -1) then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
  if v.lifecycle not in ('DRAFT', 'REVIEW', 'REJECTED') or v.origin <> 'admin' then raise exception 'NOT_A_DRAFT' using errcode = 'P0001'; end if;
  v_refs := public.app_admin_card_references(p_card_id);
  if (v_refs->>'copies')::int + (v_refs->>'pools')::int + (v_refs->>'favorites')::int + (v_refs->>'listings')::int > 0
     or exists (select 1 from public.card_mints where card_id = p_card_id) then
    raise exception 'HAS_REFERENCES' using errcode = 'P0001';
  end if;
  insert into public.content_audit_log (actor, action, card_id, entity_type, entity_id, detail)
  values (p_actor, 'card_delete_draft', p_card_id, 'card', p_card_id,
          jsonb_build_object('reason', p_reason, 'references', v_refs, 'after', null,
                             'before', jsonb_build_object('ovr', v.ovr, 'variant', v.variant_id, 'player', v.player_id, 'presentation', v.presentation)));
  perform public.app_content_purge_card(p_card_id);
  return jsonb_build_object('deleted', p_card_id);
end; $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5 · JUGADORES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.content_players add column if not exists version    int not null default 1;
alter table public.content_players add column if not exists photo_asset_id uuid references public.assets(id) on delete restrict;

create or replace function public._player_json(p public.content_players)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object('id', p.id, 'nick', p.nick, 'fullName', p.full_name, 'team', p.team, 'teamTag', p.team_tag,
    'region', p.region, 'role', p.role, 'country', p.country, 'stats', p.stats, 'status', p.status,
    'photoAssetId', p.photo_asset_id, 'version', p.version);
$fn$;

create or replace function public.app_admin_player_save(
  p_actor uuid, p_id text, p_patch jsonb, p_expected_version int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old public.content_players; v_new public.content_players; v_key text; v_stat text;
begin
  perform public._require_admin(p_actor);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'BAD_FIELD' using errcode = 'P0001'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('nick', 'full_name', 'team', 'team_tag', 'region', 'role', 'country', 'stats', 'status', 'photo_asset_id') then
      raise exception 'BAD_FIELD' using errcode = 'P0001';
    end if;
  end loop;
  if p_patch ? 'stats' then
    foreach v_stat in array array['dmg', 'scr', 'com', 'hs', 'ast', 'clu'] loop
      if coalesce((p_patch->'stats'->>v_stat)::int, -1) not between 1 and 99 then raise exception 'BAD_STATS' using errcode = 'P0001'; end if;
    end loop;
  end if;
  if p_patch ? 'photo_asset_id' and p_patch->>'photo_asset_id' is not null
     and not exists (select 1 from public.assets where id = (p_patch->>'photo_asset_id')::uuid and kind = 'player_photo' and status = 'approved') then
    raise exception 'BAD_ASSET' using errcode = 'P0001';
  end if;
  select * into v_old from public.content_players where id = p_id for update;
  if v_old.id is null then
    if p_expected_version is not null then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001'; end if;
    if p_id is null or p_id !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then raise exception 'BAD_ID' using errcode = 'P0001'; end if;
    insert into public.content_players (id, nick, full_name, team, team_tag, region, role, country, stats, status, origin, photo_asset_id)
    values (p_id, btrim(p_patch->>'nick'), nullif(btrim(coalesce(p_patch->>'full_name', '')), ''), coalesce(p_patch->>'team', ''),
            coalesce(p_patch->>'team_tag', ''), p_patch->>'region', p_patch->>'role', coalesce(p_patch->>'country', ''),
            p_patch->'stats', coalesce(p_patch->>'status', 'active'), 'admin', (p_patch->>'photo_asset_id')::uuid)
    returning * into v_new;
  else
    if p_expected_version is null or v_old.version <> p_expected_version then raise exception 'STALE_CONTENT' using errcode = 'P0001'; end if;
    update public.content_players set
      nick      = case when p_patch ? 'nick' then btrim(p_patch->>'nick') else nick end,
      full_name = case when p_patch ? 'full_name' then nullif(btrim(coalesce(p_patch->>'full_name', '')), '') else full_name end,
      team      = case when p_patch ? 'team' then coalesce(p_patch->>'team', '') else team end,
      team_tag  = case when p_patch ? 'team_tag' then coalesce(p_patch->>'team_tag', '') else team_tag end,
      region    = case when p_patch ? 'region' then p_patch->>'region' else region end,
      role      = case when p_patch ? 'role' then p_patch->>'role' else role end,
      country   = case when p_patch ? 'country' then coalesce(p_patch->>'country', '') else country end,
      stats     = case when p_patch ? 'stats' then p_patch->'stats' else stats end,
      status    = case when p_patch ? 'status' then p_patch->>'status' else status end,
      photo_asset_id = case when p_patch ? 'photo_asset_id' then (p_patch->>'photo_asset_id')::uuid else photo_asset_id end,
      version = version + 1, updated_at = now()
    where id = p_id returning * into v_new;
  end if;
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, case when v_old.id is null then 'player_create' else 'player_update' end, 'player', p_id,
          jsonb_build_object('reason', p_reason, 'before', case when v_old.id is null then null else public._player_json(v_old) end,
                             'after', public._player_json(v_new)));
  perform public._bump_entity('players');
  perform public._bump_catalog();
  return public._player_json(v_new);
end; $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6 · EVENTOS: descripción e imagen llegan al juego
-- ════════════════════════════════════════════════════════════════════════════
alter table public.events add column if not exists description text;
alter table public.events drop constraint if exists events_description_check;
alter table public.events add constraint events_description_check check (description is null or char_length(description) <= 600);
alter table public.admin_event_drafts add column if not exists image_asset_id uuid references public.assets(id) on delete restrict;

-- Misma firma y mismas comprobaciones que 0055; ahora copia descripción e imagen (URL resuelta por el servidor en
-- `p_image_url`, o la del borrador) a la fila canónica.
create or replace function public.app_admin_publish_event_v2(
  p_id uuid, p_actor uuid, p_expected_updated_at timestamptz, p_image_url text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_row public.admin_event_drafts; v_event_id text;
begin
  perform public._require_admin(p_actor);
  select * into v_row from public.admin_event_drafts where id = p_id for update;
  if v_row.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status <> 'draft' then raise exception 'NOT_A_DRAFT' using errcode = 'P0001'; end if;
  if p_expected_updated_at is not null and v_row.updated_at <> p_expected_updated_at then raise exception 'STALE_EVENT' using errcode = 'P0001'; end if;
  if v_row.ends_at <= now() then raise exception 'EVENT_ALREADY_ENDED' using errcode = 'P0001'; end if;
  if p_image_url is not null and char_length(p_image_url) > 500 then raise exception 'BAD_ASSET' using errcode = 'P0001'; end if;

  v_event_id := 'adm-' || replace(v_row.id::text, '-', '');
  insert into public.events (id, name, type, region, status, start_date, end_date, source, description, logo)
  values (v_event_id, v_row.name, v_row.type, v_row.region,
          case when v_row.starts_at > now() then 'upcoming' else 'ongoing' end,
          v_row.starts_at, v_row.ends_at, 'admin', v_row.description, coalesce(p_image_url, v_row.image_url));

  update public.admin_event_drafts
     set status = 'published', event_id = v_event_id, published_at = now(), published_by = p_actor, updated_at = now()
   where id = p_id returning * into v_row;

  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'event_publish', 'event', p_id::text,
          jsonb_build_object('eventId', v_event_id, 'before', jsonb_build_object('status', 'draft'),
                             'after', jsonb_build_object('status', 'published', 'eventId', v_event_id,
                                                         'description', v_row.description, 'image', coalesce(p_image_url, v_row.image_url))));
  return to_jsonb(v_row);
end; $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7 · SONDA DE ESQUEMA v2 — estado real, no existencia de ficheros
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.app_admin_schema_probe()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    '0040_content_audit_log',   to_regclass('public.content_audit_log') is not null,
    '0050_duel_active_deck',    to_regclass('public.duel_active_deck') is not null,
    '0051_campaign_progress',   to_regclass('public.campaign_progress') is not null,
    '0052_user_card_favorites', to_regclass('public.user_card_favorites') is not null,
    '0053_draft_runs',          to_regclass('public.draft_runs') is not null,
    '0054_user_compositions',   to_regclass('public.user_compositions') is not null,
    '0055_user_sanctions',      to_regclass('public.user_sanctions') is not null,
    '0055_admin_event_drafts',  to_regclass('public.admin_event_drafts') is not null,
    '0057_content_packs',       to_regclass('public.content_packs') is not null,
    '0057_agents_lifecycle',    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agents' and column_name = 'lifecycle'),
    '0057_card_presentation',   exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'content_cards' and column_name = 'presentation'),
    '0057_entity_version',      to_regclass('public.content_entity_version') is not null
  );
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- PERMISOS: sólo service_role ejecuta
-- ════════════════════════════════════════════════════════════════════════════
revoke all on function public._bump_entity(text)                                          from public, anon, authenticated;
revoke all on function public._require_admin(uuid)                                        from public, anon, authenticated;
revoke all on function public._validate_agent_asset(uuid, text)                           from public, anon, authenticated;
revoke all on function public._pack_has_usable_pool(text)                                 from public, anon, authenticated;
revoke all on function public.app_admin_agent_save(uuid, text, jsonb, int, text)          from public, anon, authenticated;
revoke all on function public.app_admin_agent_lifecycle(uuid, text, text, int, text)      from public, anon, authenticated;
revoke all on function public.app_admin_agent_references(text)                            from public, anon, authenticated;
revoke all on function public.app_admin_agent_delete_draft(uuid, text, int, text)         from public, anon, authenticated;
revoke all on function public.app_admin_pack_save(uuid, text, jsonb, int, text)           from public, anon, authenticated;
revoke all on function public.app_admin_pack_lifecycle(uuid, text, text, int, text)       from public, anon, authenticated;
revoke all on function public.app_admin_pack_references(text)                             from public, anon, authenticated;
revoke all on function public.app_admin_pack_delete_draft(uuid, text, int, text)          from public, anon, authenticated;
revoke all on function public.app_admin_card_set_presentation(uuid, text, jsonb, int, text) from public, anon, authenticated;
revoke all on function public.app_admin_card_references(text)                             from public, anon, authenticated;
revoke all on function public.app_admin_card_create_draft(uuid, jsonb, jsonb, text)        from public, anon, authenticated;
revoke all on function public.app_admin_card_delete_draft(uuid, text, int, text)           from public, anon, authenticated;
revoke all on function public.app_admin_player_save(uuid, text, jsonb, int, text)         from public, anon, authenticated;
revoke all on function public.app_admin_publish_event_v2(uuid, uuid, timestamptz, text)   from public, anon, authenticated;
revoke all on function public.app_admin_schema_probe()                                    from public, anon, authenticated;
grant execute on function public._bump_entity(text)                                        to service_role;
grant execute on function public.app_admin_agent_save(uuid, text, jsonb, int, text)        to service_role;
grant execute on function public.app_admin_agent_lifecycle(uuid, text, text, int, text)    to service_role;
grant execute on function public.app_admin_agent_references(text)                          to service_role;
grant execute on function public.app_admin_agent_delete_draft(uuid, text, int, text)       to service_role;
grant execute on function public.app_admin_pack_save(uuid, text, jsonb, int, text)         to service_role;
grant execute on function public.app_admin_pack_lifecycle(uuid, text, text, int, text)     to service_role;
grant execute on function public.app_admin_pack_references(text)                           to service_role;
grant execute on function public.app_admin_pack_delete_draft(uuid, text, int, text)        to service_role;
grant execute on function public.app_admin_card_set_presentation(uuid, text, jsonb, int, text) to service_role;
grant execute on function public.app_admin_card_references(text)                           to service_role;
grant execute on function public.app_admin_card_create_draft(uuid, jsonb, jsonb, text)      to service_role;
grant execute on function public.app_admin_card_delete_draft(uuid, text, int, text)         to service_role;
grant execute on function public.app_admin_player_save(uuid, text, jsonb, int, text)       to service_role;
grant execute on function public.app_admin_publish_event_v2(uuid, uuid, timestamptz, text) to service_role;
grant execute on function public.app_admin_schema_probe()                                  to service_role;

comment on table public.content_packs is 'F60 · sobres creados desde /admin; heredan la economía de template_pack_id (código) y eligen cartas por su pool pack-<id>.';
comment on column public.content_cards.presentation is 'F60 · lo IMPRESO de una carta de origen panel (rol, OVR, 6 stats, equipo impreso, arte). NULL en las 331 del catálogo diseñado (manifiesto).';


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
ROLLBACK;
