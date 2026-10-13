-- ============================================================================================================
-- 0064 · F83 SEASONS, ACCOUNT PROGRESSION & SEASON TRACK
--
-- Qué añade (todo aditivo; nada existente cambia de forma):
--   1. game_seasons               temporadas del juego en BD (la tabla `seasons` de 0012 es de Pick'ems y no se toca).
--                                 DRAFT editable → PUBLISHED inmutable (curva, niveles, recompensas, retos y fechas
--                                 congelados por disparador) → CANCELLED (solo antes de empezar). La FASE (programada,
--                                 activa, terminada en gracia, archivada) se DERIVA de la hora de la BD: no hay cron.
--                                 Dos temporadas publicadas no pueden solaparse (restricción de exclusión en BD).
--   2. season_events              un evento (fin de partida, crafteo, colección) se procesa UNA vez por usuario y
--                                 temporada: PK (user, season, event_key).
--   3. season_xp_ledger           libro mayor de XP de temporada: cada concesión con fuente y clave. UNIQUE
--                                 (user, season, event_key) = exactamente una vez. Nunca negativo.
--   4. season_progress            total de XP por (user, season), mantenido en la MISMA transacción que el libro mayor.
--                                 El NIVEL no se guarda: se deriva de la XP con los umbrales congelados de la temporada.
--   5. season_challenge_progress  retos diarios/semanales por periodo (`d:YYYY-MM-DD` / `w:YYYY-MM-DD`, UTC).
--   6. season_reward_claims       reclamos de recompensas de nivel: PK (user, season, level).
--   7. app_season_apply           aplica un evento: temporada activa por hora de BD, idempotencia, tope diario por
--                                 fuente, retos del periodo ACTUAL (un periodo viejo se rechaza), XP de reto una vez.
--   8. app_season_claim           reclamo: temporada publicada y dentro del plazo de reclamo, nivel alcanzado según los
--                                 umbrales congelados, recompensa definida, una sola vez.
--
-- Seguridad: RLS en todas; el jugador solo LEE lo suyo (progreso, retos, reclamos, libro mayor) y las temporadas
-- publicadas. Escribir solo por las RPC SECURITY DEFINER (EXECUTE solo service_role). La XP la calcula el servidor con
-- las reglas congeladas de la temporada: ningún cliente envía cantidades.
-- Rollback: docs/operations/rollback/0064_season_track.ROLLBACK.sql
-- ============================================================================================================

-- ── 1. game_seasons ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.game_seasons (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  number        int  not null check (number between 1 and 999),
  name          text not null check (length(btrim(name)) between 3 and 60),
  description   text not null default '' check (length(description) <= 280),
  status        text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'CANCELLED')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  claim_until   timestamptz not null,
  max_level     int  not null check (max_level between 5 and 100),
  -- Reglas completas: curva + umbrales (`levels`), XP por fuente y topes, recompensas por nivel, retos (pools).
  config        jsonb not null check (jsonb_typeof(config) = 'object'),
  config_version int not null default 1 check (config_version >= 1),
  checksum      text,
  row_version   int not null default 1,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  published_by  uuid,
  cancelled_at  timestamptz,
  constraint game_seasons_dates check (ends_at > starts_at and claim_until >= ends_at),
  constraint game_seasons_published_shape check (
    status = 'DRAFT' or (checksum is not null and published_at is not null
      and jsonb_typeof(config -> 'levels') = 'array' and jsonb_array_length(config -> 'levels') = max_level)
  ),
  constraint game_seasons_cancelled_shape check ((status = 'CANCELLED') = (cancelled_at is not null))
);
create unique index if not exists game_seasons_number_live on public.game_seasons (number) where status <> 'CANCELLED';
-- UNA sola temporada viva a la vez: dos PUBLISHED no pueden solaparse en el tiempo (la BD lo impone, no el panel).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_seasons_no_overlap') then
    alter table public.game_seasons add constraint game_seasons_no_overlap
      exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&) where (status = 'PUBLISHED');
  end if;
end $$;

alter table public.game_seasons enable row level security;
revoke all on public.game_seasons from public, anon, authenticated;
grant select on public.game_seasons to authenticated;
grant select, insert, update, delete on public.game_seasons to service_role;
drop policy if exists "temporadas publicadas" on public.game_seasons;
create policy "temporadas publicadas" on public.game_seasons for select to authenticated using (status = 'PUBLISHED');
comment on table public.game_seasons is 'F83 · temporadas del juego (DRAFT/PUBLISHED/CANCELLED; fase derivada de la hora). Publicada = reglas congeladas.';

create or replace function public._game_seasons_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then raise exception 'GAME_SEASON_IMMUTABLE: solo se borran borradores (%)', old.id using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status = 'CANCELLED' and new is distinct from old then
    raise exception 'GAME_SEASON_IMMUTABLE: % está cancelada', old.id using errcode = 'P0001';
  end if;
  if old.status = 'PUBLISHED' then
    if new.id is distinct from old.id or new.number is distinct from old.number or new.name is distinct from old.name
       or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
       or new.claim_until is distinct from old.claim_until or new.max_level is distinct from old.max_level
       or new.config is distinct from old.config or new.config_version is distinct from old.config_version
       or new.checksum is distinct from old.checksum or new.published_at is distinct from old.published_at
       or new.published_by is distinct from old.published_by or new.created_at is distinct from old.created_at then
      raise exception 'GAME_SEASON_IMMUTABLE: % está publicada', old.id using errcode = 'P0001';
    end if;
    if new.status = 'CANCELLED' and now() >= old.starts_at then
      raise exception 'GAME_SEASON_TRANSITION: una temporada que ya empezó no se cancela' using errcode = 'P0001';
    end if;
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'DRAFT' and new.status = 'PUBLISHED') or (old.status = 'PUBLISHED' and new.status = 'CANCELLED')) then
    raise exception 'GAME_SEASON_TRANSITION: % → %', old.status, new.status using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
drop trigger if exists trg_game_seasons_guard on public.game_seasons;
create trigger trg_game_seasons_guard before update or delete on public.game_seasons for each row execute function public._game_seasons_guard();

create or replace function public._game_seasons_insert_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'DRAFT' then raise exception 'GAME_SEASON_TRANSITION: una temporada nace DRAFT' using errcode = 'P0001'; end if;
  new.row_version := 1;
  return new;
end $$;
drop trigger if exists trg_game_seasons_insert_guard on public.game_seasons;
create trigger trg_game_seasons_insert_guard before insert on public.game_seasons for each row execute function public._game_seasons_insert_guard();
revoke all on function public._game_seasons_guard() from public, anon, authenticated;
revoke all on function public._game_seasons_insert_guard() from public, anon, authenticated;

-- ── 2–6. estado por jugador ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.season_events (
  user_id    uuid not null references auth.users(id) on delete cascade,
  season_id  text not null references public.game_seasons(id),
  event_key  text not null check (length(event_key) between 3 and 200),
  source     text not null check (source in ('MATCH', 'CRAFT', 'COLLECTION')),
  created_at timestamptz not null default now(),
  primary key (user_id, season_id, event_key)
);

create table if not exists public.season_xp_ledger (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  season_id  text not null references public.game_seasons(id),
  source     text not null check (source in ('MATCH', 'CRAFT', 'COLLECTION', 'CHALLENGE')),
  event_key  text not null check (length(event_key) between 3 and 200),
  amount     int  not null check (amount > 0 and amount <= 100000),
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint season_xp_ledger_once unique (user_id, season_id, event_key)
);
create index if not exists season_xp_ledger_user_idx on public.season_xp_ledger (user_id, season_id, created_at desc);

create table if not exists public.season_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  season_id  text not null references public.game_seasons(id),
  xp         int  not null default 0 check (xp >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

create table if not exists public.season_challenge_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  season_id    text not null references public.game_seasons(id),
  period_key   text not null check (period_key ~ '^[dw]:[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  challenge_id text not null check (challenge_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  progress     int  not null default 0 check (progress >= 0),
  target       int  not null check (target between 1 and 500),
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, season_id, period_key, challenge_id)
);

create table if not exists public.season_reward_claims (
  user_id    uuid not null references auth.users(id) on delete cascade,
  season_id  text not null references public.game_seasons(id),
  level      int  not null check (level between 1 and 100),
  reward     jsonb not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, season_id, level)
);

alter table public.season_events enable row level security;
alter table public.season_xp_ledger enable row level security;
alter table public.season_progress enable row level security;
alter table public.season_challenge_progress enable row level security;
alter table public.season_reward_claims enable row level security;
revoke all on public.season_events, public.season_xp_ledger, public.season_progress, public.season_challenge_progress, public.season_reward_claims from public, anon, authenticated;
grant select on public.season_xp_ledger, public.season_progress, public.season_challenge_progress, public.season_reward_claims to authenticated;
grant select, insert, update, delete on public.season_events, public.season_xp_ledger, public.season_progress, public.season_challenge_progress, public.season_reward_claims to service_role;
grant usage, select on sequence public.season_xp_ledger_id_seq to service_role;
drop policy if exists "tu libro de temporada" on public.season_xp_ledger;
create policy "tu libro de temporada" on public.season_xp_ledger for select to authenticated using (auth.uid() = user_id);
drop policy if exists "tu progreso de temporada" on public.season_progress;
create policy "tu progreso de temporada" on public.season_progress for select to authenticated using (auth.uid() = user_id);
drop policy if exists "tus retos de temporada" on public.season_challenge_progress;
create policy "tus retos de temporada" on public.season_challenge_progress for select to authenticated using (auth.uid() = user_id);
drop policy if exists "tus reclamos de temporada" on public.season_reward_claims;
create policy "tus reclamos de temporada" on public.season_reward_claims for select to authenticated using (auth.uid() = user_id);

-- ── 7. app_season_apply ────────────────────────────────────────────────────────────────────────────────────
-- p_ops: [{ "challenge": id, "period": "d:YYYY-MM-DD" | "w:YYYY-MM-DD", "op": "INC" | "STREAK_WIN" | "STREAK_RESET",
--           "value": int, "target": int, "xp": int }]
create or replace function public.app_season_apply(
  p_user uuid, p_season text, p_event_key text, p_source text, p_amount int, p_daily_cap int, p_ops jsonb, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        public.game_seasons%rowtype;
  v_rows   int;
  v_day    date := (now() at time zone 'utc')::date;
  v_dkey   text;
  v_wkey   text;
  v_used   int;
  v_grant  int := 0;
  v_total  int := 0;
  o        jsonb;
  v_new    int;
  v_xp     int;
  v_done   text[] := '{}';
  v_period text;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('code', 'BAD_USER'); end if;
  if p_source not in ('MATCH', 'CRAFT', 'COLLECTION') then return jsonb_build_object('code', 'BAD_SOURCE'); end if;
  select * into s from public.game_seasons where id = p_season;
  if not found or s.status <> 'PUBLISHED' or now() < s.starts_at or now() >= s.ends_at then
    return jsonb_build_object('code', 'INACTIVE');
  end if;

  insert into public.season_events (user_id, season_id, event_key, source) values (p_user, p_season, p_event_key, p_source)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('code', 'REPEATED'); end if;

  -- Serializa por (usuario, temporada): topes y totales consistentes aunque lleguen eventos a la vez.
  insert into public.season_progress (user_id, season_id) values (p_user, p_season) on conflict do nothing;
  perform 1 from public.season_progress where user_id = p_user and season_id = p_season for update;

  if coalesce(p_amount, 0) > 0 then
    v_grant := least(p_amount, 100000);
    if p_daily_cap is not null then
      select coalesce(sum(amount), 0) into v_used from public.season_xp_ledger
       where user_id = p_user and season_id = p_season and source = p_source and (created_at at time zone 'utc')::date = v_day;
      v_grant := least(v_grant, greatest(0, p_daily_cap - v_used));
    end if;
    if v_grant > 0 then
      insert into public.season_xp_ledger (user_id, season_id, source, event_key, amount, meta)
      values (p_user, p_season, p_source, p_event_key, v_grant, coalesce(p_meta, '{}'::jsonb));
      v_total := v_total + v_grant;
    end if;
  end if;

  -- Retos: SOLO del periodo actual según la hora de la BD (un evento con un periodo viejo o futuro no cuenta).
  v_dkey := 'd:' || to_char(v_day, 'YYYY-MM-DD');
  v_wkey := 'w:' || to_char(v_day - ((extract(isodow from v_day)::int) - 1), 'YYYY-MM-DD');
  for o in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    v_period := o ->> 'period';
    if v_period is distinct from v_dkey and v_period is distinct from v_wkey then continue; end if;
    if coalesce((o ->> 'target')::int, 0) < 1 then continue; end if;
    insert into public.season_challenge_progress (user_id, season_id, period_key, challenge_id, target)
    values (p_user, p_season, v_period, o ->> 'challenge', (o ->> 'target')::int) on conflict do nothing;
    update public.season_challenge_progress set
        progress = case o ->> 'op'
          when 'INC'          then least(progress + greatest(coalesce((o ->> 'value')::int, 0), 0), target)
          when 'STREAK_WIN'   then least(progress + 1, target)
          when 'STREAK_RESET' then 0
          else progress end,
        updated_at = now()
      where user_id = p_user and season_id = p_season and period_key = v_period and challenge_id = o ->> 'challenge' and completed_at is null
      returning progress into v_new;
    if v_new is not null and v_new >= (o ->> 'target')::int then
      update public.season_challenge_progress set completed_at = now()
       where user_id = p_user and season_id = p_season and period_key = v_period and challenge_id = o ->> 'challenge' and completed_at is null;
      v_xp := least(greatest(coalesce((o ->> 'xp')::int, 0), 0), 100000);
      if v_xp > 0 then
        insert into public.season_xp_ledger (user_id, season_id, source, event_key, amount, meta)
        values (p_user, p_season, 'CHALLENGE', 'ch:' || v_period || ':' || (o ->> 'challenge'), v_xp, jsonb_build_object('by', p_event_key))
        on conflict do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then v_total := v_total + v_xp; end if;
      end if;
      v_done := v_done || (o ->> 'challenge');
    end if;
    v_new := null;
  end loop;

  update public.season_progress set xp = xp + v_total, updated_at = now()
   where user_id = p_user and season_id = p_season returning xp into v_xp;
  return jsonb_build_object('code', 'APPLIED', 'xpGained', v_total, 'baseGranted', v_grant, 'xp', v_xp, 'completed', to_jsonb(v_done));
end $$;

-- ── 8. app_season_claim ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.app_season_claim(p_user uuid, p_season text, p_level int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s      public.game_seasons%rowtype;
  v_xp   int;
  v_need int;
  v_rew  jsonb;
  v_rows int;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('code', 'BAD_USER'); end if;
  select * into s from public.game_seasons where id = p_season;
  if not found or s.status <> 'PUBLISHED' or now() < s.starts_at then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if p_level is null or p_level < 1 or p_level > s.max_level then return jsonb_build_object('code', 'BAD_LEVEL'); end if;
  select r -> 'reward' into v_rew from jsonb_array_elements(s.config -> 'rewards') r where (r ->> 'level')::int = p_level limit 1;
  if v_rew is null then return jsonb_build_object('code', 'NO_REWARD'); end if;

  if exists (select 1 from public.season_reward_claims where user_id = p_user and season_id = p_season and level = p_level) then
    return jsonb_build_object('code', 'ALREADY', 'reward', v_rew);
  end if;
  if now() >= s.claim_until then return jsonb_build_object('code', 'CLOSED'); end if;

  select xp into v_xp from public.season_progress where user_id = p_user and season_id = p_season for update;
  v_need := (s.config -> 'levels' ->> (p_level - 1))::int;
  if v_xp is null or v_need is null or v_xp < v_need then return jsonb_build_object('code', 'LOCKED', 'xp', coalesce(v_xp, 0), 'need', v_need); end if;

  insert into public.season_reward_claims (user_id, season_id, level, reward) values (p_user, p_season, p_level, v_rew)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('code', 'ALREADY', 'reward', v_rew); end if;
  return jsonb_build_object('code', 'CLAIMED', 'reward', v_rew);
end $$;

revoke all on function public.app_season_apply(uuid, text, text, text, int, int, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.app_season_claim(uuid, text, int) from public, anon, authenticated;
grant execute on function public.app_season_apply(uuid, text, text, text, int, int, jsonb, jsonb) to service_role;
grant execute on function public.app_season_claim(uuid, text, int) to service_role;

-- ── guardia final ──────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated', 'public.app_season_apply(uuid, text, text, text, int, int, jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_season_claim(uuid, text, int)', 'execute')
     or has_table_privilege('authenticated', 'public.season_xp_ledger', 'insert')
     or has_table_privilege('authenticated', 'public.season_progress', 'update')
     or has_table_privilege('authenticated', 'public.game_seasons', 'update')
     or has_table_privilege('anon', 'public.season_progress', 'select') then
    raise exception '0064: privilegios de cliente demasiado amplios';
  end if;
end $$;
