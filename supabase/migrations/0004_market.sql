-- ============================================================================
-- DRL CHAMPIONS — Mercado global con economía real entre usuarios
-- ----------------------------------------------------------------------------
-- Amplía el mercado de 0001 (market_listings/transactions/inventory + RPCs
-- atómicas) con: historial + precio medio + serie temporal para gráficas,
-- ofertas/pujas con depósito (escrow), impuesto de mercado (sink), antifraude
-- server-side (rate limits, banda de precio, wash-trading, cooldown de reventa,
-- flags + auditoría), búsqueda paginada y analítica (ranking + rarezas).
--
-- Toda operación crítica es SECURITY DEFINER + FOR UPDATE (atómica, sin confiar
-- en el cliente). RLS: lectura pública de catálogo/analítica; escritura solo vía
-- RPC. Idempotente y re-ejecutable.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. CONFIGURACIÓN DEL MERCADO (fila única 'default')
-- ============================================================================
create table if not exists public.market_config (
  id                    text primary key default 'default',
  tax_bps               int    not null default 500,    -- 5% (puntos básicos)
  min_price             bigint not null default 25,
  min_price_mult        numeric not null default 0.2,   -- banda inferior vs ancla
  max_price_mult        numeric not null default 10,    -- banda superior vs ancla
  max_listings_per_hour int    not null default 30,
  max_buys_per_hour     int    not null default 60,
  resale_cooldown_secs  int    not null default 0,      -- 0 = desactivado
  wash_window_secs      int    not null default 86400,
  wash_max_pair         int    not null default 3,
  total_burned          bigint not null default 0,      -- créditos retirados por impuesto
  updated_at            timestamptz not null default now()
);
insert into public.market_config (id) values ('default') on conflict (id) do nothing;

-- ============================================================================
-- 2. REFERENCIA DE CARTAS (denormalizada del catálogo TS; la puebla un route)
-- ============================================================================
create table if not exists public.card_reference (
  card_id    text primary key,
  player_id  text,
  nick       text,
  team       text,
  region     text,
  rank       int,          -- rareza (rank de la variante)
  ovr        int,
  fair_value bigint,       -- valor justo (fórmula marketValue)
  updated_at timestamptz not null default now()
);
create index if not exists card_ref_rank_idx   on public.card_reference(rank);
create index if not exists card_ref_region_idx on public.card_reference(region);

-- ============================================================================
-- 3. AGREGADOS DE PRECIO (mantenidos por trigger; sin recompute en lectura)
-- ============================================================================
create table if not exists public.card_price_stats (
  card_id      text primary key,
  last_price   bigint,
  avg_price    bigint,
  min_price    bigint,
  max_price    bigint,
  trade_count  bigint not null default 0,
  volume       bigint not null default 0,
  last_sale_at timestamptz,
  updated_at   timestamptz not null default now()
);

-- Serie temporal diaria (velas) para las gráficas de evolución.
create table if not exists public.card_price_daily (
  card_id text not null,
  day     date not null,
  open    bigint not null,
  high    bigint not null,
  low     bigint not null,
  close   bigint not null,
  volume  bigint not null default 0,
  trades  int    not null default 0,
  primary key (card_id, day)
);

-- ============================================================================
-- 4. OFERTAS / PUJAS (con depósito de créditos)
-- ----------------------------------------------------------------------------
-- kind='listing' → contraoferta a un listado concreto (lo acepta su vendedor).
-- kind='card'    → orden de compra por tipo de carta (la acepta quien la posea).
-- El crédito se retiene al crear la oferta y se libera al resolverla.
-- ============================================================================
create table if not exists public.market_offers (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('listing','card')),
  buyer_id    uuid not null references auth.users(id) on delete cascade,
  card_id     text not null,
  serial      int,
  listing_id  uuid references public.market_listings(id) on delete set null,
  price       bigint not null check (price > 0),
  status      text not null default 'active'
                check (status in ('active','accepted','rejected','cancelled','expired')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  expires_at  timestamptz
);
create index if not exists offers_card_idx    on public.market_offers(card_id, status, price desc);
create index if not exists offers_buyer_idx   on public.market_offers(buyer_id, status);
create index if not exists offers_listing_idx on public.market_offers(listing_id) where status = 'active';

-- ============================================================================
-- 5. ANTIFRAUDE: auditoría (rate limits) + flags
-- ============================================================================
create table if not exists public.market_audit (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  action     text not null check (action in ('list','buy','cancel','offer','accept_offer','cancel_offer')),
  card_id    text,
  listing_id uuid,
  offer_id   uuid,
  price      bigint,
  created_at timestamptz not null default now()
);
create index if not exists audit_user_action_idx on public.market_audit(user_id, action, created_at desc);

create table if not exists public.market_flags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  kind       text not null check (kind in ('rate_limit','price_out_of_band','wash_trade','self_trade','resale_cooldown')),
  severity   text not null default 'warn' check (severity in ('info','warn','block')),
  detail     jsonb not null default '{}'::jsonb,
  listing_id uuid,
  offer_id   uuid,
  card_id    text,
  created_at timestamptz not null default now()
);
create index if not exists flags_user_idx on public.market_flags(user_id, created_at desc);

-- ============================================================================
-- 6. COLUMNAS AÑADIDAS A TABLAS DE 0001 + ÍNDICES NUEVOS
-- ============================================================================
alter table public.transactions add column if not exists tax bigint not null default 0;
alter table public.profiles     add column if not exists taxes_paid bigint not null default 0;

create index if not exists listings_status_price_idx on public.market_listings(status, price);
create index if not exists listings_card_price_idx   on public.market_listings(card_id, status, price);
create index if not exists listings_seller_idx       on public.market_listings(seller_id, status);
create index if not exists tx_card_time_idx          on public.transactions(card_id, created_at);

-- ============================================================================
-- 7. RLS
-- ============================================================================
alter table public.market_config    enable row level security;
alter table public.card_reference   enable row level security;
alter table public.card_price_stats enable row level security;
alter table public.card_price_daily enable row level security;
alter table public.market_offers    enable row level security;
alter table public.market_audit     enable row level security;
alter table public.market_flags     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['market_config','card_reference','card_price_stats','card_price_daily','market_offers'] loop
    execute format('drop policy if exists "lectura publica %s" on public.%I;', t, t);
    execute format('create policy "lectura publica %s" on public.%I for select using (true);', t, t);
  end loop;
end $$;
-- market_audit / market_flags: sin políticas de cliente (solo service_role / RPC).

-- ============================================================================
-- 8. TRIGGER: mantener agregados de precio en cada transacción
-- ============================================================================
create or replace function public.market_on_transaction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.card_price_stats (card_id, last_price, avg_price, min_price, max_price,
                                       trade_count, volume, last_sale_at, updated_at)
  values (new.card_id, new.price, new.price, new.price, new.price, 1, new.price, new.created_at, now())
  on conflict (card_id) do update set
    last_price   = new.price,
    min_price    = least(public.card_price_stats.min_price, new.price),
    max_price    = greatest(public.card_price_stats.max_price, new.price),
    trade_count  = public.card_price_stats.trade_count + 1,
    volume       = public.card_price_stats.volume + new.price,
    avg_price    = (public.card_price_stats.volume + new.price) / (public.card_price_stats.trade_count + 1),
    last_sale_at = new.created_at,
    updated_at   = now();

  insert into public.card_price_daily (card_id, day, open, high, low, close, volume, trades)
  values (new.card_id, new.created_at::date, new.price, new.price, new.price, new.price, new.price, 1)
  on conflict (card_id, day) do update set
    high   = greatest(public.card_price_daily.high, new.price),
    low    = least(public.card_price_daily.low, new.price),
    close  = new.price,
    volume = public.card_price_daily.volume + new.price,
    trades = public.card_price_daily.trades + 1;

  return new;
end; $$;

drop trigger if exists transactions_market_agg on public.transactions;
create trigger transactions_market_agg
  after insert on public.transactions
  for each row execute function public.market_on_transaction();

-- ============================================================================
-- 9. HELPERS DE ANTIFRAUDE / PRECIO
-- ============================================================================
-- Ancla de precio: media de mercado si existe, si no el valor justo.
create or replace function public._price_anchor(p_card_id text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select avg_price  from public.card_price_stats where card_id = p_card_id),
    (select fair_value from public.card_reference   where card_id = p_card_id)
  );
$$;

-- Banda de precio: rechaza precios absurdos respecto al ancla (y deja flag).
create or replace function public._check_price_band(p_card_id text, p_price bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_anchor bigint; v_cfg public.market_config; v_lo bigint; v_hi bigint;
begin
  select * into v_cfg from public.market_config where id = 'default';
  v_anchor := public._price_anchor(p_card_id);
  if v_anchor is not null and v_anchor > 0 then
    v_lo := floor(v_anchor * v_cfg.min_price_mult);
    v_hi := ceil (v_anchor * v_cfg.max_price_mult);
    if p_price < v_lo or p_price > v_hi then
      insert into public.market_flags (user_id, kind, severity, card_id, detail)
        values (auth.uid(), 'price_out_of_band', 'block', p_card_id,
                jsonb_build_object('price', p_price, 'anchor', v_anchor, 'lo', v_lo, 'hi', v_hi));
      raise exception 'Precio fuera de banda (ancla ~%). Permitido entre % y %', v_anchor, v_lo, v_hi;
    end if;
  end if;
end; $$;

-- Rate limit por acción en la última hora.
create or replace function public._check_rate(p_action text, p_max int)
returns void language plpgsql security definer set search_path = public as $$
declare v_cnt int;
begin
  select count(*) into v_cnt from public.market_audit
   where user_id = auth.uid() and action = p_action and created_at > now() - interval '1 hour';
  if v_cnt >= p_max then
    insert into public.market_flags (user_id, kind, severity, detail)
      values (auth.uid(), 'rate_limit', 'block', jsonb_build_object('action', p_action, 'count', v_cnt, 'max', p_max));
    raise exception 'Límite por hora alcanzado para "%" (% / %)', p_action, v_cnt, p_max;
  end if;
end; $$;

-- Detección de wash-trading entre el mismo par (solo deja flag, no bloquea).
create or replace function public._check_wash(p_buyer uuid, p_seller uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cfg public.market_config; v_cnt int;
begin
  select * into v_cfg from public.market_config where id = 'default';
  select count(*) into v_cnt from public.transactions
   where created_at > now() - make_interval(secs => v_cfg.wash_window_secs)
     and ((buyer_id = p_buyer and seller_id = p_seller) or (buyer_id = p_seller and seller_id = p_buyer));
  if v_cnt > v_cfg.wash_max_pair then
    insert into public.market_flags (user_id, kind, severity, detail)
      values (p_buyer, 'wash_trade', 'warn', jsonb_build_object('counterparty', p_seller, 'count', v_cnt));
  end if;
end; $$;

-- Libera (reembolsa) las demás ofertas activas de un listado vendido.
create or replace function public._release_listing_offers(p_listing_id uuid, p_except uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  for o in select * from public.market_offers
            where listing_id = p_listing_id and status = 'active'
              and (p_except is null or id <> p_except) for update loop
    update public.market_offers set status = 'rejected', resolved_at = now() where id = o.id;
    update public.profiles set credits = credits + o.price where id = o.buyer_id;
  end loop;
end; $$;

-- ============================================================================
-- 10. RPC: COMPRA / VENTA (reemplazan las de 0001 añadiendo impuesto + checks)
-- ============================================================================
create or replace function public.create_listing(p_card_id text, p_serial int, p_price int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_obtained timestamptz; v_listing uuid; v_cfg public.market_config;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into v_cfg from public.market_config where id = 'default';
  if p_price < v_cfg.min_price then raise exception 'Precio mínimo %', v_cfg.min_price; end if;

  perform public._check_rate('list', v_cfg.max_listings_per_hour);
  perform public._check_price_band(p_card_id, p_price);

  select id, obtained_at into v_inv, v_obtained from public.inventory
   where user_id = auth.uid() and card_id = p_card_id and (serial is not distinct from p_serial)
   limit 1;
  if v_inv is null then raise exception 'No posees esa carta'; end if;

  if v_cfg.resale_cooldown_secs > 0
     and v_obtained > now() - make_interval(secs => v_cfg.resale_cooldown_secs) then
    insert into public.market_flags (user_id, kind, severity, card_id, detail)
      values (auth.uid(), 'resale_cooldown', 'block', p_card_id, jsonb_build_object('obtained_at', v_obtained));
    raise exception 'Debes esperar antes de revender esta carta';
  end if;

  delete from public.inventory where id = v_inv;
  insert into public.market_listings (seller_id, card_id, serial, price)
    values (auth.uid(), p_card_id, p_serial, p_price) returning id into v_listing;
  insert into public.market_audit (user_id, action, card_id, listing_id, price)
    values (auth.uid(), 'list', p_card_id, v_listing, p_price);
  return v_listing;
end; $$;

create or replace function public.buy_listing(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.market_listings; v_credits bigint; v_tx uuid;
        v_cfg public.market_config; v_tax bigint; v_net bigint;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into v_cfg from public.market_config where id = 'default';
  perform public._check_rate('buy', v_cfg.max_buys_per_hour);

  select * into v from public.market_listings where id = p_listing_id for update;
  if v.id is null then raise exception 'Listado inexistente'; end if;
  if v.status <> 'active' then raise exception 'El listado ya no está disponible'; end if;
  if v.seller_id = auth.uid() then
    insert into public.market_flags (user_id, kind, severity, listing_id)
      values (auth.uid(), 'self_trade', 'block', p_listing_id);
    raise exception 'No puedes comprar tu propio listado';
  end if;

  select credits into v_credits from public.profiles where id = auth.uid() for update;
  if v_credits < v.price then raise exception 'Créditos insuficientes'; end if;

  v_tax := (v.price * v_cfg.tax_bps) / 10000;
  v_net := v.price - v_tax;

  update public.profiles set credits = credits - v.price where id = auth.uid();
  update public.profiles set credits = credits + v_net,
                             market_volume = market_volume + v.price,
                             taxes_paid = taxes_paid + v_tax
   where id = v.seller_id;
  update public.market_config set total_burned = total_burned + v_tax, updated_at = now() where id = 'default';

  update public.market_listings set status = 'sold', buyer_id = auth.uid(), sold_at = now() where id = p_listing_id;
  insert into public.inventory (user_id, card_id, serial) values (auth.uid(), v.card_id, v.serial);
  insert into public.transactions (buyer_id, seller_id, card_id, serial, price, tax)
    values (auth.uid(), v.seller_id, v.card_id, v.serial, v.price, v_tax) returning id into v_tx;

  perform public._release_listing_offers(p_listing_id, null);
  perform public._check_wash(auth.uid(), v.seller_id);
  insert into public.market_audit (user_id, action, card_id, listing_id, price)
    values (auth.uid(), 'buy', v.card_id, p_listing_id, v.price);
  return v_tx;
end; $$;

-- cancel_listing de 0001 se mantiene tal cual (devuelve la carta al inventario).

-- ============================================================================
-- 11. RPC: OFERTAS
-- ============================================================================
create or replace function public.make_offer(
  p_kind text, p_card_id text, p_serial int, p_listing_id uuid, p_price bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cfg public.market_config; v_credits bigint; v_offer uuid;
        v_listing public.market_listings; v_card text; v_serial int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if p_kind not in ('listing','card') then raise exception 'Tipo de oferta inválido'; end if;
  select * into v_cfg from public.market_config where id = 'default';
  if p_price < v_cfg.min_price then raise exception 'Precio mínimo %', v_cfg.min_price; end if;
  perform public._check_rate('offer', v_cfg.max_buys_per_hour);

  if p_kind = 'listing' then
    select * into v_listing from public.market_listings where id = p_listing_id;
    if v_listing.id is null or v_listing.status <> 'active' then raise exception 'Listado no disponible'; end if;
    if v_listing.seller_id = auth.uid() then raise exception 'No puedes ofertar a tu propio listado'; end if;
    v_card := v_listing.card_id; v_serial := v_listing.serial;
  else
    if p_card_id is null then raise exception 'card_id requerido'; end if;
    v_card := p_card_id; v_serial := p_serial;
  end if;

  perform public._check_price_band(v_card, p_price);

  select credits into v_credits from public.profiles where id = auth.uid() for update;
  if v_credits < p_price then raise exception 'Créditos insuficientes para la oferta'; end if;
  update public.profiles set credits = credits - p_price where id = auth.uid();  -- depósito

  insert into public.market_offers (kind, buyer_id, card_id, serial, listing_id, price)
    values (p_kind, auth.uid(), v_card, v_serial,
            case when p_kind = 'listing' then p_listing_id else null end, p_price)
    returning id into v_offer;
  insert into public.market_audit (user_id, action, card_id, offer_id, price)
    values (auth.uid(), 'offer', v_card, v_offer, p_price);
  return v_offer;
end; $$;

create or replace function public.cancel_offer(p_offer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.market_offers;
begin
  select * into v from public.market_offers where id = p_offer_id for update;
  if v.id is null then raise exception 'Oferta inexistente'; end if;
  if v.buyer_id <> auth.uid() then raise exception 'No es tu oferta'; end if;
  if v.status <> 'active' then raise exception 'La oferta no está activa'; end if;
  update public.market_offers set status = 'cancelled', resolved_at = now() where id = p_offer_id;
  update public.profiles set credits = credits + v.price where id = v.buyer_id;  -- reembolso
  insert into public.market_audit (user_id, action, card_id, offer_id, price)
    values (auth.uid(), 'cancel_offer', v.card_id, p_offer_id, v.price);
end; $$;

create or replace function public.accept_offer(p_offer_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.market_offers; v_cfg public.market_config; v_tax bigint; v_net bigint;
        v_inv uuid; v_listing public.market_listings; v_tx uuid;
        v_card text; v_serial int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into v from public.market_offers where id = p_offer_id for update;
  if v.id is null then raise exception 'Oferta inexistente'; end if;
  if v.status <> 'active' then raise exception 'La oferta no está activa'; end if;
  if v.buyer_id = auth.uid() then raise exception 'No puedes aceptar tu propia oferta'; end if;
  select * into v_cfg from public.market_config where id = 'default';
  v_card := v.card_id;

  if v.kind = 'listing' then
    select * into v_listing from public.market_listings where id = v.listing_id for update;
    if v_listing.id is null or v_listing.status <> 'active' then raise exception 'Listado no disponible'; end if;
    if v_listing.seller_id <> auth.uid() then raise exception 'No eres el vendedor del listado'; end if;
    v_serial := v_listing.serial;
    update public.market_listings set status = 'sold', buyer_id = v.buyer_id, sold_at = now() where id = v_listing.id;
    perform public._release_listing_offers(v_listing.id, p_offer_id);
  else
    select id, serial into v_inv, v_serial from public.inventory
     where user_id = auth.uid() and card_id = v.card_id and (v.serial is null or serial is not distinct from v.serial)
     limit 1;
    if v_inv is null then raise exception 'No posees una carta que case con la oferta'; end if;
    delete from public.inventory where id = v_inv;
  end if;

  v_tax := (v.price * v_cfg.tax_bps) / 10000;
  v_net := v.price - v_tax;

  -- el comprador ya pagó (depósito); pagamos al vendedor el neto y quemamos el impuesto
  update public.profiles set credits = credits + v_net,
                             market_volume = market_volume + v.price,
                             taxes_paid = taxes_paid + v_tax
   where id = auth.uid();
  update public.market_config set total_burned = total_burned + v_tax, updated_at = now() where id = 'default';

  insert into public.inventory (user_id, card_id, serial) values (v.buyer_id, v_card, v_serial);
  insert into public.transactions (buyer_id, seller_id, card_id, serial, price, tax)
    values (v.buyer_id, auth.uid(), v_card, v_serial, v.price, v_tax) returning id into v_tx;

  update public.market_offers set status = 'accepted', resolved_at = now() where id = p_offer_id;
  perform public._check_wash(v.buyer_id, auth.uid());
  insert into public.market_audit (user_id, action, card_id, offer_id, price)
    values (auth.uid(), 'accept_offer', v_card, p_offer_id, v.price);
  return v_tx;
end; $$;

-- Caduca ofertas vencidas y reembolsa el depósito (cron / service_role).
create or replace function public.expire_offers()
returns int language plpgsql security definer set search_path = public as $$
declare o record; v_n int := 0;
begin
  for o in select * from public.market_offers
            where status = 'active' and expires_at is not null and expires_at < now() for update loop
    update public.market_offers set status = 'expired', resolved_at = now() where id = o.id;
    update public.profiles set credits = credits + o.price where id = o.buyer_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke all on function public.expire_offers() from public;
grant execute on function public.expire_offers() to service_role;

-- ============================================================================
-- 12. RPC: BÚSQUEDA PAGINADA (escalable, sin descargar el catálogo)
-- ============================================================================
create or replace function public.search_listings(
  p_query text default null, p_rank_min int default null, p_rank_max int default null,
  p_region text default null, p_sort text default 'recent',
  p_limit int default 40, p_offset int default 0)
returns table (
  id uuid, card_id text, serial int, price bigint, seller_id uuid, created_at timestamptz,
  nick text, team text, region text, rank int, ovr int, fair_value bigint, deal numeric)
language sql stable security definer set search_path = public as $$
  select l.id, l.card_id, l.serial, l.price, l.seller_id, l.created_at,
         r.nick, r.team, r.region, r.rank, r.ovr, r.fair_value,
         case when r.fair_value > 0 then round(l.price::numeric / r.fair_value, 3) end as deal
    from public.market_listings l
    left join public.card_reference r on r.card_id = l.card_id
   where l.status = 'active'
     and (p_query is null or r.nick ilike '%' || p_query || '%' or r.team ilike '%' || p_query || '%')
     and (p_rank_min is null or r.rank >= p_rank_min)
     and (p_rank_max is null or r.rank <= p_rank_max)
     and (p_region  is null or r.region = p_region)
   order by
     case when p_sort = 'price_asc'  then l.price end asc  nulls last,
     case when p_sort = 'price_desc' then l.price end desc nulls last,
     case when p_sort = 'rarity'     then r.rank  end desc nulls last,
     case when p_sort = 'deal'       then (l.price::numeric / nullif(r.fair_value, 0)) end asc nulls last,
     l.created_at desc
   limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

-- ============================================================================
-- 13. VISTAS DE ANALÍTICA (lectura pública)
-- ============================================================================
-- Ranking de cartas más valiosas (valor de mercado o, en su defecto, justo).
create or replace view public.v_market_top_cards as
  select r.card_id, r.nick, r.team, r.region, r.rank, r.ovr, r.fair_value,
         s.last_price, s.avg_price, s.max_price, s.trade_count, s.volume,
         coalesce(s.last_price, s.avg_price, r.fair_value) as value,
         (select min(price) from public.market_listings l
           where l.card_id = r.card_id and l.status = 'active') as cheapest_active
    from public.card_reference r
    left join public.card_price_stats s on s.card_id = r.card_id
   order by value desc nulls last
   limit 100;

-- Estadística por rareza (rank).
create or replace view public.v_market_rarity_stats as
  select r.rank,
         count(*)                       as cards,
         round(avg(r.fair_value))       as avg_fair_value,
         round(avg(s.last_price))       as avg_last_price,
         coalesce(sum(s.volume), 0)     as volume,
         coalesce(sum(s.trade_count),0) as trades
    from public.card_reference r
    left join public.card_price_stats s on s.card_id = r.card_id
   group by r.rank
   order by r.rank;
