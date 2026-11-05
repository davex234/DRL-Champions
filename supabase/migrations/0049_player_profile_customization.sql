-- 0049 · PLAYER IDENTITY 2.0 — vitrina de cartas y logros destacados (Fase 31) — APLICADA (VPS 2026-09-15, Fase 35.1).
--
-- Estado: fichero LOCAL, aditivo e idempotente. Aplicada en la BD del VPS el 2026-09-15 11:59Z (Fase 35.1), con los ayudantes de unicidad revocados a clientes. No toca
-- `schema_migrations`. Sin ella, el perfil público se ve igual pero con la vitrina y los logros
-- destacados vacíos, y guardarlos responde «todavía no disponible». Nada más depende de ella.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- QUÉ RESUELVE
--   La personalización PÚBLICA del perfil: qué 3 instancias REALES de `user_cards` expone el
--   jugador (en orden: el slot 1 es la carta destacada) y qué 3 logros conseguidos destaca.
--   Una fila por jugador. Nada de preferencias sin esquema en `profiles`.
--
-- POR QUÉ ASÍ
--   · `uuid[]` / `text[]` con CHECK de máximo y de unicidad: la integridad de forma vive en la
--     tabla. La PROPIEDAD no puede ser una FK (la carta es de otra tabla y cambia de dueño), así
--     que la valida el RPC en la misma transacción que escribe.
--   · `version` para concurrencia optimista: dos pestañas no se pisan en silencio.
--   · Solo servidor: RLS activa sin políticas; el cliente jamás escribe ni lee la tabla directa.
--
-- REVERSIÓN (conceptual): drop function public.player_profile_set; drop table
--   public.player_profile_customization; drop function public._uuid_array_is_unique,
--   public._text_array_is_unique.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public._uuid_array_is_unique(a uuid[])
returns boolean language sql immutable as $$
  select coalesce(cardinality(a), 0) = (select count(distinct x) from unnest(a) as x)
$$;

create or replace function public._text_array_is_unique(a text[])
returns boolean language sql immutable as $$
  select coalesce(cardinality(a), 0) = (select count(distinct x) from unnest(a) as x)
$$;

create table if not exists public.player_profile_customization (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  showcase_card_uids        uuid[] not null default '{}',
  featured_achievement_ids  text[] not null default '{}',
  version                   int not null default 0 check (version >= 0),
  updated_at                timestamptz not null default now(),
  constraint ppc_showcase_max      check (coalesce(cardinality(showcase_card_uids), 0) <= 3),
  constraint ppc_featured_max      check (coalesce(cardinality(featured_achievement_ids), 0) <= 3),
  constraint ppc_showcase_no_nulls check (array_position(showcase_card_uids, null) is null),
  constraint ppc_featured_no_nulls check (array_position(featured_achievement_ids, null) is null),
  constraint ppc_showcase_unique   check (public._uuid_array_is_unique(showcase_card_uids)),
  constraint ppc_featured_unique   check (public._text_array_is_unique(featured_achievement_ids))
);

alter table public.player_profile_customization enable row level security;
revoke all on public.player_profile_customization from anon, authenticated;
grant all on public.player_profile_customization to service_role;
comment on table public.player_profile_customization is
  'Fase 31 · vitrina (3 instancias reales de user_cards, slot 1 = destacada) y 3 logros destacados. Solo servidor.';

-- Guardar. `p_showcase` / `p_featured` a NULL = no tocar ese campo. Códigos:
--   SAVED (version+1) · UNCHANGED (mismo contenido: idempotente, versión intacta) ·
--   CONFLICT (versión esperada vieja: otra pestaña guardó antes; devuelve la actual) ·
--   TOO_MANY · DUPLICATE · NOT_OWNED (alguna carta no es del jugador) · LOCKED (logro no conseguido) · BAD_USER
create or replace function public.player_profile_set(
  p_user uuid, p_showcase uuid[], p_featured text[], p_expected_version int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cur    public.player_profile_customization%rowtype;
  v_show uuid[];
  v_feat text[];
  n      int;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('code', 'BAD_USER');
  end if;

  insert into public.player_profile_customization (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into cur from public.player_profile_customization where user_id = p_user for update;

  v_show := coalesce(p_showcase, cur.showcase_card_uids);
  v_feat := coalesce(p_featured, cur.featured_achievement_ids);

  if coalesce(cardinality(v_show), 0) > 3 or coalesce(cardinality(v_feat), 0) > 3 then
    return jsonb_build_object('code', 'TOO_MANY');
  end if;
  if array_position(v_show, null) is not null or not public._uuid_array_is_unique(v_show)
     or array_position(v_feat, null) is not null or not public._text_array_is_unique(v_feat) then
    return jsonb_build_object('code', 'DUPLICATE');
  end if;

  -- Propiedad, dentro de la transacción: TODAS las instancias deben ser del jugador ahora mismo.
  if p_showcase is not null and coalesce(cardinality(v_show), 0) > 0 then
    select count(*) into n from public.user_cards where user_id = p_user and uid = any (v_show);
    if n <> cardinality(v_show) then return jsonb_build_object('code', 'NOT_OWNED'); end if;
  end if;

  -- Logros: solo los RECLAMADOS (la fila existe en user_achievements).
  if p_featured is not null and coalesce(cardinality(v_feat), 0) > 0 then
    select count(*) into n from public.user_achievements where user_id = p_user and achievement_id = any (v_feat);
    if n <> cardinality(v_feat) then return jsonb_build_object('code', 'LOCKED'); end if;
  end if;

  if v_show = cur.showcase_card_uids and v_feat = cur.featured_achievement_ids then
    return jsonb_build_object('code', 'UNCHANGED', 'version', cur.version);
  end if;

  if p_expected_version is not null and p_expected_version <> cur.version then
    return jsonb_build_object('code', 'CONFLICT', 'version', cur.version);
  end if;

  update public.player_profile_customization
     set showcase_card_uids = v_show, featured_achievement_ids = v_feat,
         version = cur.version + 1, updated_at = now()
   where user_id = p_user;

  return jsonb_build_object('code', 'SAVED', 'version', cur.version + 1);
end $$;

revoke all on function public.player_profile_set(uuid, uuid[], text[], int) from public, anon, authenticated;
grant execute on function public.player_profile_set(uuid, uuid[], text[], int) to service_role;

-- FASE 35.1 · Los privilegios por defecto de `public` dan EXECUTE a anon/authenticated en toda función
-- nueva. Los dos ayudantes son puros, pero no tienen por qué ser RPC públicas.
revoke all on function public._uuid_array_is_unique(uuid[]) from public, anon, authenticated;
revoke all on function public._text_array_is_unique(text[]) from public, anon, authenticated;
grant execute on function public._uuid_array_is_unique(uuid[]) to service_role;
grant execute on function public._text_array_is_unique(text[]) to service_role;
