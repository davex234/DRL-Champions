-- ============================================================================
-- DRL CHAMPIONS — Collection Engine (colección por torneo + premios)
-- ----------------------------------------------------------------------------
-- Cada torneo genera una COLECCIÓN: todos los jugadores + premios (Champion,
-- MVP, Rookie, Clutch, Top ACS/Rating/HS%/Kills/Assist). La colección lleva
-- progreso/porcentaje (se calcula en cliente sobre las cartas poseídas) y una
-- recompensa exclusiva al completarse.
--
-- Extiende 0006: añade métricas de premio a `tournament_players`, abre el
-- `kind` de `special_cards` a los premios (un premio por torneo) y crea
-- `collections` + `collection_items` (miembros de la colección).
--
-- RLS: lectura pública; escritura solo service_role (ruta admin). Idempotente.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. Métricas de premio en tournament_players (alimentan computeAwards)
-- ============================================================================
alter table public.tournament_players add column if not exists kills     numeric;
alter table public.tournament_players add column if not exists assists   numeric;
alter table public.tournament_players add column if not exists hs_pct    numeric;
alter table public.tournament_players add column if not exists clutch    numeric;
alter table public.tournament_players add column if not exists is_rookie boolean not null default false;

-- ============================================================================
-- 2. special_cards: admitir los 7 premios + un único premio por torneo/kind
-- ============================================================================
alter table public.special_cards drop constraint if exists special_cards_kind_check;
alter table public.special_cards add constraint special_cards_kind_check
  check (kind in ('mvp','champion','rookie','clutch',
                  'top-acs','top-rating','top-hs','top-kills','top-assist'));

create unique index if not exists special_cards_award_uniq
  on public.special_cards (tournament_id, kind)
  where kind in ('rookie','clutch','top-acs','top-rating','top-hs','top-kills','top-assist');

-- ============================================================================
-- 3. Colecciones + miembros
-- ============================================================================
create table if not exists public.collections (
  id            uuid primary key default gen_random_uuid(),
  tournament_id text unique,                 -- 1 torneo → 1 colección (null = no-torneo)
  slug          text not null unique,
  name          text not null,
  tier          text,
  region        text,
  reward        jsonb not null default '{}'::jsonb,   -- Reward (créditos/xp/tokens/pack/carta)
  total_items   int   not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.collection_items (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  card_id       text not null,
  player_id     text,
  category      text not null default 'player',   -- player | mvp | champion | <award kind>
  label         text,
  accolade      text,
  variant_id    text,
  ovr           int,
  created_at    timestamptz not null default now(),
  unique (collection_id, card_id)
);
create index if not exists collection_items_coll_idx on public.collection_items(collection_id);
create index if not exists collection_items_player_idx on public.collection_items(player_id);

-- ============================================================================
-- 4. updated_at (reutiliza public.touch_updated_at de 0001)
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists collections_touch on public.collections;
create trigger collections_touch before update on public.collections
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- 5. RLS: lectura pública; escritura solo service_role
-- ============================================================================
alter table public.collections      enable row level security;
alter table public.collection_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['collections','collection_items'] loop
    execute format('drop policy if exists "lectura publica %s" on public.%I;', t, t);
    execute format('create policy "lectura publica %s" on public.%I for select using (true);', t, t);
  end loop;
end $$;
