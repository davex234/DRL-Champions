-- ============================================================================================================
-- 0065 · F84 RANKED 2.0 / COMPETITIVE SYSTEM
--
-- F84 EXTIENDE el Ranked que existe (0032–0035, 0047, 0048): NO crea un segundo rating ni una segunda liquidación.
--   · El rating canónico sigue siendo `duel_pvp_ratings.rating` (Elo inicial 1000, K 40 si < 10 partidas / 24, suelo 0,
--     techo 5000). La MATEMÁTICA de `duel_pvp_settle_match` se conserva palabra por palabra.
--   · El RANGO (Cantera…Cumbre, divisiones III-II-I) NO se guarda: lo deriva el servidor del rating con una configuración
--     versionada (`rank_config_version`, en código: `src/domain/ranked/config.ts`). Nada aquí puede desincronizarse.
--
-- Qué añade (aditivo; ningún dato existente cambia):
--   1. competitive_seasons            temporada competitiva (DRAFT → PUBLISHED inmutable → CANCELLED), opcionalmente
--                                     enlazada a una temporada F83 (`game_season_id`) SIN mezclar XP y rating. Fase por
--                                     hora de BD. Dos publicadas no se solapan. `ends_at` NULL = abierta hasta que se
--                                     programe la siguiente (se fija UNA vez, nunca hacia atrás).
--      → se crea y publica la **Temporada competitiva 1**, que empieza AHORA (frontera F84) y queda abierta. No toca
--        F83: la Temporada 2 · Asalto sigue en DRAFT y no se enlaza.
--   2. duel_pvp_rating_events (+4)    el libro existente gana `formula_version` ('ranked-rating-v1' = Elo de 0033–0035,
--                                     las filas históricas lo eran), `competitive_season_id` + `season_match_number`
--                                     (NULL antes de F84: no se reconstruye historia) y `rule` (STANDARD | PAIR_CAP).
--                                     Inmutable: sin UPDATE; DELETE solo en cascada al borrar la cuenta.
--   3. competitive_season_players     récord por (temporada, jugador): partidas/V/D/E, rating semilla, colocación,
--                                     pico, pico tras colocación, última partida. Se escribe SOLO dentro de la
--                                     liquidación, detrás de la puerta de idempotencia del libro (exactamente una vez).
--   4. competitive_rating_adjustments cambios de rating que NO son una partida (reinicio suave de una temporada futura,
--                                     corrección auditada). Inmutable, con referencia única y motivo obligatorio.
--   5. competitive_season_snapshots   foto final de una temporada cerrada (rating final, pico, récord, puesto). Inmutable.
--   6. competitive_ladder (vista)     la CLASIFICACIÓN: jugadores con colocación completa, mínimo de partidas y
--                                     actividad reciente en la temporada activa, con su rating canónico. Solo servidor.
--   7. duel_pvp_settle_match          MISMA fórmula; además sella temporada/versión/número de partida, mantiene el récord
--                                     de temporada y aplica el TOPE DE PAREJA (anti farmeo: la misma pareja intercambia
--                                     rating como mucho N veces en 24 h; las siguientes se registran con delta 0).
--   8. competitive_season_close / competitive_season_seed / competitive_rating_correct
--                                     PREPARADAS (no se ejecutan en F84): foto final, reinicio suave ledgerizado y
--                                     corrección auditada. Solo service_role.
--   9. Guardia de escritura de `duel_pvp_ratings`: rating y contadores solo cambian desde esas funciones (bandera de
--      transacción); un UPDATE suelto, aunque sea del service_role, se rechaza.
--
-- Seguridad: RLS en todo; el jugador solo LEE su récord de temporada, sus ajustes y su foto; las temporadas publicadas son
-- legibles. El libro y los ratings siguen sin políticas (solo servidor). Escribir: solo las funciones SECURITY DEFINER.
-- Rollback: docs/operations/rollback/0065_ranked_competitive.ROLLBACK.sql
-- ============================================================================================================

-- ── 1. competitive_seasons ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.competitive_seasons (
  id                  text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  number              int  not null check (number between 1 and 999),
  name                text not null check (length(btrim(name)) between 3 and 60),
  status              text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'CANCELLED')),
  starts_at           timestamptz not null,
  ends_at             timestamptz,
  -- Enlace OPCIONAL a una temporada F83: comparten calendario, no moneda (XP de temporada ≠ rating).
  game_season_id      text references public.game_seasons(id),
  rank_config_version text not null check (rank_config_version ~ '^rank-v[0-9]{1,3}$'),
  formula_version     text not null check (formula_version ~ '^ranked-rating-v[0-9]{1,3}$'),
  placement_games     int  not null check (placement_games between 1 and 20),
  -- { top: { size, minSeasonMatches, activeDays }, pairCap: { matches, hours }, reset: null | { baseline, factor } }
  config              jsonb not null check (jsonb_typeof(config) = 'object'),
  row_version         int  not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  published_at        timestamptz,
  closed_at           timestamptz,
  cancelled_at        timestamptz,
  constraint competitive_seasons_dates check (ends_at is null or ends_at > starts_at),
  constraint competitive_seasons_config_shape check (
    (config -> 'top' ->> 'size')::int between 1 and 500
    and (config -> 'top' ->> 'minSeasonMatches')::int between 1 and 200
    and (config -> 'top' ->> 'activeDays')::int between 1 and 90
    and (config -> 'pairCap' ->> 'matches')::int between 1 and 100
    and (config -> 'pairCap' ->> 'hours')::int between 1 and 168
    and (config -> 'reset' is null or jsonb_typeof(config -> 'reset') = 'null' or (
      (config -> 'reset' ->> 'baseline')::int between 0 and 5000 and (config -> 'reset' ->> 'factor')::numeric between 0 and 1))
  ),
  constraint competitive_seasons_published_shape check (status <> 'PUBLISHED' or published_at is not null),
  constraint competitive_seasons_cancelled_shape check ((status = 'CANCELLED') = (cancelled_at is not null)),
  constraint competitive_seasons_closed_shape check (closed_at is null or (ends_at is not null and closed_at >= ends_at))
);
create unique index if not exists competitive_seasons_number_live on public.competitive_seasons (number) where status <> 'CANCELLED';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'competitive_seasons_no_overlap') then
    alter table public.competitive_seasons add constraint competitive_seasons_no_overlap
      exclude using gist (tstzrange(starts_at, coalesce(ends_at, 'infinity'::timestamptz), '[)') with &&) where (status = 'PUBLISHED');
  end if;
end $$;

alter table public.competitive_seasons enable row level security;
revoke all on public.competitive_seasons from public, anon, authenticated;
grant select on public.competitive_seasons to authenticated;
grant select, insert, update, delete on public.competitive_seasons to service_role;
drop policy if exists "temporadas competitivas publicadas" on public.competitive_seasons;
create policy "temporadas competitivas publicadas" on public.competitive_seasons for select to authenticated using (status = 'PUBLISHED');
comment on table public.competitive_seasons is 'F84 · temporadas competitivas (rating ≠ XP de temporada F83). Publicada = reglas congeladas; ends_at se fija una vez.';

create or replace function public._competitive_seasons_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then raise exception 'COMPETITIVE_SEASON_IMMUTABLE: solo se borran borradores (%)', old.id using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status = 'CANCELLED' and new is distinct from old then
    raise exception 'COMPETITIVE_SEASON_IMMUTABLE: % está cancelada', old.id using errcode = 'P0001';
  end if;
  if old.status = 'PUBLISHED' then
    if new.id is distinct from old.id or new.number is distinct from old.number or new.name is distinct from old.name
       or new.starts_at is distinct from old.starts_at or new.game_season_id is distinct from old.game_season_id
       or new.rank_config_version is distinct from old.rank_config_version or new.formula_version is distinct from old.formula_version
       or new.placement_games is distinct from old.placement_games or new.config is distinct from old.config
       or new.published_at is distinct from old.published_at or new.created_at is distinct from old.created_at then
      raise exception 'COMPETITIVE_SEASON_IMMUTABLE: % está publicada', old.id using errcode = 'P0001';
    end if;
    -- El final se programa UNA vez (de abierta a una fecha futura) y no se mueve después.
    if new.ends_at is distinct from old.ends_at then
      if old.ends_at is not null then raise exception 'COMPETITIVE_SEASON_IMMUTABLE: el final de % ya está fijado', old.id using errcode = 'P0001'; end if;
      if new.ends_at is null or new.ends_at < now() then raise exception 'COMPETITIVE_SEASON_TRANSITION: el final debe ser futuro' using errcode = 'P0001'; end if;
    end if;
    if new.closed_at is distinct from old.closed_at and (old.closed_at is not null or new.ends_at is null or now() < new.ends_at) then
      raise exception 'COMPETITIVE_SEASON_TRANSITION: solo se cierra una vez y tras su final' using errcode = 'P0001';
    end if;
    if new.status = 'CANCELLED' and now() >= old.starts_at then
      raise exception 'COMPETITIVE_SEASON_TRANSITION: una temporada que ya empezó no se cancela' using errcode = 'P0001';
    end if;
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'DRAFT' and new.status = 'PUBLISHED') or (old.status = 'PUBLISHED' and new.status = 'CANCELLED')
       or (old.status = 'DRAFT' and new.status = 'CANCELLED')) then
    raise exception 'COMPETITIVE_SEASON_TRANSITION: % → %', old.status, new.status using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
drop trigger if exists trg_competitive_seasons_guard on public.competitive_seasons;
create trigger trg_competitive_seasons_guard before update or delete on public.competitive_seasons for each row execute function public._competitive_seasons_guard();

create or replace function public._competitive_seasons_insert_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'DRAFT' then raise exception 'COMPETITIVE_SEASON_TRANSITION: una temporada competitiva nace DRAFT' using errcode = 'P0001'; end if;
  new.row_version := 1;
  return new;
end $$;
drop trigger if exists trg_competitive_seasons_insert_guard on public.competitive_seasons;
create trigger trg_competitive_seasons_insert_guard before insert on public.competitive_seasons for each row execute function public._competitive_seasons_insert_guard();
revoke all on function public._competitive_seasons_guard() from public, anon, authenticated;
revoke all on function public._competitive_seasons_insert_guard() from public, anon, authenticated;

-- ── 2. el libro existente: versión de fórmula, temporada, número de partida, regla ────────────────────────
alter table public.duel_pvp_rating_events add column if not exists formula_version text not null default 'ranked-rating-v1';
alter table public.duel_pvp_rating_events add column if not exists competitive_season_id text references public.competitive_seasons(id);
alter table public.duel_pvp_rating_events add column if not exists season_match_number int;
alter table public.duel_pvp_rating_events add column if not exists rule text not null default 'STANDARD';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'duel_pvp_rating_events_rule') then
    alter table public.duel_pvp_rating_events add constraint duel_pvp_rating_events_rule check (rule in ('STANDARD', 'PAIR_CAP'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'duel_pvp_rating_events_season_shape') then
    alter table public.duel_pvp_rating_events add constraint duel_pvp_rating_events_season_shape
      check ((competitive_season_id is null) = (season_match_number is null) and (season_match_number is null or season_match_number >= 1));
  end if;
  -- Una partida bajo el tope de pareja no mueve rating: K 0 y delta 0 (sigue siendo reproducible).
  if not exists (select 1 from pg_constraint where conname = 'duel_pvp_rating_events_pair_cap') then
    alter table public.duel_pvp_rating_events add constraint duel_pvp_rating_events_pair_cap
      check (rule <> 'PAIR_CAP' or (k_factor = 0 and delta = 0));
  end if;
end $$;
-- Una partida por temporada y número (no puede haber dos «partida 3 de 5»).
create unique index if not exists duel_pvp_rating_events_season_seq
  on public.duel_pvp_rating_events (competitive_season_id, user_id, season_match_number) where competitive_season_id is not null;
comment on column public.duel_pvp_rating_events.formula_version is 'F84 · versión de la fórmula aplicada. ranked-rating-v1 = Elo 0033–0035 (inicial 1000, K 40 <10 partidas / 24, suelo 0, techo 5000).';
comment on column public.duel_pvp_rating_events.competitive_season_id is 'F84 · temporada competitiva activa al liquidar (hora de BD). NULL = anterior a la frontera F84 (no se reconstruye).';
comment on column public.duel_pvp_rating_events.rule is 'F84 · STANDARD = intercambio Elo normal; PAIR_CAP = la misma pareja superó el tope de partidas puntuadas en la ventana (delta 0).';

create or replace function public._duel_pvp_rating_events_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'RATING_LEDGER_IMMUTABLE: los asientos de rating no se modifican' using errcode = 'P0001';
  end if;
  -- DELETE: solo en cascada (borrado de la cuenta → disparador RI, profundidad > 1). Un DELETE directo se rechaza.
  if pg_trigger_depth() <= 1 then
    raise exception 'RATING_LEDGER_IMMUTABLE: los asientos de rating no se borran' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists trg_duel_pvp_rating_events_immutable on public.duel_pvp_rating_events;
create trigger trg_duel_pvp_rating_events_immutable before update or delete on public.duel_pvp_rating_events
  for each row execute function public._duel_pvp_rating_events_immutable();
revoke all on function public._duel_pvp_rating_events_immutable() from public, anon, authenticated;

-- ── 3. competitive_season_players ─────────────────────────────────────────────────────────────────────────
create table if not exists public.competitive_season_players (
  season_id              text not null references public.competitive_seasons(id),
  user_id                uuid not null references auth.users(id) on delete cascade,
  matches                int  not null default 0 check (matches >= 0),
  wins                   int  not null default 0 check (wins >= 0),
  losses                 int  not null default 0 check (losses >= 0),
  draws                  int  not null default 0 check (draws >= 0),
  -- Rating con el que entró en la temporada (old_rating de su primera partida de temporada).
  seed_rating            int  not null check (seed_rating between 0 and 5000),
  placement_completed_at timestamptz,
  -- Máximo new_rating de la temporada (incluye colocación) y máximo DESDE que completó la colocación (= mejor rango).
  peak_rating            int  not null check (peak_rating between 0 and 5000),
  peak_ranked_rating     int  check (peak_ranked_rating between 0 and 5000),
  last_match_at          timestamptz not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (season_id, user_id),
  constraint competitive_season_players_sum check (wins + losses + draws = matches),
  constraint competitive_season_players_placement check ((placement_completed_at is null) = (peak_ranked_rating is null))
);
create index if not exists competitive_season_players_ladder_idx
  on public.competitive_season_players (season_id, last_match_at desc) where placement_completed_at is not null;
create index if not exists competitive_season_players_user_idx on public.competitive_season_players (user_id);
alter table public.competitive_season_players enable row level security;
revoke all on public.competitive_season_players from public, anon, authenticated;
grant select on public.competitive_season_players to authenticated;
grant select, insert, update, delete on public.competitive_season_players to service_role;
drop policy if exists "tu temporada competitiva" on public.competitive_season_players;
create policy "tu temporada competitiva" on public.competitive_season_players for select to authenticated using (auth.uid() = user_id);
comment on table public.competitive_season_players is 'F84 · récord por temporada competitiva. Solo lo escribe duel_pvp_settle_match tras la puerta del libro (una vez por partida).';

-- ── 4. competitive_rating_adjustments ─────────────────────────────────────────────────────────────────────
create table if not exists public.competitive_rating_adjustments (
  id               bigserial primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  season_id        text references public.competitive_seasons(id),
  reason           text not null check (reason in ('SEASON_SEED', 'ADMIN_CORRECTION')),
  old_rating       int  not null check (old_rating between 0 and 5000),
  delta            int  not null,
  new_rating       int  not null check (new_rating between 0 and 5000),
  formula_version  text not null,
  ref              text not null unique check (length(ref) between 6 and 160),
  note             text not null check (length(btrim(note)) between 10 and 500),
  actor            uuid,
  created_at       timestamptz not null default now(),
  constraint competitive_rating_adjustments_math check (new_rating = old_rating + delta)
);
create unique index if not exists competitive_rating_adjustments_seed_once
  on public.competitive_rating_adjustments (season_id, user_id) where reason = 'SEASON_SEED';
create index if not exists competitive_rating_adjustments_user_idx on public.competitive_rating_adjustments (user_id, created_at desc);
alter table public.competitive_rating_adjustments enable row level security;
revoke all on public.competitive_rating_adjustments from public, anon, authenticated;
revoke all on sequence public.competitive_rating_adjustments_id_seq from public, anon, authenticated;
grant select on public.competitive_rating_adjustments to authenticated;
grant select, insert on public.competitive_rating_adjustments to service_role;
grant usage, select on sequence public.competitive_rating_adjustments_id_seq to service_role;
drop policy if exists "tus ajustes de rating" on public.competitive_rating_adjustments;
create policy "tus ajustes de rating" on public.competitive_rating_adjustments for select to authenticated using (auth.uid() = user_id);
drop trigger if exists trg_competitive_rating_adjustments_immutable on public.competitive_rating_adjustments;
create trigger trg_competitive_rating_adjustments_immutable before update or delete on public.competitive_rating_adjustments
  for each row execute function public._duel_pvp_rating_events_immutable();

-- ── 5. competitive_season_snapshots ───────────────────────────────────────────────────────────────────────
create table if not exists public.competitive_season_snapshots (
  season_id           text not null references public.competitive_seasons(id),
  user_id             uuid not null references auth.users(id) on delete cascade,
  rank_config_version text not null,
  final_rating        int  not null,
  peak_rating         int  not null,
  peak_ranked_rating  int,
  matches             int  not null,
  wins                int  not null,
  losses              int  not null,
  draws               int  not null,
  placement_completed boolean not null,
  final_position      int  check (final_position is null or final_position >= 1),
  created_at          timestamptz not null default now(),
  primary key (season_id, user_id)
);
alter table public.competitive_season_snapshots enable row level security;
revoke all on public.competitive_season_snapshots from public, anon, authenticated;
grant select on public.competitive_season_snapshots to authenticated;
grant select, insert on public.competitive_season_snapshots to service_role;
drop policy if exists "tu foto de temporada competitiva" on public.competitive_season_snapshots;
create policy "tu foto de temporada competitiva" on public.competitive_season_snapshots for select to authenticated using (auth.uid() = user_id);
drop trigger if exists trg_competitive_season_snapshots_immutable on public.competitive_season_snapshots;
create trigger trg_competitive_season_snapshots_immutable before update or delete on public.competitive_season_snapshots
  for each row execute function public._duel_pvp_rating_events_immutable();

-- ── 6. guardia de escritura del rating ────────────────────────────────────────────────────────────────────
-- El rating y sus contadores solo cambian desde las funciones ledgerizadas, que levantan la bandera de transacción
-- `drl.rating_writer`. Un UPDATE suelto (consola, script, servicio) choca: no hay «set rating = X» sin asiento.
create or replace function public._duel_pvp_ratings_guard()
returns trigger language plpgsql set search_path = public as $$
declare w text := coalesce(current_setting('drl.rating_writer', true), '');
begin
  if tg_op = 'INSERT' then
    if (new.rating <> 1000 or new.games_played <> 0 or new.wins <> 0 or new.losses <> 0 or new.draws <> 0) and w = '' then
      raise exception 'RATING_WRITE_GUARD: una ficha de rating nace en 1000/0' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if (new.rating, new.games_played, new.wins, new.losses, new.draws) is distinct from (old.rating, old.games_played, old.wins, old.losses, old.draws)
     and w not in ('settle', 'seed', 'correct') then
    raise exception 'RATING_WRITE_GUARD: el rating solo cambia con un asiento (liquidación, semilla o corrección)' using errcode = 'P0001';
  end if;
  if new.user_id is distinct from old.user_id then raise exception 'RATING_WRITE_GUARD: user_id inmutable' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists trg_duel_pvp_ratings_guard on public.duel_pvp_ratings;
create trigger trg_duel_pvp_ratings_guard before insert or update on public.duel_pvp_ratings
  for each row execute function public._duel_pvp_ratings_guard();
revoke all on function public._duel_pvp_ratings_guard() from public, anon, authenticated;

-- ── 7. temporada activa (hora de BD) ──────────────────────────────────────────────────────────────────────
create or replace function public.competitive_active_season()
returns public.competitive_seasons language sql stable security definer set search_path = public as $$
  select s.* from public.competitive_seasons s
   where s.status = 'PUBLISHED' and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
   order by s.starts_at desc limit 1;
$$;

-- ── 8. la clasificación (vista, solo servidor) ────────────────────────────────────────────────────────────
-- Elegible = colocación completa + mínimo de partidas de temporada + una partida en los últimos `activeDays` días.
-- El rating es el canónico (join, no copia). Orden documentado (el mismo que la escalera F28/F55):
--   rating desc → duel_pvp_ratings.updated_at asc → user_id asc. El tope de 500 lo aplica el servidor al leer.
create or replace view public.competitive_ladder as
  select p.season_id, p.user_id, r.rating, r.games_played, r.wins, r.losses, r.draws, r.updated_at,
         p.matches as season_matches, p.wins as season_wins, p.losses as season_losses, p.draws as season_draws,
         p.last_match_at, p.peak_ranked_rating, p.placement_completed_at
    from public.competitive_season_players p
    join public.duel_pvp_ratings r on r.user_id = p.user_id
    join public.competitive_seasons s on s.id = p.season_id
   where p.placement_completed_at is not null
     and p.matches >= (s.config -> 'top' ->> 'minSeasonMatches')::int
     and p.last_match_at >= now() - make_interval(days => (s.config -> 'top' ->> 'activeDays')::int);
revoke all on public.competitive_ladder from public, anon, authenticated;
grant select on public.competitive_ladder to service_role;
comment on view public.competitive_ladder is 'F84 · clasificación elegible (Top). Solo servidor: nunca expone correo ni datos privados; el nombre público se une en el servidor.';

-- Libro completo de movimientos de rating (partidas + ajustes) para auditoría e invariantes. Solo servidor.
create or replace view public.competitive_rating_ledger as
  select e.user_id, e.created_at, e.id as seq, 'MATCH'::text as kind, e.match_id::text as ref, e.old_rating, e.delta, e.new_rating,
         e.competitive_season_id as season_id, e.formula_version, e.rule as detail
    from public.duel_pvp_rating_events e
  union all
  select a.user_id, a.created_at, a.id as seq, a.reason as kind, a.ref, a.old_rating, a.delta, a.new_rating,
         a.season_id, a.formula_version, a.note as detail
    from public.competitive_rating_adjustments a;
revoke all on public.competitive_rating_ledger from public, anon, authenticated;
grant select on public.competitive_rating_ledger to service_role;

-- ── 9. LIQUIDACIÓN — la misma de 0035, con temporada, récord y tope de pareja ──────────────────────────────
-- La matemática (expected_score, K por jugador, recorte [0, 5000], delta efectivo) es IDÉNTICA a 0035. Cambia:
--   · temporada activa por hora de BD → `competitive_season_id`, `season_match_number`, `formula_version`;
--   · TOPE DE PAREJA: si estos dos jugadores ya intercambiaron rating `pairCap.matches` veces en las últimas
--     `pairCap.hours` horas, la partida se registra (resultado, contadores, temporada) con K 0 y delta 0;
--   · récord de temporada en `competitive_season_players`, DETRÁS de la puerta (`inserted = 2`): exactamente una vez.
-- El recuento del tope y el número de partida se leen DESPUÉS de bloquear las dos fichas (orden por user_id), así que
-- dos liquidaciones de la misma pareja se serializan y no pueden contar lo mismo dos veces.
create or replace function public.duel_pvp_settle_match(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m         record;
  ra        public.duel_pvp_ratings%rowtype;
  rb        public.duel_pvp_ratings%rowtype;
  s         public.competitive_seasons%rowtype;
  score_a   double precision;
  k_a       int;
  k_b       int;
  delta_a   int;
  delta_b   int;
  new_a     int;
  new_b     int;
  res_a     text;
  res_b     text;
  inserted  int;
  v_rule    text := 'STANDARD';
  v_pair    int := 0;
  num_a     int;
  num_b     int;
  v_formula constant text := 'ranked-rating-v1';
begin
  select id, mode, status, winner, user_id, player_b_id, closed_reason, closed_by
    into m
    from public.duel_matches
   where id = p_match;

  if not found then             return jsonb_build_object('code', 'NO_MATCH'); end if;
  if m.mode <> 'PVP' then       return jsonb_build_object('code', 'NOT_PVP');  end if;
  if m.player_b_id is null then return jsonb_build_object('code', 'NOT_PVP');  end if;
  -- F84 · cinturón: nunca contra uno mismo (la cola ya lo impide en dos sitios).
  if m.player_b_id = m.user_id then return jsonb_build_object('code', 'NOT_PVP'); end if;

  if m.closed_reason in ('ABANDONED', 'EXPIRED') then
    if m.closed_by is null or m.closed_by not in (m.user_id, m.player_b_id) then
      return jsonb_build_object('code', 'NO_ABANDONER');
    end if;
    if m.status <> 'IN_PROGRESS' then
      return jsonb_build_object('code', 'NOT_COMPETITIVE', 'status', m.status);
    end if;
    score_a := case when m.closed_by = m.user_id then 0.0 else 1.0 end;

  elsif m.closed_reason is not null then
    return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);

  elsif m.status = 'DRAW' then
    score_a := 0.5;

  elsif m.status = 'COMPLETED' then
    if m.winner is null or m.winner not in ('A','B') then
      return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);
    end if;
    score_a := case when m.winner = 'A' then 1.0 else 0.0 end;

  else
    return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);
  end if;

  res_a := case when score_a = 1.0 then 'WIN' when score_a = 0.0 then 'LOSS' else 'DRAW' end;
  res_b := case when score_a = 1.0 then 'LOSS' when score_a = 0.0 then 'WIN' else 'DRAW' end;

  perform public.duel_pvp_ensure_rating(m.user_id);
  perform public.duel_pvp_ensure_rating(m.player_b_id);

  if exists (select 1 from public.duel_pvp_rating_events e where e.match_id = p_match) then
    return jsonb_build_object('code', 'ALREADY_SETTLED');
  end if;

  perform 1 from public.duel_pvp_ratings
   where user_id in (m.user_id, m.player_b_id) order by user_id for update;

  select * into ra from public.duel_pvp_ratings where user_id = m.user_id;
  select * into rb from public.duel_pvp_ratings where user_id = m.player_b_id;

  select * into s from public.competitive_active_season();

  k_a := public.duel_pvp_k_factor(ra.games_played);
  k_b := public.duel_pvp_k_factor(rb.games_played);

  -- Tope de pareja (solo con temporada activa: sus reglas mandan). Bajo las dos fichas bloqueadas.
  if s.id is not null then
    select count(*) into v_pair
      from public.duel_pvp_rating_events e
      join public.duel_matches dm on dm.id = e.match_id
     where e.user_id = m.user_id and e.rule = 'STANDARD'
       and e.created_at > now() - make_interval(hours => (s.config -> 'pairCap' ->> 'hours')::int)
       and ((dm.user_id = m.user_id and dm.player_b_id = m.player_b_id) or (dm.user_id = m.player_b_id and dm.player_b_id = m.user_id));
    if v_pair >= (s.config -> 'pairCap' ->> 'matches')::int then
      v_rule := 'PAIR_CAP'; k_a := 0; k_b := 0;
    end if;
    select coalesce(max(p.matches), 0) + 1 into num_a from public.competitive_season_players p where p.season_id = s.id and p.user_id = m.user_id;
    select coalesce(max(p.matches), 0) + 1 into num_b from public.competitive_season_players p where p.season_id = s.id and p.user_id = m.player_b_id;
  end if;

  delta_a := round(k_a * (score_a       - public.duel_pvp_expected_score(ra.rating, rb.rating)));
  delta_b := round(k_b * ((1 - score_a) - public.duel_pvp_expected_score(rb.rating, ra.rating)));

  new_a := least(5000, greatest(0, ra.rating + delta_a));
  new_b := least(5000, greatest(0, rb.rating + delta_b));
  delta_a := new_a - ra.rating;
  delta_b := new_b - rb.rating;

  -- `created_at` = hora REAL de escritura (clock_timestamp), tomada con las dos fichas bloqueadas: así el orden por fecha
  -- de los asientos de un jugador es el orden de su cadena aunque dos transacciones empezaran en otro orden (now() es
  -- la hora de INICIO de la transacción; medido en el ensayo con 10 liquidaciones concurrentes).
  insert into public.duel_pvp_rating_events
    (match_id, user_id, old_rating, delta, new_rating, opponent_rating, k_factor, result,
     formula_version, competitive_season_id, season_match_number, rule, created_at)
  values
    (p_match, ra.user_id, ra.rating, delta_a, new_a, rb.rating, k_a, res_a, v_formula, s.id, num_a, v_rule, clock_timestamp()),
    (p_match, rb.user_id, rb.rating, delta_b, new_b, ra.rating, k_b, res_b, v_formula, s.id, num_b, v_rule, clock_timestamp())
  on conflict (match_id, user_id) do nothing;
  get diagnostics inserted = row_count;

  if inserted <> 2 then
    return jsonb_build_object('code', 'ALREADY_SETTLED');
  end if;

  perform set_config('drl.rating_writer', 'settle', true);

  update public.duel_pvp_ratings
     set rating = new_a, games_played = games_played + 1,
         wins   = wins   + (case when res_a = 'WIN'  then 1 else 0 end),
         losses = losses + (case when res_a = 'LOSS' then 1 else 0 end),
         draws  = draws  + (case when res_a = 'DRAW' then 1 else 0 end)
   where user_id = ra.user_id;

  update public.duel_pvp_ratings
     set rating = new_b, games_played = games_played + 1,
         wins   = wins   + (case when res_b = 'WIN'  then 1 else 0 end),
         losses = losses + (case when res_b = 'LOSS' then 1 else 0 end),
         draws  = draws  + (case when res_b = 'DRAW' then 1 else 0 end)
   where user_id = rb.user_id;

  perform set_config('drl.rating_writer', '', true);

  if s.id is not null then
    perform public._competitive_season_record(s, ra.user_id, ra.rating, new_a, res_a, num_a);
    perform public._competitive_season_record(s, rb.user_id, rb.rating, new_b, res_b, num_b);
  end if;

  return jsonb_build_object(
    'code', 'SETTLED',
    'matchId', p_match,
    'cause', coalesce(m.closed_reason, 'FINISHED'),
    'season', s.id,
    'rule', v_rule,
    'formula', v_formula,
    'a', jsonb_build_object('userId', ra.user_id, 'oldRating', ra.rating, 'delta', delta_a,
                            'newRating', new_a, 'kFactor', k_a, 'result', res_a, 'seasonMatch', num_a),
    'b', jsonb_build_object('userId', rb.user_id, 'oldRating', rb.rating, 'delta', delta_b,
                            'newRating', new_b, 'kFactor', k_b, 'result', res_b, 'seasonMatch', num_b)
  );
end $$;

-- Récord de temporada de UN jugador tras una partida liquidada. Interna: solo la llama la liquidación, ya detrás de la
-- puerta del libro. `p_num` es el número de partida de temporada que se acaba de sellar en el asiento.
create or replace function public._competitive_season_record(
  s public.competitive_seasons, p_user uuid, p_old int, p_new int, p_result text, p_num int
) returns void language plpgsql security definer set search_path = public as $$
declare done boolean := p_num >= s.placement_games;
begin
  insert into public.competitive_season_players as c
    (season_id, user_id, matches, wins, losses, draws, seed_rating, placement_completed_at, peak_rating, peak_ranked_rating, last_match_at)
  values
    (s.id, p_user, 1,
     (p_result = 'WIN')::int, (p_result = 'LOSS')::int, (p_result = 'DRAW')::int,
     p_old, case when done then now() end, p_new, case when done then p_new end, now())
  on conflict (season_id, user_id) do update set
    matches = c.matches + 1,
    wins    = c.wins   + (p_result = 'WIN')::int,
    losses  = c.losses + (p_result = 'LOSS')::int,
    draws   = c.draws  + (p_result = 'DRAW')::int,
    peak_rating = greatest(c.peak_rating, p_new),
    placement_completed_at = coalesce(c.placement_completed_at, case when done then now() end),
    peak_ranked_rating = case when done then greatest(coalesce(c.peak_ranked_rating, p_new), p_new) else c.peak_ranked_rating end,
    last_match_at = now(),
    updated_at = now();
  -- El número sellado en el asiento DEBE coincidir con el contador: si no, algo escribió fuera de la puerta.
  if (select matches from public.competitive_season_players where season_id = s.id and user_id = p_user) <> p_num then
    raise exception 'COMPETITIVE_SEASON_DRIFT: récord de % desincronizado con el libro', p_user using errcode = 'P0001';
  end if;
end $$;

-- ── 10. PREPARADAS (no se ejecutan en F84) ────────────────────────────────────────────────────────────────

-- Foto final de una temporada TERMINADA. Determinista desde el libro inmutable: rating final = new_rating de la última
-- partida de temporada; puesto = orden de la clasificación con la actividad medida respecto al FINAL. Idempotente.
create or replace function public.competitive_season_close(p_season text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.competitive_seasons%rowtype; n int;
begin
  select * into s from public.competitive_seasons where id = p_season for update;
  if not found then return jsonb_build_object('code', 'NO_SEASON'); end if;
  if s.status <> 'PUBLISHED' then return jsonb_build_object('code', 'NOT_PUBLISHED'); end if;
  if s.ends_at is null or now() < s.ends_at then return jsonb_build_object('code', 'NOT_ENDED'); end if;
  insert into public.competitive_season_snapshots
    (season_id, user_id, rank_config_version, final_rating, peak_rating, peak_ranked_rating, matches, wins, losses, draws, placement_completed, final_position)
  select s.id, p.user_id, s.rank_config_version, f.new_rating, p.peak_rating, p.peak_ranked_rating, p.matches, p.wins, p.losses, p.draws,
         p.placement_completed_at is not null,
         case when el.pos is not null and el.pos <= (s.config -> 'top' ->> 'size')::int then el.pos end
    from public.competitive_season_players p
    join lateral (select e.new_rating, e.created_at from public.duel_pvp_rating_events e
                   where e.competitive_season_id = s.id and e.user_id = p.user_id
                   order by e.season_match_number desc limit 1) f on true
    left join (
      select q.user_id, row_number() over (order by fr.new_rating desc, fr.created_at asc, q.user_id asc) as pos
        from public.competitive_season_players q
        join lateral (select e.new_rating, e.created_at from public.duel_pvp_rating_events e
                       where e.competitive_season_id = s.id and e.user_id = q.user_id
                       order by e.season_match_number desc limit 1) fr on true
       where q.season_id = s.id and q.placement_completed_at is not null
         and q.matches >= (s.config -> 'top' ->> 'minSeasonMatches')::int
         and q.last_match_at >= s.ends_at - make_interval(days => (s.config -> 'top' ->> 'activeDays')::int)
    ) el on el.user_id = p.user_id
   where p.season_id = s.id
  on conflict (season_id, user_id) do nothing;
  get diagnostics n = row_count;
  if s.closed_at is null then update public.competitive_seasons set closed_at = now() where id = s.id; end if;
  return jsonb_build_object('code', 'CLOSED', 'season', s.id, 'snapshots', n);
end $$;

-- Reinicio SUAVE ledgerizado al abrir una temporada con `config.reset` = { baseline, factor }:
--   semilla = round(baseline + factor × (rating − baseline)), acotada a [0, 5000]. Un asiento por (temporada, jugador).
-- Solo para temporadas PUBLICADAS que ya empezaron (o empiezan en ≤ 1 h). Idempotente por índice único.
create or replace function public.competitive_season_seed(p_season text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.competitive_seasons%rowtype; r record; v_new int; n int := 0; ins int;
begin
  select * into s from public.competitive_seasons where id = p_season;
  if not found then return jsonb_build_object('code', 'NO_SEASON'); end if;
  if s.status <> 'PUBLISHED' then return jsonb_build_object('code', 'NOT_PUBLISHED'); end if;
  if s.config -> 'reset' is null or jsonb_typeof(s.config -> 'reset') = 'null' then return jsonb_build_object('code', 'NO_RESET'); end if;
  if now() < s.starts_at - interval '1 hour' then return jsonb_build_object('code', 'TOO_EARLY'); end if;
  perform set_config('drl.rating_writer', 'seed', true);
  for r in select user_id from public.duel_pvp_ratings where games_played > 0 order by user_id loop
    perform 1 from public.duel_pvp_ratings where user_id = r.user_id for update;
    select least(5000, greatest(0, round((s.config -> 'reset' ->> 'baseline')::int
             + (s.config -> 'reset' ->> 'factor')::numeric * (x.rating - (s.config -> 'reset' ->> 'baseline')::int))))::int
      into v_new from public.duel_pvp_ratings x where x.user_id = r.user_id;
    insert into public.competitive_rating_adjustments (user_id, season_id, reason, old_rating, delta, new_rating, formula_version, ref, note, created_at)
    select x.user_id, s.id, 'SEASON_SEED', x.rating, v_new - x.rating, v_new, s.formula_version,
           'seed:' || s.id || ':' || x.user_id, 'Reinicio suave de la temporada ' || s.name, clock_timestamp()
      from public.duel_pvp_ratings x where x.user_id = r.user_id
    on conflict do nothing;
    get diagnostics ins = row_count;
    if ins = 1 then
      update public.duel_pvp_ratings set rating = v_new where user_id = r.user_id;
      n := n + 1;
    end if;
  end loop;
  perform set_config('drl.rating_writer', '', true);
  return jsonb_build_object('code', 'SEEDED', 'season', s.id, 'players', n);
end $$;

-- Corrección AUDITADA de un rating (operación excepcional, sin botón en la interfaz): motivo obligatorio (≥ 10
-- caracteres), referencia única (idempotente), |delta| ≤ 500, asiento inmutable con el actor. No toca contadores.
create or replace function public.competitive_rating_correct(p_user uuid, p_delta int, p_note text, p_actor uuid, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.duel_pvp_ratings%rowtype; s public.competitive_seasons%rowtype; v_new int; ins int;
begin
  if p_note is null or length(btrim(p_note)) < 10 then return jsonb_build_object('code', 'REASON_REQUIRED'); end if;
  if p_ref is null or length(p_ref) < 6 then return jsonb_build_object('code', 'REF_REQUIRED'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 500 then return jsonb_build_object('code', 'DELTA_OUT_OF_RANGE'); end if;
  if exists (select 1 from public.competitive_rating_adjustments where ref = 'correct:' || p_ref) then
    return jsonb_build_object('code', 'ALREADY_APPLIED');
  end if;
  select * into v from public.duel_pvp_ratings where user_id = p_user for update;
  if not found then return jsonb_build_object('code', 'NO_RATING'); end if;
  select * into s from public.competitive_active_season();
  v_new := least(5000, greatest(0, v.rating + p_delta));
  insert into public.competitive_rating_adjustments (user_id, season_id, reason, old_rating, delta, new_rating, formula_version, ref, note, actor, created_at)
  values (p_user, s.id, 'ADMIN_CORRECTION', v.rating, v_new - v.rating, v_new, 'ranked-rating-v1', 'correct:' || p_ref, btrim(p_note), p_actor, clock_timestamp())
  on conflict (ref) do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then return jsonb_build_object('code', 'ALREADY_APPLIED'); end if;
  perform set_config('drl.rating_writer', 'correct', true);
  update public.duel_pvp_ratings set rating = v_new where user_id = p_user;
  perform set_config('drl.rating_writer', '', true);
  return jsonb_build_object('code', 'CORRECTED', 'oldRating', v.rating, 'newRating', v_new);
end $$;

-- ── 11. concesiones: solo el servidor ─────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'duel_pvp_settle_match(uuid)', 'competitive_active_season()',
    '_competitive_season_record(public.competitive_seasons,uuid,int,int,text,int)',
    'competitive_season_close(text)', 'competitive_season_seed(text)', 'competitive_rating_correct(uuid,int,text,uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke execute on function public._competitive_season_record(public.competitive_seasons,uuid,int,int,text,int) from service_role;

-- ── 12. Temporada competitiva 1 — frontera F84 ────────────────────────────────────────────────────────────
-- Empieza en el instante de aplicar la migración, abierta (sin final hasta programar la siguiente). Conserva TODOS los
-- ratings (sin reinicio): el rating histórico es la semilla oculta y la colocación (5 partidas) solo REVELA el rango.
-- Clasificación: colocación + ≥ 5 partidas de temporada + actividad en 14 días; tope de pareja: 5 partidas puntuadas/24 h.
insert into public.competitive_seasons (id, number, name, status, starts_at, ends_at, game_season_id, rank_config_version, formula_version, placement_games, config)
select 'competitiva-1', 1, 'Temporada competitiva 1', 'DRAFT', now(), null, null, 'rank-v1', 'ranked-rating-v1', 5,
       '{"top":{"size":500,"minSeasonMatches":5,"activeDays":14},"pairCap":{"matches":5,"hours":24},"reset":null}'::jsonb
 where not exists (select 1 from public.competitive_seasons where id = 'competitiva-1');
update public.competitive_seasons set status = 'PUBLISHED', published_at = now()
 where id = 'competitiva-1' and status = 'DRAFT';
