-- ============================================================================================================
-- 0062 · F82 COLLECTION SETS, TEAM BADGES & TROPHY ROOM
--
-- Qué añade (todo aditivo; nada existente cambia de forma):
--   1. collection_sets                 sets coleccionables VERSIONADOS. DRAFT editable; PUBLISHED/RETIRED inmutables
--                                      (requisitos, recompensa, logo, sujeto y checksum congelados por disparador).
--                                      Una sola versión PUBLISHED por familia.
--   2. user_collection_completions     «lo completaste». PK (user_id, set_id) = exactamente una vez. Permanente: ningún
--                                      desguace, crafteo o venta lo toca (no hay FK a user_cards a propósito).
--   3. app_collection_claim            reclamo ATÓMICO e IDEMPOTENTE: comprueba en la MISMA transacción, contra
--                                      user_cards, que cada requisito tiene al menos una carta elegible; inserta la
--                                      compleción y concede la insignia en user_cosmetics (tabla existente, 0016).
--   4. player_profile_customization.featured_badge_ids + player_profile_set_badges
--                                      hasta 3 insignias destacadas en el perfil; solo insignias POSEÍDAS.
--   (Analítica: las compleciones, insignias y destacadas quedan con fecha en sus tablas; el contrato de flujos de
--    telemetría sigue cerrado a propósito y NO se toca aquí.)
--
-- Seguridad: RLS activada SIN políticas en las tablas nuevas (solo service_role, como 0049); las funciones son
-- SECURITY DEFINER con search_path fijo y EXECUTE solo para service_role.
-- Rollback: docs/operations/rollback/0062_collection_sets.ROLLBACK.sql
-- ============================================================================================================

-- ── 1. collection_sets ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.collection_sets (
  id            text primary key check (id ~ '^[a-z0-9-]{3,64}$'),
  family        text not null check (family ~ '^[a-z]+:[a-z0-9-]{1,48}$'),
  version       int  not null check (version >= 1),
  kind          text not null check (kind in ('TEAM', 'EDITION')),
  subject_id    text not null check (length(subject_id) between 1 and 64),
  title         text not null check (length(btrim(title)) between 1 and 80),
  status        text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'RETIRED')),
  requirements  jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements) = 'array'),
  reward        jsonb not null default '{}'::jsonb check (jsonb_typeof(reward) = 'object'),
  logo          text check (logo is null or logo ~ '^/[a-z0-9/_.-]{1,120}$'),
  checksum      text,
  row_version   int not null default 1 check (row_version >= 1),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  published_by  uuid,
  retired_at    timestamptz,
  constraint collection_sets_family_version unique (family, version),
  -- Lo que no es borrador lleva checksum y fecha de publicación; un set sin requisitos o sin insignia no se publica.
  constraint collection_sets_published_shape check (
    status = 'DRAFT' or (
      checksum is not null and published_at is not null
      and jsonb_array_length(requirements) > 0
      and coalesce(reward->>'badgeId', '') ~ '^insignia:coleccion:[a-z0-9-]{1,48}$'
    )
  ),
  constraint collection_sets_retired_shape check ((status = 'RETIRED') = (retired_at is not null))
);

create unique index if not exists collection_sets_one_published_per_family
  on public.collection_sets (family) where status = 'PUBLISHED';
create index if not exists collection_sets_status_idx on public.collection_sets (status);

alter table public.collection_sets enable row level security;
revoke all on public.collection_sets from public, anon, authenticated;
grant select, insert, update, delete on public.collection_sets to service_role;
comment on table public.collection_sets is
  'F82 · sets coleccionables versionados (DRAFT/PUBLISHED/RETIRED). Publicado = requisitos congelados. Solo servidor.';

-- Inmutabilidad de lo publicado y transiciones válidas. Lo hace la BD, no solo el panel.
create or replace function public._collection_sets_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'COLLECTION_SET_IMMUTABLE: solo se borran borradores (%)', old.id using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status <> 'DRAFT' then
    if new.id is distinct from old.id or new.family is distinct from old.family or new.version is distinct from old.version
       or new.kind is distinct from old.kind or new.subject_id is distinct from old.subject_id
       or new.title is distinct from old.title or new.requirements is distinct from old.requirements
       or new.reward is distinct from old.reward or new.logo is distinct from old.logo
       or new.checksum is distinct from old.checksum or new.published_at is distinct from old.published_at
       or new.published_by is distinct from old.published_by or new.created_at is distinct from old.created_at then
      raise exception 'COLLECTION_SET_IMMUTABLE: % está %', old.id, old.status using errcode = 'P0001';
    end if;
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'DRAFT' and new.status = 'PUBLISHED')
    or (old.status = 'PUBLISHED' and new.status = 'RETIRED')
  ) then
    raise exception 'COLLECTION_SET_TRANSITION: % → %', old.status, new.status using errcode = 'P0001';
  end if;
  if old.status = 'RETIRED' and new is distinct from old then
    raise exception 'COLLECTION_SET_IMMUTABLE: % está RETIRED', old.id using errcode = 'P0001';
  end if;

  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;

drop trigger if exists trg_collection_sets_guard on public.collection_sets;
create trigger trg_collection_sets_guard
  before update or delete on public.collection_sets
  for each row execute function public._collection_sets_guard();

-- Un set NUEVO nace borrador (no se puede insertar ya publicado saltándose la validación del servidor).
create or replace function public._collection_sets_insert_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'DRAFT' then
    raise exception 'COLLECTION_SET_TRANSITION: un set nace DRAFT' using errcode = 'P0001';
  end if;
  new.row_version := 1;
  return new;
end $$;

drop trigger if exists trg_collection_sets_insert_guard on public.collection_sets;
create trigger trg_collection_sets_insert_guard
  before insert on public.collection_sets
  for each row execute function public._collection_sets_insert_guard();

revoke all on function public._collection_sets_guard() from public, anon, authenticated;
revoke all on function public._collection_sets_insert_guard() from public, anon, authenticated;

-- ── 2. user_collection_completions ────────────────────────────────────────────────────────────────────────
create table if not exists public.user_collection_completions (
  user_id       uuid not null references auth.users(id) on delete cascade,
  set_id        text not null references public.collection_sets(id),
  badge_id      text not null,
  completed_at  timestamptz not null default now(),
  -- Qué carta satisfizo cada requisito EN EL MOMENTO del reclamo (auditoría; no se recalcula nunca).
  satisfied_by  jsonb not null default '{}'::jsonb,
  primary key (user_id, set_id)
);
create index if not exists ucc_set_idx on public.user_collection_completions (set_id);

alter table public.user_collection_completions enable row level security;
revoke all on public.user_collection_completions from public, anon, authenticated;
grant select, insert on public.user_collection_completions to service_role;
comment on table public.user_collection_completions is
  'F82 · compleciones permanentes (una por usuario y set). No se borran al perder cartas. Solo servidor.';

-- ── 3. app_collection_claim ───────────────────────────────────────────────────────────────────────────────
create or replace function public.app_collection_claim(p_user uuid, p_set text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        public.collection_sets%rowtype;
  r        jsonb;
  got      text;
  missing  int := 0;
  sat      jsonb := '{}'::jsonb;
  done     public.user_collection_completions%rowtype;
  badge    text;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('code', 'BAD_USER');
  end if;

  -- FOR SHARE: un retiro concurrente espera a este reclamo (o este ve el set ya retirado).
  select * into s from public.collection_sets where id = p_set for share;
  if not found or s.status = 'DRAFT' then
    return jsonb_build_object('code', 'NOT_FOUND');
  end if;

  select * into done from public.user_collection_completions where user_id = p_user and set_id = p_set;
  if found then
    return jsonb_build_object('code', 'ALREADY', 'badgeId', done.badge_id, 'completedAt', done.completed_at);
  end if;

  if s.status <> 'PUBLISHED' then
    return jsonb_build_object('code', 'RETIRED');
  end if;

  for r in select * from jsonb_array_elements(s.requirements) loop
    select min(uc.card_id) into got
      from public.user_cards uc
     where uc.user_id = p_user
       and uc.card_id in (select jsonb_array_elements_text(r->'cardIds'));
    if got is null then
      missing := missing + 1;
    else
      sat := sat || jsonb_build_object(r->>'key', got);
    end if;
  end loop;

  if missing > 0 then
    return jsonb_build_object('code', 'INCOMPLETE', 'missing', missing);
  end if;

  badge := s.reward->>'badgeId';
  insert into public.user_collection_completions (user_id, set_id, badge_id, satisfied_by)
  values (p_user, p_set, badge, sat)
  on conflict (user_id, set_id) do nothing;
  if not found then
    -- Otra pestaña/reintento ganó la carrera entre la lectura y la inserción: misma respuesta que ALREADY.
    select * into done from public.user_collection_completions where user_id = p_user and set_id = p_set;
    return jsonb_build_object('code', 'ALREADY', 'badgeId', done.badge_id, 'completedAt', done.completed_at);
  end if;

  insert into public.user_cosmetics (user_id, cosmetic_id, source)
  values (p_user, badge, 'collection:' || p_set)
  on conflict do nothing;

  return jsonb_build_object('code', 'COMPLETED', 'badgeId', badge, 'completedAt', now());
end $$;

revoke all on function public.app_collection_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.app_collection_claim(uuid, text) to service_role;

-- ── 4. Insignias destacadas en el perfil (extiende 0049, no es un sistema aparte) ──────────────────────────
alter table public.player_profile_customization
  add column if not exists featured_badge_ids text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ppc_badges_max') then
    alter table public.player_profile_customization
      add constraint ppc_badges_max check (coalesce(cardinality(featured_badge_ids), 0) <= 3),
      add constraint ppc_badges_no_nulls check (array_position(featured_badge_ids, null) is null),
      add constraint ppc_badges_unique check (public._text_array_is_unique(featured_badge_ids));
  end if;
end $$;

create or replace function public.player_profile_set_badges(p_user uuid, p_badges text[], p_expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cur public.player_profile_customization%rowtype;
  n   int;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('code', 'BAD_USER');
  end if;
  if p_badges is null then return jsonb_build_object('code', 'BAD_BODY'); end if;
  if coalesce(cardinality(p_badges), 0) > 3 then return jsonb_build_object('code', 'TOO_MANY'); end if;
  if array_position(p_badges, null) is not null or not public._text_array_is_unique(p_badges) then
    return jsonb_build_object('code', 'DUPLICATE');
  end if;
  if exists (select 1 from unnest(p_badges) b where b !~ '^insignia:[a-z0-9:-]{1,80}$') then
    return jsonb_build_object('code', 'BAD_ID');
  end if;

  insert into public.player_profile_customization (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into cur from public.player_profile_customization where user_id = p_user for update;

  -- Solo lo que el usuario POSEE (user_cosmetics). Un id inventado o ajeno = LOCKED.
  if coalesce(cardinality(p_badges), 0) > 0 then
    select count(*) into n from public.user_cosmetics where user_id = p_user and cosmetic_id = any (p_badges);
    if n <> cardinality(p_badges) then return jsonb_build_object('code', 'LOCKED'); end if;
  end if;

  if p_badges = cur.featured_badge_ids then
    return jsonb_build_object('code', 'UNCHANGED', 'version', cur.version);
  end if;
  if p_expected_version is not null and p_expected_version <> cur.version then
    return jsonb_build_object('code', 'CONFLICT', 'version', cur.version);
  end if;

  update public.player_profile_customization
     set featured_badge_ids = p_badges, version = cur.version + 1, updated_at = now()
   where user_id = p_user;
  return jsonb_build_object('code', 'SAVED', 'version', cur.version + 1);
end $$;

revoke all on function public.player_profile_set_badges(uuid, text[], int) from public, anon, authenticated;
grant execute on function public.player_profile_set_badges(uuid, text[], int) to service_role;
