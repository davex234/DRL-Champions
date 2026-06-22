-- ============================================================================
-- DRL CHAMPIONS — Esquema inicial (Supabase / Postgres)
-- Plataforma online multiusuario. Toda operación crítica (mercado, créditos)
-- se valida en el servidor mediante funciones SECURITY DEFINER. RLS protege
-- cada fila por usuario. NO se confía en el cliente.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- PERFILES (Usuarios · Créditos · Niveles) + columnas denormalizadas de ranking
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  username         text unique not null,
  avatar           text default '🎮',
  level            int  not null default 1,
  xp               int  not null default 0,
  credits          bigint not null default 6000,
  tokens           bigint not null default 0,
  -- denormalizado para rankings eficientes
  collection_value bigint not null default 0,
  distinct_cards   int    not null default 0,
  rarest_rank      int    not null default 0,
  market_volume    bigint not null default 0,
  packs_opened     int    not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ESTADO DE JUEGO (Inventario · Colección · Eventos · Logros) como snapshot
-- JSONB del motor local. Permite migración progresiva sin romper mecánicas.
-- ----------------------------------------------------------------------------
create table if not exists public.game_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- INVENTARIO autoritativo en servidor (cartas disponibles para el mercado real)
-- ----------------------------------------------------------------------------
create table if not exists public.inventory (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  card_id     text not null,
  serial      int,
  obtained_at timestamptz not null default now()
);
create index if not exists inventory_user_idx on public.inventory(user_id);

-- ----------------------------------------------------------------------------
-- MERCADO (jugador ↔ jugador)
-- ----------------------------------------------------------------------------
create table if not exists public.market_listings (
  id         uuid primary key default gen_random_uuid(),
  seller_id  uuid not null references auth.users(id) on delete cascade,
  card_id    text not null,
  serial     int,
  price      bigint not null check (price > 0),
  status     text not null default 'active' check (status in ('active','sold','cancelled')),
  buyer_id   uuid references auth.users(id),
  created_at timestamptz not null default now(),
  sold_at    timestamptz
);
create index if not exists listings_active_idx on public.market_listings(status, created_at desc);
create index if not exists listings_card_idx on public.market_listings(card_id) where status = 'active';

-- ----------------------------------------------------------------------------
-- TRANSACCIONES (historial de compras/ventas)
-- ----------------------------------------------------------------------------
create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references auth.users(id) on delete cascade,
  seller_id  uuid not null references auth.users(id) on delete cascade,
  card_id    text not null,
  serial     int,
  price      bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists tx_buyer_idx on public.transactions(buyer_id);
create index if not exists tx_seller_idx on public.transactions(seller_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.game_state      enable row level security;
alter table public.inventory       enable row level security;
alter table public.market_listings enable row level security;
alter table public.transactions    enable row level security;

-- Perfiles: lectura pública (rankings), escritura solo del propio usuario.
create policy "perfiles visibles para todos" on public.profiles for select using (true);
create policy "edita tu perfil" on public.profiles for update using (auth.uid() = id);
create policy "crea tu perfil"  on public.profiles for insert with check (auth.uid() = id);

-- Estado de juego: solo el dueño.
create policy "tu estado (rw)" on public.game_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Inventario: lectura propia; escritura SOLO vía RPC (SECURITY DEFINER).
create policy "tu inventario (lectura)" on public.inventory for select using (auth.uid() = user_id);

-- Listados: lectura pública del mercado; escritura SOLO vía RPC.
create policy "mercado visible" on public.market_listings for select using (true);

-- Transacciones: solo las propias.
create policy "tus transacciones" on public.transactions
  for select using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Crear perfil automáticamente al registrarse.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)) || '_' || substr(new.id::text, 1, 4),
    coalesce(new.raw_user_meta_data->>'avatar', '🎮')
  );
  insert into public.game_state (user_id) values (new.id);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at automático.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RPC: OPERACIONES CRÍTICAS (validadas en servidor, atómicas)
-- ============================================================================

-- Depositar una carta del jugador en su inventario de servidor (para tradear).
create or replace function public.deposit_card(p_card_id text, p_serial int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  insert into public.inventory (user_id, card_id, serial)
  values (auth.uid(), p_card_id, p_serial) returning id into v_id;
  return v_id;
end; $$;

-- Publicar una carta en el mercado (debe estar en tu inventario de servidor).
create or replace function public.create_listing(p_card_id text, p_serial int, p_price int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_listing uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if p_price <= 0 then raise exception 'Precio inválido'; end if;

  select id into v_inv from public.inventory
   where user_id = auth.uid() and card_id = p_card_id
     and (serial is not distinct from p_serial)
   limit 1;
  if v_inv is null then raise exception 'No posees esa carta'; end if;

  delete from public.inventory where id = v_inv;
  insert into public.market_listings (seller_id, card_id, serial, price)
  values (auth.uid(), p_card_id, p_serial, p_price) returning id into v_listing;
  return v_listing;
end; $$;

-- Cancelar un listado propio (devuelve la carta al inventario).
create or replace function public.cancel_listing(p_listing_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.market_listings;
begin
  select * into v from public.market_listings where id = p_listing_id for update;
  if v.id is null then raise exception 'Listado inexistente'; end if;
  if v.seller_id <> auth.uid() then raise exception 'No es tu listado'; end if;
  if v.status <> 'active' then raise exception 'El listado no está activo'; end if;

  update public.market_listings set status = 'cancelled' where id = p_listing_id;
  insert into public.inventory (user_id, card_id, serial) values (auth.uid(), v.card_id, v.serial);
end; $$;

-- Comprar un listado: transferencia atómica de créditos + propiedad.
create or replace function public.buy_listing(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.market_listings; v_credits bigint; v_tx uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;

  select * into v from public.market_listings where id = p_listing_id for update;
  if v.id is null then raise exception 'Listado inexistente'; end if;
  if v.status <> 'active' then raise exception 'El listado ya no está disponible'; end if;
  if v.seller_id = auth.uid() then raise exception 'No puedes comprar tu propio listado'; end if;

  select credits into v_credits from public.profiles where id = auth.uid() for update;
  if v_credits < v.price then raise exception 'Créditos insuficientes'; end if;

  -- Movimiento de créditos
  update public.profiles set credits = credits - v.price where id = auth.uid();
  update public.profiles set credits = credits + v.price,
                             market_volume = market_volume + v.price
   where id = v.seller_id;

  -- Transferencia de propiedad
  update public.market_listings
     set status = 'sold', buyer_id = auth.uid(), sold_at = now()
   where id = p_listing_id;
  insert into public.inventory (user_id, card_id, serial) values (auth.uid(), v.card_id, v.serial);

  -- Historial
  insert into public.transactions (buyer_id, seller_id, card_id, serial, price)
  values (auth.uid(), v.seller_id, v.card_id, v.serial, v.price) returning id into v_tx;

  return v_tx;
end; $$;

-- ============================================================================
-- RANKINGS (vistas; lectura pública vía RLS de profiles)
-- ============================================================================
create or replace view public.ranking_level as
  select id, username, avatar, level, xp from public.profiles order by xp desc limit 100;

create or replace view public.ranking_collection as
  select id, username, avatar, collection_value, distinct_cards from public.profiles
  order by collection_value desc limit 100;

create or replace view public.ranking_market as
  select id, username, avatar, market_volume from public.profiles
  order by market_volume desc limit 100;

create or replace view public.ranking_rarities as
  select id, username, avatar, rarest_rank, distinct_cards from public.profiles
  order by rarest_rank desc, distinct_cards desc limit 100;
