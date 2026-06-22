-- ============================================================================
-- DRL CHAMPIONS — DRL Data Engine (tablas de ingesta y generación automática)
-- Pensado para que un proceso de servidor (cron / edge function) ejecute el
-- pipeline y persista aquí. El cliente solo LEE (RLS de lectura pública en lo
-- no sensible); la escritura la hace el backend con service_role.
-- ============================================================================

create table if not exists public.teams (
  id        text primary key,
  name      text not null,
  tag       text,
  region    text,
  logo      text,
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id        text primary key,
  nick      text not null,
  full_name text,
  team_id   text references public.teams(id),
  region    text,
  role      text,
  country   text,
  image     text,
  status    text not null default 'active',
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id        text primary key,
  name      text not null,
  type      text not null,
  region    text,
  status    text not null default 'upcoming',
  start_date timestamptz,
  end_date   timestamptz,
  source    text not null default 'vlr',
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id          text primary key,
  event_id    text references public.events(id) on delete cascade,
  team_a      text,
  team_b      text,
  start_time  timestamptz,
  status      text not null default 'upcoming',
  score_a     int,
  score_b     int,
  winner_team text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.player_stats (
  id        uuid primary key default gen_random_uuid(),
  match_id  text references public.matches(id) on delete cascade,
  player_id text references public.players(id),
  acs int, kills int, deaths int, assists int, hs_pct numeric, clutches int, kast numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.generated_cards (
  id          uuid primary key default gen_random_uuid(),
  event_id    text references public.events(id) on delete cascade,
  player_id   text,
  kind        text not null,         -- series | winner | mvp | icon | prime
  accolade    text not null,
  serial_limit int,
  confidence  numeric not null,
  issues      jsonb not null default '[]'::jsonb,
  status      text not null default 'pending', -- pending | applied | rejected
  created_at  timestamptz not null default now()
);

create table if not exists public.generated_events (
  id        text primary key,
  event_id  text references public.events(id) on delete cascade,
  spec      jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id        uuid primary key default gen_random_uuid(),
  code      text not null,
  level     text not null,
  message   text not null,
  sent_telegram boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.scheduler_jobs (
  id        uuid primary key default gen_random_uuid(),
  kind      text not null,           -- sync | monitor_match | process_tournament
  run_at    timestamptz not null,
  payload   jsonb,
  status    text not null default 'scheduled',
  label     text,
  created_at timestamptz not null default now()
);
create index if not exists jobs_due_idx on public.scheduler_jobs(status, run_at);

-- Predicciones Pick'em por usuario.
create table if not exists public.pickems (
  user_id   uuid references auth.users(id) on delete cascade,
  match_id  text references public.matches(id) on delete cascade,
  pick      text not null,
  resolved  boolean not null default false,
  correct   boolean,
  created_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

-- ============================================================================
-- RLS: lectura pública del catálogo deportivo; escritura solo backend.
-- ============================================================================
alter table public.teams           enable row level security;
alter table public.players         enable row level security;
alter table public.events          enable row level security;
alter table public.matches         enable row level security;
alter table public.player_stats    enable row level security;
alter table public.generated_cards enable row level security;
alter table public.generated_events enable row level security;
alter table public.scheduler_jobs  enable row level security;
alter table public.notifications   enable row level security;
alter table public.pickems         enable row level security;

create policy "lectura publica teams"      on public.teams           for select using (true);
create policy "lectura publica players"     on public.players         for select using (true);
create policy "lectura publica events"      on public.events          for select using (true);
create policy "lectura publica matches"     on public.matches         for select using (true);
create policy "lectura publica stats"       on public.player_stats    for select using (true);
create policy "lectura publica gen_cards"   on public.generated_cards for select using (true);
create policy "lectura publica gen_events"  on public.generated_events for select using (true);

-- Pick'ems: cada usuario gestiona los suyos.
create policy "tus pickems" on public.pickems
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- notifications / scheduler_jobs: sin políticas de cliente (solo service_role).
