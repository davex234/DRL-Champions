-- ============================================================================
-- DRL CHAMPIONS — Sistema de sincronización competitiva (estilo VLR.gg)
-- ----------------------------------------------------------------------------
-- Extiende el DRL Data Engine (0002) con una jerarquía competitiva completa:
--   circuits → events (torneos) → stages (fases) → matches → match_maps →
--   map_player_stats, más clasificaciones (standings) y estadísticas agregadas
--   de equipo (team_stats) y jugador (player_event_stats).
--
-- Escalable a: VCT Internacional, Challengers, Game Changers, Ascension y
-- Tier 2/3 (campo `tier` en circuits/events).
--
-- Convenciones (igual que 0002): PK `text` con id estable de la fuente para
-- entidades externas; `uuid` para filas internas. RLS de LECTURA PÚBLICA en
-- todo el catálogo deportivo; la ESCRITURA la hace solo el backend con
-- service_role. Todo es idempotente y re-ejecutable.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. TAXONOMÍA: CIRCUITOS (nivel superior)
-- ============================================================================
-- Un circuito agrupa ediciones de torneo bajo un mismo "tier" del ecosistema.
create table if not exists public.circuits (
  id                text primary key,
  name              text not null,
  tier              text not null default 'vct-international'
                      check (tier in ('vct-international','challengers','game-changers',
                                      'ascension','tier2','tier3')),
  region            text,
  scope             text not null default 'regional'
                      check (scope in ('international','regional','national')),
  parent_circuit_id text references public.circuits(id) on delete set null,
  logo              text,
  color             text,
  updated_at        timestamptz not null default now()
);
create index if not exists circuits_tier_idx on public.circuits(tier);

-- ============================================================================
-- 2. ENRIQUECER TABLAS EXISTENTES DE 0002 (no destructivo)
-- ============================================================================

-- events == "torneo" (una edición concreta dentro de un circuito).
alter table public.events add column if not exists circuit_id text references public.circuits(id) on delete set null;
alter table public.events add column if not exists tier       text;
alter table public.events add column if not exists slug       text;
alter table public.events add column if not exists prize_pool bigint;
alter table public.events add column if not exists location   text;
alter table public.events add column if not exists country    text;
alter table public.events add column if not exists logo       text;
alter table public.events add column if not exists vlr_url    text;
alter table public.events add column if not exists updated_at timestamptz not null default now();
create index if not exists events_circuit_idx on public.events(circuit_id);
create index if not exists events_tier_status_idx on public.events(tier, status);

-- teams: datos de club.
alter table public.teams add column if not exists full_name     text;
alter table public.teams add column if not exists country       text;
alter table public.teams add column if not exists slug          text;
alter table public.teams add column if not exists color         text;
alter table public.teams add column if not exists world_ranking int;
alter table public.teams add column if not exists earnings      bigint;
alter table public.teams add column if not exists vlr_url       text;
alter table public.teams add column if not exists active        boolean not null default true;

-- players: datos de jugador profesional.
alter table public.players add column if not exists agents        jsonb not null default '[]'::jsonb;
alter table public.players add column if not exists vlr_url       text;
alter table public.players add column if not exists earnings      bigint;
alter table public.players add column if not exists twitter       text;
alter table public.players add column if not exists number        int;
alter table public.players add column if not exists is_substitute boolean not null default false;

-- ============================================================================
-- 3. FASES (grupos / swiss / playoffs dentro de un torneo)
-- ============================================================================
create table if not exists public.stages (
  id         uuid primary key default gen_random_uuid(),
  event_id   text not null references public.events(id) on delete cascade,
  slug       text not null,
  name       text not null,
  kind       text not null default 'playoff'
               check (kind in ('group','swiss','playoff','bracket','showmatch')),
  order_idx  int not null default 0,
  updated_at timestamptz not null default now(),
  unique (event_id, slug)
);
create index if not exists stages_event_idx on public.stages(event_id, order_idx);

-- ============================================================================
-- 4. REFERENCIA: AGENTES Y MAPAS DE VALORANT
-- ============================================================================
create table if not exists public.agents (
  id   text primary key,
  name text not null,
  role text not null check (role in ('duelist','initiator','sentinel','controller')),
  icon text
);

create table if not exists public.maps (
  id          text primary key,
  name        text not null,
  active_pool boolean not null default false
);

-- ============================================================================
-- 5. ENRIQUECER MATCHES (formato, fase, ronda, MVP, FKs a equipos)
-- ----------------------------------------------------------------------------
-- Se AÑADEN columnas con FK real (team_*_id) y se conservan las columnas
-- legacy team_a/team_b de 0002 como respaldo de visualización.
-- ============================================================================
alter table public.matches add column if not exists stage_id       uuid references public.stages(id) on delete set null;
alter table public.matches add column if not exists team_a_id      text references public.teams(id);
alter table public.matches add column if not exists team_b_id      text references public.teams(id);
alter table public.matches add column if not exists winner_team_id text references public.teams(id);
alter table public.matches add column if not exists format         text default 'bo3'
                                                     check (format in ('bo1','bo3','bo5'));
alter table public.matches add column if not exists best_of        int  not null default 3;
alter table public.matches add column if not exists round          text;
alter table public.matches add column if not exists match_order    int;
alter table public.matches add column if not exists mvp_player_id  text references public.players(id);
alter table public.matches add column if not exists patch          text;
alter table public.matches add column if not exists vod_url        text;
alter table public.matches add column if not exists vlr_url        text;
alter table public.matches add column if not exists created_at     timestamptz not null default now();
create index if not exists matches_event_time_idx  on public.matches(event_id, start_time);
create index if not exists matches_status_time_idx on public.matches(status, start_time);
create index if not exists matches_stage_idx       on public.matches(stage_id);

-- ============================================================================
-- 6. RESULTADO POR MAPA (un partido = N mapas según el formato)
-- ============================================================================
create table if not exists public.match_maps (
  id             uuid primary key default gen_random_uuid(),
  match_id       text not null references public.matches(id) on delete cascade,
  map_id         text references public.maps(id),
  map_order      int  not null default 1,
  score_a        int,                       -- rondas del equipo team_a del partido
  score_b        int,                       -- rondas del equipo team_b del partido
  winner_team_id text references public.teams(id),
  picked_by      text references public.teams(id),  -- veto: quién eligió el mapa
  side_start     text,                      -- 'attack' | 'defense' (team_a)
  duration       int,                       -- segundos
  created_at     timestamptz not null default now(),
  unique (match_id, map_order)
);
create index if not exists match_maps_match_idx on public.match_maps(match_id);

-- ============================================================================
-- 7. SCOREBOARD POR MAPA Y JUGADOR (estadística granular estilo VLR)
-- ============================================================================
create table if not exists public.map_player_stats (
  id           uuid primary key default gen_random_uuid(),
  match_map_id uuid not null references public.match_maps(id) on delete cascade,
  match_id     text not null references public.matches(id) on delete cascade,
  player_id    text references public.players(id),
  team_id      text references public.teams(id),
  agent_id     text references public.agents(id),
  acs          numeric,
  kills        int,
  deaths       int,
  assists      int,
  kast         numeric,   -- %
  adr          numeric,   -- daño medio por ronda
  hs_pct       numeric,   -- % headshots
  fk           int,       -- first kills
  fd           int,       -- first deaths
  clutches     int,
  plus_minus   int,       -- kills - deaths
  rating       numeric,   -- rating estilo VLR 2.0
  created_at   timestamptz not null default now(),
  unique (match_map_id, player_id)
);
create index if not exists mps_match_idx  on public.map_player_stats(match_id);
create index if not exists mps_player_idx on public.map_player_stats(player_id);

-- ============================================================================
-- 8. ESTADÍSTICA AGREGADA POR PARTIDO Y JUGADOR (enriquecer player_stats de 0002)
-- ============================================================================
alter table public.player_stats add column if not exists team_id     text references public.teams(id);
alter table public.player_stats add column if not exists agent_id    text references public.agents(id);
alter table public.player_stats add column if not exists adr         numeric;
alter table public.player_stats add column if not exists kd          numeric;
alter table public.player_stats add column if not exists fk          int;
alter table public.player_stats add column if not exists fd          int;
alter table public.player_stats add column if not exists rating      numeric;
alter table public.player_stats add column if not exists plus_minus  int;
alter table public.player_stats add column if not exists maps_played int;
alter table public.player_stats add column if not exists rounds      int;
-- Unicidad (match, player): clave para upsert idempotente del sync.
create unique index if not exists player_stats_match_player_uidx
  on public.player_stats(match_id, player_id);
create index if not exists player_stats_player_idx on public.player_stats(player_id);

-- ============================================================================
-- 9. CLASIFICACIONES (por fase; '__overall__' = global del torneo)
-- ============================================================================
create table if not exists public.standings (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null references public.events(id) on delete cascade,
  stage_id    uuid references public.stages(id) on delete cascade,
  stage_key   text generated always as (coalesce(stage_id::text, '__overall__')) stored,
  team_id     text not null references public.teams(id),
  position    int,
  wins        int  not null default 0,
  losses      int  not null default 0,
  ties        int  not null default 0,
  maps_won    int  not null default 0,
  maps_lost   int  not null default 0,
  map_diff    int  generated always as (maps_won - maps_lost) stored,
  rounds_won  int  not null default 0,
  rounds_lost int  not null default 0,
  round_diff  int  generated always as (rounds_won - rounds_lost) stored,
  points      int  not null default 0,
  group_label text,
  status      text not null default 'active'
                check (status in ('active','qualified','eliminated')),
  updated_at  timestamptz not null default now(),
  unique (event_id, stage_key, team_id)
);
create index if not exists standings_event_stage_idx on public.standings(event_id, stage_key);

-- ============================================================================
-- 10. ESTADÍSTICAS AGREGADAS DE EQUIPO
-- ----------------------------------------------------------------------------
-- event_id NULL ⇒ agregado global; columna generada event_key garantiza la
-- unicidad porque NULL no es comparable en restricciones UNIQUE.
-- ============================================================================
create table if not exists public.team_stats (
  id              uuid primary key default gen_random_uuid(),
  team_id         text not null references public.teams(id) on delete cascade,
  event_id        text references public.events(id) on delete cascade,
  event_key       text generated always as (coalesce(event_id, '__global__')) stored,
  scope           text not null default 'tournament'
                    check (scope in ('tournament','season','global')),
  matches_played  int not null default 0,
  matches_won     int not null default 0,
  matches_lost    int not null default 0,
  maps_played     int not null default 0,
  maps_won        int not null default 0,
  maps_lost       int not null default 0,
  rounds_won      int not null default 0,
  rounds_lost     int not null default 0,
  attack_win_pct  numeric,
  defense_win_pct numeric,
  pistol_win_pct  numeric,
  updated_at      timestamptz not null default now(),
  unique (team_id, event_key, scope)
);
create index if not exists team_stats_team_idx on public.team_stats(team_id);

-- ============================================================================
-- 11. ESTADÍSTICAS AGREGADAS DE JUGADOR POR TORNEO (leaderboards individuales)
-- ============================================================================
create table if not exists public.player_event_stats (
  id          uuid primary key default gen_random_uuid(),
  player_id   text not null references public.players(id) on delete cascade,
  event_id    text not null references public.events(id) on delete cascade,
  rating      numeric,
  acs         numeric,
  kd          numeric,
  adr         numeric,
  kast        numeric,
  hs_pct      numeric,
  fk_per_map  numeric,
  maps        int not null default 0,
  rounds      int not null default 0,
  mvp_count   int not null default 0,
  updated_at  timestamptz not null default now(),
  unique (player_id, event_id)
);
create index if not exists pes_player_idx on public.player_event_stats(player_id);
create index if not exists pes_event_idx  on public.player_event_stats(event_id);

-- ============================================================================
-- 12. HISTORIAL DE PLANTILLAS (transferencias)
-- ============================================================================
create table if not exists public.roster_changes (
  id        uuid primary key default gen_random_uuid(),
  team_id   text not null references public.teams(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  role      text,
  joined_at timestamptz,
  left_at   timestamptz,
  is_active boolean not null default true
);
create index if not exists roster_team_idx on public.roster_changes(team_id) where is_active;

-- ============================================================================
-- 13. ESTADO DE SINCRONIZACIÓN (control incremental por fuente/entidad)
-- ============================================================================
create table if not exists public.sync_state (
  id             text primary key,           -- p.ej. 'vlr:matches', 'vlr:event:xxxx'
  last_synced_at timestamptz,
  cursor         text,
  status         text not null default 'idle'
                   check (status in ('idle','running','ok','error')),
  error          text,
  updated_at     timestamptz not null default now()
);

-- ============================================================================
-- 14. TRIGGERS updated_at (reutiliza public.touch_updated_at de 0001)
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array[
    'circuits','events','teams','stages','standings','team_stats',
    'player_event_stats','sync_state'
  ] loop
    execute format('drop trigger if exists %s_touch on public.%I;', t, t);
    execute format(
      'create trigger %s_touch before update on public.%I
         for each row execute function public.touch_updated_at();', t, t);
  end loop;
end $$;

-- ============================================================================
-- 15. RLS: lectura pública del catálogo deportivo; escritura solo service_role
-- ============================================================================
alter table public.circuits           enable row level security;
alter table public.stages             enable row level security;
alter table public.agents             enable row level security;
alter table public.maps               enable row level security;
alter table public.match_maps         enable row level security;
alter table public.map_player_stats   enable row level security;
alter table public.standings          enable row level security;
alter table public.team_stats         enable row level security;
alter table public.player_event_stats enable row level security;
alter table public.roster_changes     enable row level security;
alter table public.sync_state         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'circuits','stages','agents','maps','match_maps','map_player_stats',
    'standings','team_stats','player_event_stats','roster_changes'
  ] loop
    execute format('drop policy if exists "lectura publica %s" on public.%I;', t, t);
    execute format(
      'create policy "lectura publica %s" on public.%I for select using (true);', t, t);
  end loop;
end $$;
-- sync_state: sin políticas de cliente (solo service_role lo lee/escribe).

-- ============================================================================
-- 16. FUNCIONES DE RECÁLCULO (agregación en la base de datos; escalable)
-- ----------------------------------------------------------------------------
-- Llamadas por el backend tras ingerir resultados. Solo service_role puede
-- ejecutarlas (se revoca a public/anon/authenticated).
-- ============================================================================

-- 16.1 Clasificaciones por fase a partir de partidos finalizados.
create or replace function public.recompute_standings(p_event_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.standings where event_id = p_event_id;

  insert into public.standings (
    event_id, stage_id, team_id, position,
    wins, losses, maps_won, maps_lost, rounds_won, rounds_lost, points)
  with finished as (
    select * from public.matches
     where event_id = p_event_id and status = 'finished'
       and team_a_id is not null and team_b_id is not null
  ),
  perteam as (
    select f.stage_id, f.team_a_id as team_id,
           (f.winner_team_id = f.team_a_id)::int as win,
           (f.winner_team_id is not null and f.winner_team_id <> f.team_a_id)::int as loss,
           coalesce(f.score_a,0) as maps_for, coalesce(f.score_b,0) as maps_against,
           coalesce(r.r_a,0) as rounds_for, coalesce(r.r_b,0) as rounds_against
      from finished f
      left join lateral (
        select sum(score_a) r_a, sum(score_b) r_b
          from public.match_maps where match_id = f.id
      ) r on true
    union all
    select f.stage_id, f.team_b_id,
           (f.winner_team_id = f.team_b_id)::int,
           (f.winner_team_id is not null and f.winner_team_id <> f.team_b_id)::int,
           coalesce(f.score_b,0), coalesce(f.score_a,0),
           coalesce(r.r_b,0), coalesce(r.r_a,0)
      from finished f
      left join lateral (
        select sum(score_a) r_a, sum(score_b) r_b
          from public.match_maps where match_id = f.id
      ) r on true
  ),
  agg as (
    select stage_id, team_id,
           coalesce(sum(win),0) wins, coalesce(sum(loss),0) losses,
           coalesce(sum(maps_for),0) maps_won, coalesce(sum(maps_against),0) maps_lost,
           coalesce(sum(rounds_for),0) rounds_won, coalesce(sum(rounds_against),0) rounds_lost,
           coalesce(sum(win),0) * 3 as points
      from perteam
     group by stage_id, team_id
  ),
  ranked as (
    select *, row_number() over (
             partition by stage_id
             order by points desc, (maps_won - maps_lost) desc,
                      (rounds_won - rounds_lost) desc) as position
      from agg
  )
  select p_event_id, stage_id, team_id, position,
         wins, losses, maps_won, maps_lost, rounds_won, rounds_lost, points
    from ranked;
end; $$;

-- 16.2 Estadísticas agregadas de un equipo en un torneo.
create or replace function public.recompute_team_stats(p_team_id text, p_event_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.team_stats
   where team_id = p_team_id and scope = 'tournament'
     and event_id is not distinct from p_event_id;

  insert into public.team_stats (
    team_id, event_id, scope, matches_played, matches_won, matches_lost,
    maps_played, maps_won, maps_lost, rounds_won, rounds_lost)
  with f as (
    select * from public.matches
     where event_id = p_event_id and status = 'finished'
       and (team_a_id = p_team_id or team_b_id = p_team_id)
  ),
  perteam as (
    select (winner_team_id = p_team_id)::int win,
           (winner_team_id is not null and winner_team_id <> p_team_id)::int loss,
           case when team_a_id = p_team_id then coalesce(score_a,0) else coalesce(score_b,0) end maps_for,
           case when team_a_id = p_team_id then coalesce(score_b,0) else coalesce(score_a,0) end maps_against
      from f
  ),
  rnd as (
    select coalesce(sum(case when m.team_a_id = p_team_id then mm.score_a else mm.score_b end),0) rounds_for,
           coalesce(sum(case when m.team_a_id = p_team_id then mm.score_b else mm.score_a end),0) rounds_against
      from f m join public.match_maps mm on mm.match_id = m.id
  )
  select p_team_id, p_event_id, 'tournament',
         (select count(*) from f),
         coalesce((select sum(win)  from perteam),0),
         coalesce((select sum(loss) from perteam),0),
         coalesce((select sum(maps_for + maps_against) from perteam),0),
         coalesce((select sum(maps_for) from perteam),0),
         coalesce((select sum(maps_against) from perteam),0),
         (select rounds_for from rnd),
         (select rounds_against from rnd)
  where exists (select 1 from f);
end; $$;

-- 16.3 Estadísticas individuales agregadas por torneo (desde el scoreboard).
create or replace function public.recompute_player_event_stats(p_event_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.player_event_stats where event_id = p_event_id;

  insert into public.player_event_stats (
    player_id, event_id, rating, acs, kd, adr, kast, hs_pct,
    fk_per_map, maps, mvp_count)
  with mps as (
    select s.* from public.map_player_stats s
      join public.matches m on m.id = s.match_id
     where m.event_id = p_event_id and s.player_id is not null
  ),
  agg as (
    select player_id,
           avg(rating) rating, avg(acs) acs,
           sum(kills)::numeric / nullif(sum(deaths),0) kd,
           avg(adr) adr, avg(kast) kast, avg(hs_pct) hs_pct,
           sum(fk)::numeric / nullif(count(*),0) fk_per_map,
           count(*) maps
      from mps group by player_id
  ),
  mvp as (
    select mvp_player_id pid, count(*) c from public.matches
     where event_id = p_event_id and mvp_player_id is not null
     group by mvp_player_id
  )
  select a.player_id, p_event_id,
         round(a.rating,2), round(a.acs,1), round(a.kd,2), round(a.adr,1),
         round(a.kast,1), round(a.hs_pct,1), round(a.fk_per_map,2),
         a.maps, coalesce(mv.c,0)
    from agg a left join mvp mv on mv.pid = a.player_id;
end; $$;

revoke all on function public.recompute_standings(text)          from public;
revoke all on function public.recompute_team_stats(text, text)   from public;
revoke all on function public.recompute_player_event_stats(text) from public;
grant execute on function public.recompute_standings(text)          to service_role;
grant execute on function public.recompute_team_stats(text, text)   to service_role;
grant execute on function public.recompute_player_event_stats(text) to service_role;

-- ============================================================================
-- 17. VISTAS DE CONVENIENCIA (lectura pública vía RLS de las tablas base)
-- ============================================================================
create or replace view public.v_upcoming_matches as
  select m.id, m.event_id, e.name as event_name, m.stage_id, m.start_time,
         m.format, m.round, m.team_a_id, m.team_b_id,
         ta.name as team_a_name, tb.name as team_b_name
    from public.matches m
    left join public.events e  on e.id  = m.event_id
    left join public.teams  ta on ta.id = m.team_a_id
    left join public.teams  tb on tb.id = m.team_b_id
   where m.status in ('upcoming','live')
   order by m.start_time asc;

create or replace view public.v_recent_results as
  select m.id, m.event_id, e.name as event_name, m.start_time,
         m.team_a_id, m.team_b_id, m.score_a, m.score_b, m.winner_team_id,
         m.mvp_player_id
    from public.matches m
    left join public.events e on e.id = m.event_id
   where m.status = 'finished'
   order by m.start_time desc;

create or replace view public.v_player_leaderboard as
  select pes.event_id, pes.player_id, p.nick, p.team_id,
         pes.rating, pes.acs, pes.kd, pes.adr, pes.kast, pes.maps, pes.mvp_count
    from public.player_event_stats pes
    left join public.players p on p.id = pes.player_id
   order by pes.rating desc nulls last;

-- ============================================================================
-- 18. SEEDS DE REFERENCIA (idempotentes)
-- ============================================================================

-- 18.1 Agentes de Valorant.
insert into public.agents (id, name, role) values
  ('jett','Jett','duelist'),('raze','Raze','duelist'),('phoenix','Phoenix','duelist'),
  ('reyna','Reyna','duelist'),('yoru','Yoru','duelist'),('neon','Neon','duelist'),
  ('iso','Iso','duelist'),('waylay','Waylay','duelist'),
  ('sova','Sova','initiator'),('breach','Breach','initiator'),('skye','Skye','initiator'),
  ('kayo','KAY/O','initiator'),('fade','Fade','initiator'),('gekko','Gekko','initiator'),
  ('tejo','Tejo','initiator'),
  ('killjoy','Killjoy','sentinel'),('cypher','Cypher','sentinel'),('sage','Sage','sentinel'),
  ('chamber','Chamber','sentinel'),('deadlock','Deadlock','sentinel'),('vyse','Vyse','sentinel'),
  ('brimstone','Brimstone','controller'),('omen','Omen','controller'),('viper','Viper','controller'),
  ('astra','Astra','controller'),('harbor','Harbor','controller'),('clove','Clove','controller')
on conflict (id) do nothing;

-- 18.2 Mapas (active_pool aproximado; ajustable por acto).
insert into public.maps (id, name, active_pool) values
  ('ascent','Ascent',true),('bind','Bind',true),('haven','Haven',true),
  ('split','Split',true),('lotus','Lotus',true),('sunset','Sunset',true),
  ('abyss','Abyss',true),('corrode','Corrode',true),
  ('breeze','Breeze',false),('fracture','Fracture',false),
  ('pearl','Pearl',false),('icebox','Icebox',false)
on conflict (id) do nothing;

-- 18.3 Circuitos base (editables; cubren los tiers solicitados).
insert into public.circuits (id, name, tier, region, scope) values
  ('vct-emea','VCT EMEA','vct-international','EMEA','international'),
  ('vct-americas','VCT Americas','vct-international','Americas','international'),
  ('vct-pacific','VCT Pacific','vct-international','Pacific','international'),
  ('vct-china','VCT China','vct-international','China','international'),
  ('vct-masters','VCT Masters','vct-international',null,'international'),
  ('vct-champions','Valorant Champions','vct-international',null,'international'),
  ('ewc','Esports World Cup','vct-international',null,'international'),
  ('challengers-es','Challengers España','challengers','EMEA','national'),
  ('game-changers-emea','Game Changers EMEA','game-changers','EMEA','international'),
  ('ascension-emea','Challengers Ascension EMEA','ascension','EMEA','international')
on conflict (id) do nothing;
