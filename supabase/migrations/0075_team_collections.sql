-- ============================================================================================================
-- 0075 · COLECCIONES POR EQUIPO — primera compleción (300 XP de temporada, una vez) e insignias regionales permanentes.
--
-- Contexto: las colecciones por equipo y las insignias regionales se calculan del catálogo publicado y del inventario
-- (`src/domain/teamCollections`). Eso basta para pintar el progreso, pero no para dos cosas que deben durar aunque el
-- inventario cambie:
--
--   1. `user_team_completions`     «completaste este equipo por primera vez». PK (user_id, team_id) = exactamente una
--                                  vez por cuenta y equipo. Guarda si los XP de temporada ya se concedieron, cuántos y
--                                  en qué temporada; `null` = pendientes (no había temporada activa). No se borra al
--                                  desguazar cartas (no hay FK a `user_cards` a propósito).
--   2. `user_region_badges`        «desbloqueaste la insignia de esta región». PK (user_id, region). Permanente.
--   3. `app_team_collections_settle`
--                                  liquidación ATÓMICA e IDEMPOTENTE. El servidor le pasa, calculado del catálogo, qué
--                                  cartas exige cada equipo y cada región; la función comprueba en la MISMA transacción,
--                                  contra `user_cards`, que la cuenta las tiene todas; inserta la compleción, concede
--                                  los XP con `app_season_apply` (0064: su libro tiene clave única por usuario, temporada
--                                  y evento) y desbloquea la insignia regional, que además se concede como cosmético
--                                  `insignia:regional:<región>` en `user_cosmetics` (0016) para poder destacarla en el
--                                  perfil con el mecanismo que ya existe (0062).
--
-- Concurrencia: un cerrojo de transacción por cuenta serializa las liquidaciones de un mismo usuario; las claves
-- primarias y la clave única del libro de XP son la segunda barrera. Dos peticiones a la vez, un reintento o recargar
-- la página dan una compleción, unos XP y una insignia.
--
-- No cambia ninguna tabla, fila, política ni función existente. No toca créditos, sobres, cartas ni inventario: solo
-- LEE `user_cards`. No concede nada por sí sola al aplicarse (no hay backfill): solo liquida cuando el servidor se lo
-- pide para una cuenta concreta.
--
-- Seguridad: RLS activada SIN políticas en las tablas nuevas (solo service_role, como 0062); la función es
-- SECURITY DEFINER con search_path fijo y EXECUTE solo para service_role.
-- Rollback: docs/operations/rollback/0075_team_collections.ROLLBACK.sql
-- ============================================================================================================

-- ── 1. user_team_completions ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_team_completions (
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Clave canónica del equipo (`team-heretics`) o `raw:<texto impreso>` si aún no tiene identidad en el registro.
  team_id       text not null check (length(team_id) between 1 and 64),
  completed_at  timestamptz not null default now(),
  -- Cuántas cartas exigía la colección en ese momento (auditoría; no se recalcula nunca).
  cards         int  not null check (cards >= 1),
  -- XP de temporada de la primera compleción. Los tres a null = pendientes (no había temporada activa).
  xp_amount     int  check (xp_amount is null or (xp_amount >= 0 and xp_amount <= 100000)),
  xp_season_id  text references public.game_seasons(id),
  xp_granted_at timestamptz,
  primary key (user_id, team_id),
  constraint user_team_completions_xp_shape check (
    (xp_granted_at is null and xp_season_id is null and xp_amount is null)
    or (xp_granted_at is not null and xp_season_id is not null and xp_amount is not null)
  )
);

alter table public.user_team_completions enable row level security;
revoke all on public.user_team_completions from public, anon, authenticated;
grant select, insert, update on public.user_team_completions to service_role;
comment on table public.user_team_completions is
  '0075 · primera compleción de la colección de un equipo (una por usuario y equipo) y sus XP de temporada. Permanente. Solo servidor.';

-- ── 2. user_region_badges ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_region_badges (
  user_id     uuid not null references auth.users(id) on delete cascade,
  region      text not null check (region in ('Americas', 'EMEA', 'Pacific', 'China')),
  unlocked_at timestamptz not null default now(),
  -- Equipos y cartas que exigía la región en ese momento (auditoría).
  teams       int  not null check (teams >= 1),
  cards       int  not null check (cards >= 1),
  primary key (user_id, region)
);

alter table public.user_region_badges enable row level security;
revoke all on public.user_region_badges from public, anon, authenticated;
grant select, insert on public.user_region_badges to service_role;
comment on table public.user_region_badges is
  '0075 · insignias regionales desbloqueadas (una por usuario y región). No se pierden al cambiar el inventario. Solo servidor.';

-- ── 3. app_team_collections_settle ─────────────────────────────────────────────────────────────────────────
--   p_teams    [{ "id": "g2", "cards": ["carta-1", …] }, …]                    lo que exige cada equipo HOY
--   p_regions  [{ "region": "EMEA", "teams": 12, "cards": ["carta-1", …] }, …] lo que exige cada región HOY
--   p_season   temporada ACTIVA (o null: los XP quedan pendientes)
--   p_xp       XP por primera compleción de un equipo
create or replace function public.app_team_collections_settle(
  p_user uuid, p_teams jsonb, p_regions jsonb, p_season text, p_xp int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t         jsonb;
  g         jsonb;
  c         public.user_team_completions%rowtype;
  v_id      text;
  v_cards   text[];
  v_have    int;
  v_code    text;
  v_xp      int;
  v_r       jsonb;
  v_region  text;
  v_nteams  int;
  v_rows    int;
  v_total   int := 0;
  v_teams   jsonb := '[]'::jsonb;
  v_regions jsonb := '[]'::jsonb;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('code', 'BAD_USER');
  end if;
  if jsonb_typeof(coalesce(p_teams, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_regions, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_teams, '[]'::jsonb)) > 500 or jsonb_array_length(coalesce(p_regions, '[]'::jsonb)) > 8 then
    return jsonb_build_object('code', 'BAD_BODY');
  end if;

  -- Una liquidación a la vez por cuenta.
  perform pg_advisory_xact_lock(hashtextextended('team-collections:' || p_user::text, 0));

  for t in select * from jsonb_array_elements(coalesce(p_teams, '[]'::jsonb)) loop
    v_id := t ->> 'id';
    if v_id is null or length(v_id) not between 1 and 64 or jsonb_typeof(t -> 'cards') is distinct from 'array' then continue; end if;
    select coalesce(array_agg(distinct x), '{}') into v_cards from jsonb_array_elements_text(t -> 'cards') x;
    if cardinality(v_cards) < 1 or cardinality(v_cards) > 2000 then continue; end if;

    v_code := 'ALREADY'; v_xp := 0;
    select * into c from public.user_team_completions where user_id = p_user and team_id = v_id;
    if not found then
      -- Todas las cartas, cada una al menos una vez. Las copias repetidas no cuentan dos veces.
      select count(distinct card_id) into v_have from public.user_cards where user_id = p_user and card_id = any (v_cards);
      if v_have <> cardinality(v_cards) then
        v_teams := v_teams || jsonb_build_object('id', v_id, 'code', 'INCOMPLETE', 'xp', 0);
        continue;
      end if;
      insert into public.user_team_completions (user_id, team_id, cards) values (p_user, v_id, cardinality(v_cards))
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_code := 'COMPLETED'; end if;
      select * into c from public.user_team_completions where user_id = p_user and team_id = v_id;
    end if;

    -- XP de la primera compleción: una vez por cuenta y equipo, en la temporada activa. Sin temporada, pendientes.
    if c.xp_granted_at is null and p_season is not null and coalesce(p_xp, 0) > 0 then
      v_r := public.app_season_apply(p_user, p_season, 'team-collection:' || v_id, 'COLLECTION', least(p_xp, 100000), null,
                                     '[]'::jsonb, jsonb_build_object('kind', 'TEAM_COLLECTION', 'team', v_id));
      if v_r ->> 'code' = 'APPLIED' then
        v_xp := coalesce((v_r ->> 'baseGranted')::int, 0);
        update public.user_team_completions set xp_amount = v_xp, xp_season_id = p_season, xp_granted_at = now()
         where user_id = p_user and team_id = v_id and xp_granted_at is null;
        v_total := v_total + v_xp;
        if v_code = 'ALREADY' then v_code := 'XP_GRANTED'; end if;
      elsif v_r ->> 'code' = 'REPEATED' then
        -- El libro de esa temporada ya tenía este evento: se da por concedido y no se suma nada.
        update public.user_team_completions set xp_amount = 0, xp_season_id = p_season, xp_granted_at = now()
         where user_id = p_user and team_id = v_id and xp_granted_at is null;
      end if;
      -- INACTIVE o cualquier otro código: siguen pendientes.
    end if;
    v_teams := v_teams || jsonb_build_object('id', v_id, 'code', v_code, 'xp', v_xp);
  end loop;

  for g in select * from jsonb_array_elements(coalesce(p_regions, '[]'::jsonb)) loop
    v_region := g ->> 'region';
    if v_region is null or v_region not in ('Americas', 'EMEA', 'Pacific', 'China') or jsonb_typeof(g -> 'cards') is distinct from 'array' then continue; end if;
    if exists (select 1 from public.user_region_badges where user_id = p_user and region = v_region) then
      v_regions := v_regions || jsonb_build_object('region', v_region, 'code', 'ALREADY');
      continue;
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_cards from jsonb_array_elements_text(g -> 'cards') x;
    v_nteams := coalesce((g ->> 'teams')::int, 0);
    -- Una región sin equipos o sin cartas no concede insignia.
    if v_nteams < 1 or cardinality(v_cards) < 1 or cardinality(v_cards) > 5000 then
      v_regions := v_regions || jsonb_build_object('region', v_region, 'code', 'EMPTY');
      continue;
    end if;
    select count(distinct card_id) into v_have from public.user_cards where user_id = p_user and card_id = any (v_cards);
    if v_have <> cardinality(v_cards) then
      v_regions := v_regions || jsonb_build_object('region', v_region, 'code', 'INCOMPLETE');
      continue;
    end if;
    insert into public.user_region_badges (user_id, region, teams, cards) values (p_user, v_region, v_nteams, cardinality(v_cards))
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    insert into public.user_cosmetics (user_id, cosmetic_id, source)
    values (p_user, 'insignia:regional:' || lower(v_region), 'team-collections:region:' || v_region)
    on conflict do nothing;
    v_regions := v_regions || jsonb_build_object('region', v_region, 'code', case when v_rows > 0 then 'UNLOCKED' else 'ALREADY' end);
  end loop;

  return jsonb_build_object('code', 'OK', 'teams', v_teams, 'regions', v_regions, 'xpGained', v_total);
end $$;

revoke all on function public.app_team_collections_settle(uuid, jsonb, jsonb, text, int) from public, anon, authenticated;
grant execute on function public.app_team_collections_settle(uuid, jsonb, jsonb, text, int) to service_role;
comment on function public.app_team_collections_settle(uuid, jsonb, jsonb, text, int) is
  '0075 · liquida primeras compleciones de equipo (XP de temporada, una vez) e insignias regionales permanentes. Atómica e idempotente. Solo servidor.';
