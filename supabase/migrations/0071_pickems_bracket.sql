-- ============================================================================================================
-- 0071 · PICK'EMS 2.0 — CUADROS INTERACTIVOS, CIERRE POR PARTIDO, LIQUIDACIÓN Y RECOMPENSAS (F87).
--
-- No es un segundo Pick'em: cuelga de los MISMOS datos reales (events/stages/matches/teams y las aristas de 0045)
-- y del mismo hub /pickems. Lo que añade es lo que el modelo de 0012 no puede expresar: predecir partidos cuyos
-- equipos aún están «por definir», propagando ganadores y perdedores por el cuadro DEL JUGADOR.
--
-- POR QUÉ TABLAS PROPIAS Y NO `pickem_answers`
--   El worker de producción (bundle congelado de F24.8) ejecuta `app_score_pickem_event` cada 2 min y, por cada
--   Pick'em de 0012, PAGA escalones de créditos y sobres automáticamente (`pickem:<evento>:<escalón>`). Si los picks
--   de cuadro vivieran en `pickem_answers`, ese worker los puntuaría y pagaría sin liquidación, sin congelación y sin
--   la aprobación económica que exige F87. Aquí nada se paga solo: solo un reclamo explícito sobre un ámbito LIQUIDADO.
--
--   1. pickem_brackets         un ámbito (una o varias fases de un evento real): descriptor de formato congelado al
--                              publicar (grafo, puntos, versión), política de cierre, recompensas versionadas.
--   2. pickem_bracket_matches  un nodo por partido REAL del ámbito: cierre congelado (`lock_at` = hora de inicio al
--                              publicar), anulación (VOID) y reprogramación auditadas.
--   3. pickem_bracket_entries  una fila por jugador y ámbito: `revision` (pestañas/dispositivos) + foto de liquidación.
--   4. pickem_bracket_picks    matchId → teamId del JUGADOR. Nunca se escribe sobre `matches`.
--   5. pickem_bracket_claims   un reclamo por jugador y ámbito (PK) — exactamente una vez, con su asiento en el libro.
--
-- INVARIANTES
--   · El CIERRE lo decide la BD (`now()`): cerrado si el partido real no está «upcoming», si llega su hora
--     (min(lock_at congelado, start_time actual) — una reprogramación a MÁS TARDE no reabre), si está anulado o si
--     el ámbito no está publicado. Reabrir = `lock_override_at`, solo por RPC de admin, auditado.
--   · Un pick cerrado no cambia (guardia en la tabla, además de la RPC).
--   · Descriptor, puntos, formato y política se congelan al publicar. Las recompensas, al primer cierre.
--   · Liquidar exige todos los partidos puntuables DECIDIDOS (finalizados con ganador real) o anulados, y 12 h de
--     estabilidad desde el inicio del último. La puntuación se calcula AQUÍ (acierto = pick = ganador real).
--   · Reclamar exige ámbito LIQUIDADO + recompensas ACTIVAS + escalón ganado; paga por `app_grant_reward` (la ruta
--     única de 0018) con clave `pickem_bracket:<ámbito>` — índice único del libro + PK del reclamo.
--   · Todo es SECURITY DEFINER y solo lo ejecuta service_role. RLS sin políticas: nada se lee por REST.
--
-- Rollback: docs/operations/rollback/0071_pickems_bracket.ROLLBACK.sql
-- ============================================================================================================

-- ── 1. ámbitos ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pickem_brackets (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 64),
  event_id             text not null references public.events(id) on delete restrict,
  title                text not null check (char_length(btrim(title)) between 3 and 80),
  status               text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'SETTLED', 'CANCELLED')),
  format_kind          text not null check (format_kind in ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'GSL_GROUPS', 'ROUND_ROBIN')),
  format_version       int  not null default 1 check (format_version >= 1),
  stage_ids            text[] not null default '{}',
  descriptor           jsonb not null,
  descriptor_checksum  text not null check (descriptor_checksum ~ '^[0-9a-f]{64}$'),
  admin_edges          jsonb not null default '[]'::jsonb,
  scoring_version      text not null default 'pickem-scoring-v1',
  max_points           int  not null check (max_points > 0),
  lock_policy          text not null default 'MATCH' check (lock_policy in ('MATCH', 'STAGE')),
  stage_lock_at        timestamptz,
  rewards              jsonb not null default '{"version":1,"status":"OFF","minCompletion":0.8,"tiers":[]}'::jsonb,
  rewards_status       text not null default 'OFF' check (rewards_status in ('OFF', 'DRAFT', 'ACTIVE')),
  rewards_version      int  not null default 1,
  rewards_checksum     text,
  version              int  not null default 1,
  settlement_version   int  not null default 0,
  published_at         timestamptz,
  settled_at           timestamptz,
  cancelled_at         timestamptz,
  created_by           uuid references auth.users(id) on delete set null,
  updated_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint pickem_brackets_rewards_status_sync check ((rewards->>'status') = rewards_status)
);
create index if not exists pickem_brackets_event_idx on public.pickem_brackets (event_id);
create index if not exists pickem_brackets_status_idx on public.pickem_brackets (status);

-- ── 2. nodos (partidos reales del ámbito) ───────────────────────────────────────────────────────────────────
-- Sin FK a matches: la identidad del partido se congela; si la fuente lo borrara, el validador lo detecta (y el
-- partido queda CERRADO: un nodo sin fila real nunca está abierto). Nunca se remapea un pick a otro partido.
create table if not exists public.pickem_bracket_matches (
  bracket_id        uuid not null references public.pickem_brackets(id) on delete cascade,
  match_id          text not null,
  points            int  not null check (points > 0),
  lock_at           timestamptz not null,
  lock_override_at  timestamptz,
  voided_at         timestamptz,
  void_reason       text check (void_reason is null or char_length(void_reason) between 8 and 300),
  voided_by         uuid references auth.users(id) on delete set null,
  primary key (bracket_id, match_id)
);
create index if not exists pickem_bracket_matches_match_idx on public.pickem_bracket_matches (match_id);

-- ── 3. participación ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pickem_bracket_entries (
  bracket_id        uuid not null references public.pickem_brackets(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  revision          int  not null default 0 check (revision >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  final_points      int,
  final_correct     int,
  final_wrong       int,
  final_missed      int,
  final_void        int,
  final_completion  numeric(6,5),
  final_ratio       numeric(6,5),
  final_perfect     boolean,
  final_tier        text check (final_tier is null or final_tier in ('PARTICIPATION', 'GOOD', 'GREAT', 'ELITE', 'PERFECT')),
  final_position    int,
  settled_version   int,
  primary key (bracket_id, user_id)
);
create index if not exists pickem_bracket_entries_user_idx on public.pickem_bracket_entries (user_id);

create table if not exists public.pickem_bracket_picks (
  bracket_id  uuid not null,
  user_id     uuid not null,
  match_id    text not null,
  team_id     text not null references public.teams(id),
  picked_at   timestamptz not null default now(),
  primary key (bracket_id, user_id, match_id),
  foreign key (bracket_id, user_id) references public.pickem_bracket_entries(bracket_id, user_id) on delete cascade,
  foreign key (bracket_id, match_id) references public.pickem_bracket_matches(bracket_id, match_id) on delete cascade
);

create table if not exists public.pickem_bracket_claims (
  bracket_id          uuid not null references public.pickem_brackets(id) on delete restrict,
  user_id             uuid not null references auth.users(id) on delete cascade,
  tier                text not null check (tier in ('PARTICIPATION', 'GOOD', 'GREAT', 'ELITE', 'PERFECT')),
  reward              jsonb not null,
  ref                 text not null,
  rewards_version     int  not null,
  settlement_version  int  not null,
  claimed_at          timestamptz not null default now(),
  primary key (bracket_id, user_id)
);

alter table public.pickem_brackets         enable row level security;
alter table public.pickem_bracket_matches  enable row level security;
alter table public.pickem_bracket_entries  enable row level security;
alter table public.pickem_bracket_picks    enable row level security;
alter table public.pickem_bracket_claims   enable row level security;
revoke all on table public.pickem_brackets, public.pickem_bracket_matches, public.pickem_bracket_entries,
                    public.pickem_bracket_picks, public.pickem_bracket_claims from public, anon, authenticated;
grant select on table public.pickem_brackets, public.pickem_bracket_matches, public.pickem_bracket_entries,
                      public.pickem_bracket_picks, public.pickem_bracket_claims to service_role;

-- ── 4. el cierre (reloj de la BD) ───────────────────────────────────────────────────────────────────────────
create or replace function public.pickem_match_locked(p_bracket uuid, p_match text, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select b.status <> 'PUBLISHED'
        or bm.voided_at is not null
        or m.id is null
        or lower(coalesce(m.status, 'upcoming')) <> 'upcoming'
        or (b.lock_policy = 'STAGE' and b.stage_lock_at is not null and p_at >= b.stage_lock_at)
        or p_at >= (case when bm.lock_override_at is not null then least(bm.lock_override_at, m.start_time)
                         else least(bm.lock_at, m.start_time) end)
      from public.pickem_bracket_matches bm
      join public.pickem_brackets b on b.id = bm.bracket_id
      left join public.matches m on m.id = bm.match_id
     where bm.bracket_id = p_bracket and bm.match_id = p_match), true);
$$;

-- ── 5. guardias ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._pickem_brackets_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then raise exception 'PICKEM_FROZEN: solo se borran borradores' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status <> 'DRAFT' and (
       new.descriptor is distinct from old.descriptor or new.descriptor_checksum is distinct from old.descriptor_checksum
    or new.admin_edges is distinct from old.admin_edges or new.format_kind is distinct from old.format_kind
    or new.format_version is distinct from old.format_version or new.stage_ids is distinct from old.stage_ids
    or new.event_id is distinct from old.event_id or new.slug is distinct from old.slug
    or new.scoring_version is distinct from old.scoring_version or new.max_points is distinct from old.max_points
    or new.lock_policy is distinct from old.lock_policy or new.stage_lock_at is distinct from old.stage_lock_at) then
    if not (old.status = 'PUBLISHED' and new.status = 'DRAFT') then
      raise exception 'PICKEM_FROZEN: el formato y la puntuación se congelan al publicar' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'DRAFT' and new.status in ('PUBLISHED', 'CANCELLED'))
    or (old.status = 'PUBLISHED' and new.status in ('DRAFT', 'SETTLED', 'CANCELLED'))) then
    raise exception 'PICKEM_BAD_TRANSITION: % → %', old.status, new.status using errcode = '42501';
  end if;
  if old.status = 'PUBLISHED' and new.status = 'DRAFT'
     and exists (select 1 from public.pickem_bracket_entries e where e.bracket_id = old.id) then
    raise exception 'PICKEM_HAS_ENTRIES: ya hay jugadores; se cancela, no se despublica' using errcode = '42501';
  end if;
  if new.rewards is distinct from old.rewards or new.rewards_status is distinct from old.rewards_status then
    if old.status in ('SETTLED', 'CANCELLED') then
      raise exception 'PICKEM_REWARDS_FROZEN: ámbito cerrado' using errcode = '42501';
    end if;
    if old.status = 'PUBLISHED' and exists (
         select 1 from public.pickem_bracket_matches bm
          where bm.bracket_id = old.id and public.pickem_match_locked(old.id, bm.match_id, now())) then
      raise exception 'PICKEM_REWARDS_FROZEN: ya se cerró alguna predicción' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists pickem_brackets_guard on public.pickem_brackets;
create trigger pickem_brackets_guard before update or delete on public.pickem_brackets
  for each row execute function public._pickem_brackets_guard();

-- Un pick de un partido cerrado no se crea ni se cambia, venga de donde venga. (El BORRADO no se guarda aquí: la
-- cascada del borrado de una cuenta tiene que poder pasar; la RPC nunca borra picks cerrados.)
create or replace function public._pickem_picks_guard()
returns trigger language plpgsql as $$
begin
  if public.pickem_match_locked(new.bracket_id, new.match_id, now()) then
    raise exception 'PICKEM_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists pickem_picks_guard on public.pickem_bracket_picks;
create trigger pickem_picks_guard before insert or update on public.pickem_bracket_picks
  for each row execute function public._pickem_picks_guard();

-- El cierre congelado y los puntos de un nodo no cambian nunca (reabrir = `lock_override_at`, auditado por RPC).
create or replace function public._pickem_nodes_guard()
returns trigger language plpgsql as $$
begin
  if new.lock_at is distinct from old.lock_at or new.points is distinct from old.points
     or new.match_id is distinct from old.match_id or new.bracket_id is distinct from old.bracket_id then
    raise exception 'PICKEM_FROZEN: cierre y puntos del partido congelados' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists pickem_nodes_guard on public.pickem_bracket_matches;
create trigger pickem_nodes_guard before update on public.pickem_bracket_matches
  for each row execute function public._pickem_nodes_guard();

-- Las fotos de liquidación solo las escribe la liquidación; los reclamos no se editan.
create or replace function public._pickem_claims_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then raise exception 'PICKEM_CLAIM_IMMUTABLE' using errcode = '42501'; end if;
  return old;
end; $$;
drop trigger if exists pickem_claims_guard on public.pickem_bracket_claims;
create trigger pickem_claims_guard before update on public.pickem_bracket_claims
  for each row execute function public._pickem_claims_guard();

-- ── 6. utilidades internas ──────────────────────────────────────────────────────────────────────────────────
create or replace function public._pickem_require_admin(p_actor uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
end; $$;

create or replace function public._pickem_audit(p_actor uuid, p_action text, p_bracket uuid, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, p_action, 'pickem_bracket', p_bracket::text, coalesce(p_detail, '{}'::jsonb));
$$;

/** Escalón ganado (espejo exacto de `tierFor` en domain/pickems/bracketRewards.ts). */
create or replace function public._pickem_tier(p_rewards jsonb, p_completion numeric, p_ratio numeric, p_perfect boolean)
returns text language plpgsql immutable as $$
declare
  v_min  numeric := coalesce((p_rewards->>'minCompletion')::numeric, 0.8);
  v_tier text := null;
  v_id   text;
  v_r    numeric;
begin
  if p_completion < v_min then return null; end if;
  if p_perfect and exists (select 1 from jsonb_array_elements(coalesce(p_rewards->'tiers', '[]'::jsonb)) t where t->>'id' = 'PERFECT') then
    return 'PERFECT';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_rewards->'tiers', '[]'::jsonb)) t where t->>'id' = 'PARTICIPATION') then
    v_tier := 'PARTICIPATION';
  end if;
  foreach v_id in array array['GOOD', 'GREAT', 'ELITE'] loop
    select (t->>'minRatio')::numeric into v_r
      from jsonb_array_elements(coalesce(p_rewards->'tiers', '[]'::jsonb)) t
     where t->>'id' = v_id and jsonb_typeof(t->'minRatio') = 'number' limit 1;
    if v_r is not null and p_ratio >= v_r then v_tier := v_id; end if;
    v_r := null;
  end loop;
  return v_tier;
end; $$;

-- ── 7. jugador: guardar un pick ─────────────────────────────────────────────────────────────────────────────
-- El SERVIDOR (Node) ya validó que `p_team` es uno de los dos participantes predichos de ese partido para ESTE
-- jugador con su `revision` actual, y calculó qué descendientes quedan incompatibles (`p_clear`). Aquí: estado del
-- ámbito, versión (pestañas/dispositivos), cierre con el reloj de la BD, equipo real, y la escritura atómica.
create or replace function public.app_pickem_save_pick(
  p_user uuid, p_bracket uuid, p_match text, p_team text, p_expected_revision int, p_clear text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_rev     int;
  v_id      text;
  v_cleared text[] := '{}';
begin
  select status into v_status from public.pickem_brackets where id = p_bracket;
  if v_status is null then raise exception 'PICKEM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_status <> 'PUBLISHED' then raise exception 'PICKEM_NOT_OPEN' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.pickem_bracket_matches where bracket_id = p_bracket and match_id = p_match) then
    raise exception 'PICKEM_BAD_MATCH' using errcode = 'P0001';
  end if;

  insert into public.pickem_bracket_entries (bracket_id, user_id) values (p_bracket, p_user) on conflict do nothing;
  select revision into v_rev from public.pickem_bracket_entries where bracket_id = p_bracket and user_id = p_user for update;
  if p_expected_revision is not null and v_rev <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'STALE', 'revision', v_rev);
  end if;

  if public.pickem_match_locked(p_bracket, p_match, now()) then raise exception 'PICKEM_LOCKED' using errcode = 'P0001'; end if;
  if p_team is not null and (p_team ~* '(^|-)tbd$' or not exists (select 1 from public.teams where id = p_team)) then
    raise exception 'PICKEM_BAD_TEAM' using errcode = 'P0001';
  end if;

  foreach v_id in array coalesce(p_clear, '{}') loop
    if v_id = p_match then continue; end if;
    if not exists (select 1 from public.pickem_bracket_matches where bracket_id = p_bracket and match_id = v_id) then
      raise exception 'PICKEM_BAD_MATCH' using errcode = 'P0001';
    end if;
    -- Un descendiente ya cerrado se conserva (es historia: se puntuará como fallo).
    if public.pickem_match_locked(p_bracket, v_id, now()) then continue; end if;
    delete from public.pickem_bracket_picks where bracket_id = p_bracket and user_id = p_user and match_id = v_id;
    if found then v_cleared := v_cleared || v_id; end if;
  end loop;

  if p_team is null then
    delete from public.pickem_bracket_picks where bracket_id = p_bracket and user_id = p_user and match_id = p_match;
  else
    insert into public.pickem_bracket_picks (bracket_id, user_id, match_id, team_id)
    values (p_bracket, p_user, p_match, p_team)
    on conflict (bracket_id, user_id, match_id) do update set team_id = excluded.team_id, picked_at = now();
  end if;

  update public.pickem_bracket_entries set revision = revision + 1, updated_at = now()
   where bracket_id = p_bracket and user_id = p_user returning revision into v_rev;
  return jsonb_build_object('ok', true, 'revision', v_rev, 'cleared', to_jsonb(v_cleared));
end; $$;

-- ── 8. jugador: reclamar la recompensa (exactamente una vez) ────────────────────────────────────────────────
create or replace function public.app_pickem_claim(p_user uuid, p_bracket uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_b      public.pickem_brackets;
  v_tier   text;
  v_claim  public.pickem_bracket_claims;
  v_reward jsonb;
  v_ref    text;
  v_grant  jsonb;
begin
  select * into v_b from public.pickem_brackets where id = p_bracket;
  if v_b.id is null then raise exception 'PICKEM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.status <> 'SETTLED' then raise exception 'PICKEM_NOT_SETTLED' using errcode = 'P0001'; end if;
  if v_b.rewards_status <> 'ACTIVE' then raise exception 'PICKEM_NO_REWARDS' using errcode = 'P0001'; end if;

  -- Serializa pestañas, dispositivos y reintentos del mismo jugador.
  select final_tier into v_tier from public.pickem_bracket_entries
   where bracket_id = p_bracket and user_id = p_user for update;
  if v_tier is null then raise exception 'PICKEM_NOT_ELIGIBLE' using errcode = 'P0001'; end if;

  select * into v_claim from public.pickem_bracket_claims where bracket_id = p_bracket and user_id = p_user;
  if v_claim.bracket_id is not null then
    return jsonb_build_object('applied', false, 'tier', v_claim.tier, 'reward', v_claim.reward, 'claimedAt', v_claim.claimed_at);
  end if;

  select t->'reward' into v_reward from jsonb_array_elements(v_b.rewards->'tiers') t where t->>'id' = v_tier limit 1;
  if v_reward is null then raise exception 'PICKEM_TIER_MISSING' using errcode = 'P0001'; end if;
  v_ref := 'pickem_bracket:' || p_bracket::text;

  insert into public.pickem_bracket_claims (bracket_id, user_id, tier, reward, ref, rewards_version, settlement_version)
  values (p_bracket, p_user, v_tier, v_reward, v_ref, v_b.rewards_version, v_b.settlement_version);

  v_grant := public.app_grant_reward(
    p_user       => p_user,
    p_ref        => v_ref,
    p_reason     => 'pickem_bracket_reward:' || lower(v_tier),
    p_credits    => coalesce((v_reward->>'credits')::bigint, 0),
    p_pack_id    => nullif(v_reward->>'packId', ''),
    p_pack_count => coalesce((v_reward->>'packCount')::int, case when nullif(v_reward->>'packId', '') is not null then 1 else 0 end),
    p_card_ids   => case when jsonb_array_length(coalesce(v_reward->'cardIds', '[]'::jsonb)) > 0
                         then array(select jsonb_array_elements_text(v_reward->'cardIds')) end,
    p_cosmetics  => case when jsonb_array_length(coalesce(v_reward->'cosmetics', '[]'::jsonb)) > 0
                         then array(select jsonb_array_elements_text(v_reward->'cosmetics')) end);
  if coalesce((v_grant->>'applied')::boolean, false) is not true then
    -- El libro ya tenía esta clave sin reclamo: estado imposible por construcción; se aborta todo.
    raise exception 'PICKEM_LEDGER_CONFLICT' using errcode = 'P0001';
  end if;
  return jsonb_build_object('applied', true, 'tier', v_tier, 'reward', v_reward, 'grant', v_grant);
end; $$;

-- ── 9. admin: borrador ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.app_pickem_admin_save_draft(
  p_actor uuid, p_id uuid, p_slug text, p_event text, p_title text, p_kind text, p_stage_ids text[],
  p_descriptor jsonb, p_checksum text, p_admin_edges jsonb, p_max_points int, p_lock_policy text, p_expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.pickem_brackets;
begin
  perform public._pickem_require_admin(p_actor);
  if p_id is null then
    insert into public.pickem_brackets (slug, event_id, title, format_kind, stage_ids, descriptor, descriptor_checksum,
                                        admin_edges, max_points, lock_policy, created_by, updated_by)
    values (p_slug, p_event, p_title, p_kind, coalesce(p_stage_ids, '{}'), p_descriptor, p_checksum,
            coalesce(p_admin_edges, '[]'::jsonb), p_max_points, coalesce(p_lock_policy, 'MATCH'), p_actor, p_actor)
    returning * into v_row;
    perform public._pickem_audit(p_actor, 'pickem_draft_create', v_row.id, jsonb_build_object('slug', p_slug, 'event', p_event, 'kind', p_kind, 'checksum', p_checksum));
  else
    update public.pickem_brackets
       set slug = p_slug, title = p_title, format_kind = p_kind, stage_ids = coalesce(p_stage_ids, '{}'),
           descriptor = p_descriptor, descriptor_checksum = p_checksum, admin_edges = coalesce(p_admin_edges, '[]'::jsonb),
           max_points = p_max_points, lock_policy = coalesce(p_lock_policy, 'MATCH'), version = version + 1, updated_by = p_actor
     where id = p_id and status = 'DRAFT' and version = p_expected_version and event_id = p_event
    returning * into v_row;
    if v_row.id is null then raise exception 'PICKEM_STALE_OR_FROZEN' using errcode = 'P0001'; end if;
    perform public._pickem_audit(p_actor, 'pickem_draft_update', v_row.id, jsonb_build_object('version', v_row.version, 'checksum', p_checksum, 'adminEdges', jsonb_array_length(coalesce(p_admin_edges, '[]'::jsonb))));
  end if;
  return jsonb_build_object('id', v_row.id, 'version', v_row.version);
end; $$;

-- ── 10. admin: publicar / despublicar / cancelar / borrar borrador ──────────────────────────────────────────
create or replace function public.app_pickem_admin_set_status(
  p_actor uuid, p_id uuid, p_action text, p_expected_version int, p_checksum text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_b public.pickem_brackets;
  v_n int;
  v_nodes int;
begin
  perform public._pickem_require_admin(p_actor);
  select * into v_b from public.pickem_brackets where id = p_id for update;
  if v_b.id is null then raise exception 'PICKEM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.version <> p_expected_version then raise exception 'PICKEM_STALE' using errcode = 'P0001'; end if;

  if p_action = 'publish' then
    if v_b.status <> 'DRAFT' then raise exception 'PICKEM_BAD_STATE' using errcode = 'P0001'; end if;
    if p_checksum is distinct from v_b.descriptor_checksum then raise exception 'PICKEM_CHECKSUM' using errcode = 'P0001'; end if;
    v_nodes := jsonb_array_length(v_b.descriptor->'nodes');
    insert into public.pickem_bracket_matches (bracket_id, match_id, points, lock_at)
    select p_id, n->>'matchId', (n->>'points')::int, m.start_time
      from jsonb_array_elements(v_b.descriptor->'nodes') n
      join public.matches m on m.id = n->>'matchId' and m.event_id = v_b.event_id and m.start_time is not null;
    get diagnostics v_n = row_count;
    if v_n <> v_nodes or v_n = 0 then raise exception 'PICKEM_MATCH_MISSING: % de % partidos', v_n, v_nodes using errcode = 'P0001'; end if;
    update public.pickem_brackets
       set status = 'PUBLISHED', published_at = now(), version = version + 1, updated_by = p_actor,
           stage_lock_at = case when lock_policy = 'STAGE'
                                then (select min(lock_at) from public.pickem_bracket_matches where bracket_id = p_id) end
     where id = p_id;
    perform public._pickem_audit(p_actor, 'pickem_publish', p_id, jsonb_build_object('checksum', v_b.descriptor_checksum, 'nodes', v_n, 'rewardsStatus', v_b.rewards_status));
  elsif p_action = 'unpublish' then
    if v_b.status <> 'PUBLISHED' then raise exception 'PICKEM_BAD_STATE' using errcode = 'P0001'; end if;
    update public.pickem_brackets set status = 'DRAFT', published_at = null, stage_lock_at = null, version = version + 1, updated_by = p_actor where id = p_id;
    delete from public.pickem_bracket_matches where bracket_id = p_id;
    perform public._pickem_audit(p_actor, 'pickem_unpublish', p_id, jsonb_build_object('reason', p_reason));
  elsif p_action = 'cancel' then
    if coalesce(char_length(btrim(p_reason)), 0) < 8 then raise exception 'PICKEM_REASON_REQUIRED' using errcode = 'P0001'; end if;
    update public.pickem_brackets set status = 'CANCELLED', cancelled_at = now(), version = version + 1, updated_by = p_actor where id = p_id;
    perform public._pickem_audit(p_actor, 'pickem_cancel', p_id, jsonb_build_object('reason', p_reason, 'from', v_b.status));
  elsif p_action = 'delete' then
    delete from public.pickem_brackets where id = p_id;
    perform public._pickem_audit(p_actor, 'pickem_draft_delete', p_id, jsonb_build_object('slug', v_b.slug));
    return jsonb_build_object('id', p_id, 'deleted', true);
  else
    raise exception 'PICKEM_BAD_ACTION' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', p_id, 'status', (select status from public.pickem_brackets where id = p_id), 'version', (select version from public.pickem_brackets where id = p_id));
end; $$;

-- ── 11. admin: recompensas (versionadas; congeladas al primer cierre) ───────────────────────────────────────
create or replace function public.app_pickem_admin_set_rewards(
  p_actor uuid, p_id uuid, p_rewards jsonb, p_status text, p_checksum text, p_expected_rewards_version int, p_ack_liability boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.pickem_brackets; v_new jsonb;
begin
  perform public._pickem_require_admin(p_actor);
  select * into v_b from public.pickem_brackets where id = p_id for update;
  if v_b.id is null then raise exception 'PICKEM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.rewards_version <> p_expected_rewards_version then raise exception 'PICKEM_STALE' using errcode = 'P0001'; end if;
  if p_status not in ('OFF', 'DRAFT', 'ACTIVE') then raise exception 'PICKEM_BAD_REWARDS_STATUS' using errcode = 'P0001'; end if;
  if p_status = 'ACTIVE' and (not coalesce(p_ack_liability, false) or jsonb_array_length(coalesce(p_rewards->'tiers', '[]'::jsonb)) = 0) then
    raise exception 'PICKEM_ACTIVATION_REQUIRES_ACK' using errcode = 'P0001';
  end if;
  v_new := jsonb_set(jsonb_set(coalesce(p_rewards, '{}'::jsonb), '{status}', to_jsonb(p_status)), '{version}', to_jsonb(v_b.rewards_version + 1));
  update public.pickem_brackets
     set rewards = v_new, rewards_status = p_status, rewards_version = rewards_version + 1, rewards_checksum = p_checksum, updated_by = p_actor
   where id = p_id;
  perform public._pickem_audit(p_actor, case when p_status = 'ACTIVE' then 'pickem_rewards_activate' else 'pickem_rewards_set' end, p_id,
    jsonb_build_object('before', v_b.rewards, 'after', v_new, 'checksum', p_checksum));
  return jsonb_build_object('id', p_id, 'rewardsVersion', v_b.rewards_version + 1, 'rewardsStatus', p_status);
end; $$;

-- ── 12. admin: cierre manual, reprogramación auditada y anulación (VOID) ────────────────────────────────────
create or replace function public.app_pickem_admin_match(
  p_actor uuid, p_id uuid, p_match text, p_action text, p_until timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.pickem_brackets; v_bm public.pickem_bracket_matches; v_m record;
begin
  perform public._pickem_require_admin(p_actor);
  if coalesce(char_length(btrim(p_reason)), 0) < 8 then raise exception 'PICKEM_REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v_b from public.pickem_brackets where id = p_id for update;
  if v_b.id is null then raise exception 'PICKEM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.status <> 'PUBLISHED' then raise exception 'PICKEM_BAD_STATE' using errcode = 'P0001'; end if;
  select * into v_bm from public.pickem_bracket_matches where bracket_id = p_id and match_id = p_match for update;
  if v_bm.match_id is null then raise exception 'PICKEM_BAD_MATCH' using errcode = 'P0001'; end if;
  select status, start_time, winner_team_id into v_m from public.matches where id = p_match;

  if p_action = 'lock_now' then
    update public.pickem_bracket_matches set lock_override_at = now() where bracket_id = p_id and match_id = p_match;
  elsif p_action = 'reschedule' then
    -- Reabrir/reprogramar solo si el partido REAL no ha empezado. Nunca más tarde que su hora real actual.
    if p_until is null or p_until <= now() then raise exception 'PICKEM_BAD_TIME' using errcode = 'P0001'; end if;
    if lower(coalesce(v_m.status, '')) <> 'upcoming' or v_m.winner_team_id is not null then raise exception 'PICKEM_MATCH_STARTED' using errcode = 'P0001'; end if;
    update public.pickem_bracket_matches set lock_override_at = p_until where bracket_id = p_id and match_id = p_match;
  elsif p_action = 'void' then
    update public.pickem_bracket_matches set voided_at = now(), void_reason = p_reason, voided_by = p_actor where bracket_id = p_id and match_id = p_match;
  elsif p_action = 'unvoid' then
    update public.pickem_bracket_matches set voided_at = null, void_reason = null, voided_by = null where bracket_id = p_id and match_id = p_match;
  else
    raise exception 'PICKEM_BAD_ACTION' using errcode = 'P0001';
  end if;
  perform public._pickem_audit(p_actor, 'pickem_match_' || p_action, p_id,
    jsonb_build_object('match', p_match, 'until', p_until, 'reason', p_reason, 'before', to_jsonb(v_bm), 'realStatus', v_m.status, 'realStart', v_m.start_time));
  return jsonb_build_object('id', p_id, 'match', p_match, 'action', p_action);
end; $$;

-- ── 13. admin: liquidar (la puntuación se calcula AQUÍ) ─────────────────────────────────────────────────────
create or replace function public.app_pickem_admin_settle(p_actor uuid, p_id uuid, p_expected_settlement int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_b         public.pickem_brackets;
  v_pending   int;
  v_scorable  int;
  v_void      int;
  v_maxp      int;
  v_last      timestamptz;
  v_users     int;
  v_version   int;
begin
  perform public._pickem_require_admin(p_actor);
  select * into v_b from public.pickem_brackets where id = p_id for update;
  if v_b.id is null then raise exception 'PICKEM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.status not in ('PUBLISHED', 'SETTLED') then raise exception 'PICKEM_BAD_STATE' using errcode = 'P0001'; end if;
  if v_b.settlement_version <> p_expected_settlement then raise exception 'PICKEM_STALE' using errcode = 'P0001'; end if;
  if v_b.status = 'SETTLED' and coalesce(char_length(btrim(p_reason)), 0) < 8 then raise exception 'PICKEM_REASON_REQUIRED' using errcode = 'P0001'; end if;

  select count(*) into v_pending
    from public.pickem_bracket_matches bm left join public.matches m on m.id = bm.match_id
   where bm.bracket_id = p_id and bm.voided_at is null
     and not (m.id is not null and lower(m.status) in ('finished', 'completed')
              and m.winner_team_id is not null and m.winner_team_id in (m.team_a_id, m.team_b_id));
  if v_pending > 0 then raise exception 'PICKEM_NOT_DECIDED: % partido(s) sin resultado definitivo', v_pending using errcode = 'P0001'; end if;

  select max(m.start_time) into v_last
    from public.pickem_bracket_matches bm join public.matches m on m.id = bm.match_id where bm.bracket_id = p_id;
  if v_last is not null and now() < v_last + interval '12 hours' then
    raise exception 'PICKEM_NOT_STABLE: espera 12 h desde el último partido' using errcode = 'P0001';
  end if;

  select count(*) filter (where voided_at is null), count(*) filter (where voided_at is not null), coalesce(sum(points) filter (where voided_at is null), 0)
    into v_scorable, v_void, v_maxp
    from public.pickem_bracket_matches where bracket_id = p_id;
  if v_scorable = 0 or v_maxp = 0 then raise exception 'PICKEM_NOTHING_TO_SCORE' using errcode = 'P0001'; end if;
  v_version := v_b.settlement_version + 1;

  with sc as (
    select e.user_id,
           count(p.match_id) filter (where bm.voided_at is null)                                         as picked,
           count(p.match_id) filter (where bm.voided_at is null and p.team_id = m.winner_team_id)         as correct,
           coalesce(sum(bm.points) filter (where bm.voided_at is null and p.team_id = m.winner_team_id), 0) as pts
      from public.pickem_bracket_entries e
      left join public.pickem_bracket_picks p on p.bracket_id = e.bracket_id and p.user_id = e.user_id
      left join public.pickem_bracket_matches bm on bm.bracket_id = p.bracket_id and bm.match_id = p.match_id
      left join public.matches m on m.id = p.match_id
     where e.bracket_id = p_id
     group by e.user_id
  ), ranked as (
    select sc.*, rank() over (order by pts desc, correct desc) as pos,
           round(picked::numeric / v_scorable, 5) as completion_r,
           picked::numeric / v_scorable as completion,
           pts::numeric / v_maxp as ratio
      from sc
  )
  update public.pickem_bracket_entries e
     set final_points = r.pts, final_correct = r.correct, final_wrong = r.picked - r.correct,
         final_missed = v_scorable - r.picked, final_void = v_void,
         final_completion = r.completion_r, final_ratio = round(r.ratio, 5),
         final_perfect = (r.correct = v_scorable),
         final_tier = public._pickem_tier(v_b.rewards, r.completion, r.ratio, r.correct = v_scorable),
         final_position = r.pos, settled_version = v_version
    from ranked r
   where e.bracket_id = p_id and e.user_id = r.user_id;
  get diagnostics v_users = row_count;

  update public.pickem_brackets
     set status = 'SETTLED', settled_at = now(), settlement_version = v_version, updated_by = p_actor
   where id = p_id;
  perform public._pickem_audit(p_actor, case when v_b.status = 'SETTLED' then 'pickem_resettle' else 'pickem_settle' end, p_id,
    jsonb_build_object('settlementVersion', v_version, 'users', v_users, 'scorable', v_scorable, 'void', v_void, 'maxPoints', v_maxp, 'reason', p_reason,
                       'claimsBefore', (select count(*) from public.pickem_bracket_claims where bracket_id = p_id)));
  return jsonb_build_object('id', p_id, 'settlementVersion', v_version, 'users', v_users, 'scorable', v_scorable, 'maxPoints', v_maxp);
end; $$;

-- ── 14. permisos: nada para el cliente ──────────────────────────────────────────────────────────────────────
revoke all on function public.pickem_match_locked(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._pickem_require_admin(uuid) from public, anon, authenticated;
revoke all on function public._pickem_audit(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._pickem_tier(jsonb, numeric, numeric, boolean) from public, anon, authenticated;
revoke all on function public.app_pickem_save_pick(uuid, uuid, text, text, int, text[]) from public, anon, authenticated;
revoke all on function public.app_pickem_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.app_pickem_admin_save_draft(uuid, uuid, text, text, text, text, text[], jsonb, text, jsonb, int, text, int) from public, anon, authenticated;
revoke all on function public.app_pickem_admin_set_status(uuid, uuid, text, int, text, text) from public, anon, authenticated;
revoke all on function public.app_pickem_admin_set_rewards(uuid, uuid, jsonb, text, text, int, boolean) from public, anon, authenticated;
revoke all on function public.app_pickem_admin_match(uuid, uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.app_pickem_admin_settle(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function public.pickem_match_locked(uuid, text, timestamptz) to service_role;
grant execute on function public.app_pickem_save_pick(uuid, uuid, text, text, int, text[]) to service_role;
grant execute on function public.app_pickem_claim(uuid, uuid) to service_role;
grant execute on function public.app_pickem_admin_save_draft(uuid, uuid, text, text, text, text, text[], jsonb, text, jsonb, int, text, int) to service_role;
grant execute on function public.app_pickem_admin_set_status(uuid, uuid, text, int, text, text) to service_role;
grant execute on function public.app_pickem_admin_set_rewards(uuid, uuid, jsonb, text, text, int, boolean) to service_role;
grant execute on function public.app_pickem_admin_match(uuid, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.app_pickem_admin_settle(uuid, uuid, int, text) to service_role;

-- ── 15. guardia final ───────────────────────────────────────────────────────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['pickem_brackets', 'pickem_bracket_matches', 'pickem_bracket_entries', 'pickem_bracket_picks', 'pickem_bracket_claims'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') or has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception '0071: un rol de cliente puede tocar %', t;
    end if;
  end loop;
  foreach f in array array['public.app_pickem_save_pick(uuid, uuid, text, text, int, text[])', 'public.app_pickem_claim(uuid, uuid)',
                           'public.app_pickem_admin_settle(uuid, uuid, int, text)', 'public.app_pickem_admin_set_rewards(uuid, uuid, jsonb, text, text, int, boolean)',
                           'public.pickem_match_locked(uuid, text, timestamptz)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0071: un rol de cliente puede ejecutar %', f;
    end if;
  end loop;
  if to_regprocedure('public.app_grant_reward(uuid, text, text, bigint, integer, bigint, text, integer, integer, text[], text[])') is null
     and to_regprocedure('public.app_grant_reward(uuid, text, text, bigint, integer, text, integer, integer, text[], text[])') is null then
    raise exception '0071: no existe la ruta única de recompensas (app_grant_reward)';
  end if;
end $$;
