-- ============================================================================
-- DRL CHAMPIONS — Generación automática de cartas por torneos (autoría admin)
-- ----------------------------------------------------------------------------
-- El administrador crea torneos, gestiona equipos/jugadores y, al finalizarlos
-- (o al eliminar un equipo), el CardGenerationEngine genera cartas según un
-- MOTOR DE RAREZA configurable en BD (rating→tier→variante/accolade), con cartas
-- especiales MVP (MYTHIC) y Champion (CHAMPION). Las cartas se integran al
-- catálogo jugable (variantes nuevas) y quedan poseíbles/abribles en sobres.
--
-- El módulo gira en torno a los ids del CATÁLOGO DEL JUEGO (no a la población
-- VLR): por eso player_id/team_id son `text` sin FK a las tablas esports.
--
-- Escritura: SOLO vía la ruta admin con service_role (verifica profiles.is_admin).
-- Lectura: RLS pública. Idempotente. Reutiliza touch_updated_at (0001).
-- ============================================================================

create extension if not exists pgcrypto;

-- Gate de administrador (bootstrap por SQL: update profiles set is_admin=true ...).
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- ============================================================================
-- 1. TORNEOS (autoría admin) + participantes
-- ============================================================================
create table if not exists public.tournaments (
  id             text primary key,
  name           text not null,
  region         text,
  tier           text,
  status         text not null default 'upcoming' check (status in ('upcoming','live','finished')),
  event_id       text references public.events(id) on delete set null,  -- enlace opcional al competitivo
  winner_team_id text,
  start_date     timestamptz,
  end_date       timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.tournament_teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments(id) on delete cascade,
  team_id       text not null,
  team_name     text,
  placement     int,
  status        text not null default 'active' check (status in ('active','eliminated','champion')),
  eliminated_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (tournament_id, team_id)
);

create table if not exists public.tournament_players (
  id            uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments(id) on delete cascade,
  team_id       text,
  player_id     text not null,          -- id del catálogo del juego
  nick          text,
  rating        numeric,                -- alimenta el motor de rareza
  acs           numeric,
  kd            numeric,
  kast          numeric,
  maps          int,
  is_mvp        boolean not null default false,
  stats         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (tournament_id, player_id)
);
create index if not exists tournament_players_player_idx on public.tournament_players(player_id);

-- ============================================================================
-- 2. MOTOR DE RAREZA CONFIGURABLE (editable sin tocar código)
-- ============================================================================
create table if not exists public.card_generation_rules (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'rating' check (kind in ('rating','mvp','champion')),
  tier       text not null,                 -- comun|rara|epica|legendaria|mythic|champion
  label      text not null,
  min_rating numeric,                        -- solo kind='rating'
  accolade   text,                           -- AccoladeId a conceder ('' = solo carta base)
  color      text,
  priority   int not null default 0,         -- orden de evaluación (mayor primero)
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tier)
);
create index if not exists card_rules_eval_idx on public.card_generation_rules(active, priority desc);

-- ============================================================================
-- 3. CARTAS GENERADAS + ESPECIALES + HISTORIAL
-- ============================================================================
create table if not exists public.card_generations (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     text not null references public.tournaments(id) on delete cascade,
  trigger           text not null check (trigger in ('finish','team_eliminated')),
  team_id           text,
  cards_generated   int not null default 0,
  special_generated int not null default 0,
  status            text not null default 'ok' check (status in ('ok','error')),
  detail            jsonb not null default '{}'::jsonb,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
create index if not exists card_generations_tourn_idx on public.card_generations(tournament_id, created_at desc);

create table if not exists public.card_photos (
  id              uuid primary key default gen_random_uuid(),
  player_id       text not null,
  url             text not null,
  source          text not null check (source in ('riot_media','event_official','social','broadcast_frame','manual')),
  captured_at     timestamptz,
  quality         int,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  priority        int not null default 0,     -- derivada de la fuente (riot_media alto)
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists card_photos_player_idx on public.card_photos(player_id, approval_status, priority desc);

create table if not exists public.player_cards (
  id            uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments(id) on delete cascade,
  player_id     text not null,
  team_id       text,
  rarity_tier   text,
  accolade      text,
  variant_id    text not null,
  card_id       text not null,               -- `${playerId}__${variantId}` (catálogo jugable)
  ovr           int,
  rating        numeric,
  stats         jsonb not null default '{}'::jsonb,
  photo_id      uuid references public.card_photos(id) on delete set null,
  generation_id uuid references public.card_generations(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (tournament_id, player_id, variant_id)
);
create index if not exists player_cards_tourn_idx on public.player_cards(tournament_id);
create index if not exists player_cards_player_idx on public.player_cards(player_id);

create table if not exists public.special_cards (
  id            uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments(id) on delete cascade,
  kind          text not null check (kind in ('mvp','champion')),
  player_id     text not null,
  team_id       text,
  rarity_tier   text,
  accolade      text,
  variant_id    text not null,
  card_id       text not null,
  stats         jsonb not null default '{}'::jsonb,
  photo_id      uuid references public.card_photos(id) on delete set null,
  generation_id uuid references public.card_generations(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists special_cards_tourn_idx on public.special_cards(tournament_id);
-- Un solo MVP por torneo; Champion: uno por jugador del equipo ganador.
create unique index if not exists special_cards_mvp_uniq on public.special_cards(tournament_id) where kind = 'mvp';
create unique index if not exists special_cards_champ_uniq on public.special_cards(tournament_id, player_id) where kind = 'champion';

-- ============================================================================
-- 4. TRIGGERS updated_at (reutiliza public.touch_updated_at de 0001)
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['tournaments','card_generation_rules','card_photos'] loop
    execute format('drop trigger if exists %s_touch on public.%I;', t, t);
    execute format(
      'create trigger %s_touch before update on public.%I
         for each row execute function public.touch_updated_at();', t, t);
  end loop;
end $$;

-- ============================================================================
-- 5. RLS: lectura pública; escritura solo service_role (ruta admin)
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['tournaments','tournament_teams','tournament_players',
    'card_generation_rules','card_generations','card_photos','player_cards','special_cards'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "lectura publica %s" on public.%I;', t, t);
    execute format('create policy "lectura publica %s" on public.%I for select using (true);', t, t);
  end loop;
end $$;

-- ============================================================================
-- 6. SEED del motor de rareza (umbrales del usuario + cartas especiales)
-- ============================================================================
insert into public.card_generation_rules (kind, tier, label, min_rating, accolade, color, priority) values
  ('rating', 'legendaria', 'Legendaria', 1.30, 'masters-mvp',          '#ffd35c', 40),
  ('rating', 'epica',      'Épica',      1.20, 'prime',                '#7b5cff', 30),
  ('rating', 'rara',       'Rara',       1.10, 'masters',              '#19e3ff', 20),
  ('rating', 'comun',      'Común',      0.00, '',                     '#c8d2dc', 10),
  ('mvp',     'mythic',    'MVP · MYTHIC',   null, 'tournament-mvp',      '#ff2e63', 100),
  ('champion','champion',  'Champion Edition', null, 'tournament-champion', '#ffe08a', 90)
on conflict (tier) do nothing;
