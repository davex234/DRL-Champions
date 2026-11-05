-- ============================================================================
-- FASE 11 · MERCADO ENTRE JUGADORES — PORTADO A LA PROPIEDAD REAL
--
-- ────────────────────────── POR QUÉ ESTABA CERRADO ──────────────────────────
--
-- El mercado se construyó entero en 0001/0004 —listados, ofertas, impuesto, banda de
-- precio, límite de frecuencia, detección de wash trading, auditoría— y la Fase A lo
-- CERRÓ en la base de datos (0010) por un motivo que no era ninguno de esos sistemas:
--
--   **Hay dos tablas de propiedad.** Las RPC del mercado mueven `public.inventory`; el
--   juego usa `public.user_cards` desde la Fase B. Con la propiedad viviendo en dos sitios
--   sin reconciliar, comprar salía gratis, publicar→cancelar duplicaba cartas y
--   `deposit_card` permitía acuñar cualquier carta desde la consola del navegador.
--
-- Esta migración es el puerto. **No borra nada de 0004**: aquellas RPC siguen ahí,
-- revocadas, con su antifraude intacto. Lo que se hace es escribir la versión que opera
-- sobre `user_cards`, pasa por el libro mayor y solo la puede llamar el servidor.
--
-- ────────────────────────── LAS CUATRO DECISIONES ──────────────────────────
--
-- **1. Un listado apunta a un EJEMPLAR, no a una carta.**
--    `market_listings` guardaba `(card_id, serial)`. Dos ejemplares idénticos sin serie
--    son indistinguibles con esa clave, así que no se podía saber CUÁL se vendía. Ahora
--    hay `card_uid` → `user_cards.uid`.
--
-- **2. El depósito en garantía es un BLOQUEO, no un traslado.**
--    La versión antigua BORRABA la carta del inventario al publicar y la reinsertaba al
--    cancelar. Ese viaje de ida y vuelta es justo lo que duplicaba cartas (BUG-02). Aquí
--    la carta **no se mueve**: se marca `user_cards.locked = true`. Sigue siendo del
--    vendedor, se le sigue viendo en su colección, y no se puede desguazar, ni meter en un
--    mazo, ni publicar dos veces. Cancelar es quitar la marca. No hay ventana en la que la
--    carta esté en dos sitios ni en ninguno.
--
-- **3. Todo el dinero pasa por `_ledger_apply`.**
--    Las RPC de 0004 escribían `profiles.credits` a mano y no dejaban un solo asiento. Una
--    venta deja ahora TRES: el cargo al comprador (`transfer_out`), el abono al vendedor
--    (`transfer_in`) y la comisión (`debit`). El libro cuadra y se puede auditar quién
--    pagó a quién.
--
-- **4. Solo el servidor.** Las RPC nuevas se revocan a `anon`/`authenticated` y se
--    conceden a `service_role`, como todo lo económico desde la Fase B. `auth.uid()` no
--    aparece: el usuario llega como parámetro desde una ruta que lo saca del token.
--
-- ────────────────────────── LO QUE SIGUE SIN CONCEDERSE ──────────────────────────
--
-- `deposit_card` NO se reconcede y no se reescribe. Era el vector de acuñación (SEC-01) y
-- ya no hace falta: la propiedad no la declara el cliente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL LISTADO APUNTA A UN EJEMPLAR Y TIENE CICLO DE VIDA COMPLETO
-- ----------------------------------------------------------------------------

alter table public.market_listings
  add column if not exists card_uid     uuid references public.user_cards(uid) on delete cascade,
  add column if not exists updated_at   timestamptz not null default now(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists expires_at   timestamptz;

-- ACTIVE → SOLD | CANCELLED | EXPIRED. Faltaba `expired`, así que un listado viejo no
-- tenía forma de morir sin que alguien lo cancelara a mano.
alter table public.market_listings drop constraint if exists market_listings_status_check;
alter table public.market_listings
  add constraint market_listings_status_check
  check (status in ('active', 'sold', 'cancelled', 'expired'));

-- Un ejemplar no puede estar en dos listados vivos a la vez. Es la red de seguridad del
-- bloqueo: aunque alguien saltara la comprobación de `locked`, la base de datos lo corta.
create unique index if not exists market_listings_uid_active_uniq
  on public.market_listings(card_uid) where status = 'active' and card_uid is not null;

create index if not exists market_listings_seller_idx
  on public.market_listings(seller_id, status, created_at desc);

comment on column public.market_listings.card_uid is
  'Ejemplar concreto de user_cards. Nulo solo en listados anteriores a la Fase 11.';

-- ----------------------------------------------------------------------------
-- 2. ANTIFRAUDE SIN `auth.uid()`
-- ----------------------------------------------------------------------------
-- Las comprobaciones de 0004 leen `auth.uid()`, que es NULL cuando llama el servidor.
-- Se replican con el usuario explícito. La lógica es la misma; lo que cambia es de dónde
-- sale la identidad.

create or replace function public._market_check_rate(p_user uuid, p_action text, p_max int)
returns void language plpgsql security definer set search_path = public as $$
declare v_cnt int;
begin
  select count(*) into v_cnt from public.market_audit
   where user_id = p_user and action = p_action and created_at > now() - interval '1 hour';
  if v_cnt >= p_max then
    insert into public.market_flags (user_id, kind, severity, detail)
      values (p_user, 'rate_limit', 'block', jsonb_build_object('action', p_action, 'count', v_cnt, 'max', p_max));
    raise exception 'Has alcanzado el límite de % por hora', p_action using errcode = 'P0001';
  end if;
end; $$;

create or replace function public._market_check_band(p_user uuid, p_card_id text, p_price bigint)
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
        values (p_user, 'price_out_of_band', 'block', p_card_id,
                jsonb_build_object('price', p_price, 'anchor', v_anchor, 'lo', v_lo, 'hi', v_hi));
      raise exception 'Precio fuera de banda (ancla ~%). Permitido entre % y %', v_anchor, v_lo, v_hi
        using errcode = 'P0001';
    end if;
  end if;
end; $$;

-- ----------------------------------------------------------------------------
-- 3. PUBLICAR
-- ----------------------------------------------------------------------------
create or replace function public.app_market_list(
  p_user uuid, p_card_uid uuid, p_price bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_card public.user_cards; v_cfg public.market_config; v_listing uuid; v_prev jsonb;
begin
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'Publicar necesita clave de idempotencia';
  end if;
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  select * into v_cfg from public.market_config where id = 'default';
  if p_price is null or p_price < v_cfg.min_price then
    raise exception 'El precio mínimo es %', v_cfg.min_price using errcode = 'P0001';
  end if;
  -- Techo duro: un `bigint` desbordado o un precio absurdo no llegan al libro mayor.
  if p_price > 100000000 then
    raise exception 'Precio no admitido' using errcode = 'P0001';
  end if;

  perform public._market_check_rate(p_user, 'list', v_cfg.max_listings_per_hour);

  -- El ejemplar se bloquea ANTES de mirarlo: entre leer y marcar no puede colarse otra
  -- publicación del mismo `uid`.
  select * into v_card from public.user_cards where uid = p_card_uid for update;
  if v_card.uid is null or v_card.user_id <> p_user then
    raise exception 'No posees esa carta' using errcode = 'P0001';
  end if;
  if v_card.locked then
    raise exception 'Esa carta ya está en venta' using errcode = 'P0001';
  end if;

  perform public._market_check_band(p_user, v_card.card_id, p_price);

  -- Depósito en garantía: la carta NO se mueve, se marca.
  update public.user_cards set locked = true where uid = p_card_uid;

  insert into public.market_listings (seller_id, card_id, serial, card_uid, price, status, updated_at)
  values (p_user, v_card.card_id, v_card.serial, p_card_uid, p_price, 'active', now())
  returning id into v_listing;

  insert into public.market_audit (user_id, action, card_id, listing_id, price)
  values (p_user, 'list', v_card.card_id, v_listing, p_price);

  v_prev := jsonb_build_object('listingId', v_listing, 'cardId', v_card.card_id, 'price', p_price);
  insert into public.economy_ops (ref, user_id, kind, result) values (p_ref, p_user, 'market_list', v_prev);
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 4. CANCELAR
-- ----------------------------------------------------------------------------
create or replace function public.app_market_cancel(p_user uuid, p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.market_listings;
begin
  select * into v from public.market_listings where id = p_listing_id for update;
  if v.id is null then raise exception 'Listado inexistente' using errcode = 'P0001'; end if;
  -- Cancelar el listado de otro es el ataque obvio. El dueño se comprueba aquí, no en Node.
  if v.seller_id <> p_user then
    raise exception 'Ese listado no es tuyo' using errcode = 'P0001';
  end if;
  if v.status <> 'active' then
    raise exception 'El listado ya no está activo' using errcode = 'P0001';
  end if;

  update public.market_listings
     set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where id = p_listing_id;

  -- Se libera el depósito. La carta nunca dejó de ser suya, así que no hay nada que
  -- devolver: solo se quita la marca.
  if v.card_uid is not null then
    update public.user_cards set locked = false where uid = v.card_uid and user_id = p_user;
  end if;

  insert into public.market_audit (user_id, action, card_id, listing_id, price)
  values (p_user, 'cancel', v.card_id, p_listing_id, v.price);

  return jsonb_build_object('listingId', p_listing_id, 'status', 'cancelled');
end; $$;

-- ----------------------------------------------------------------------------
-- 5. COMPRAR — la operación crítica
-- ----------------------------------------------------------------------------
--
-- Orden deliberado, porque de él dependen todas las garantías:
--
--   1. Idempotencia (¿ya se hizo esta compra?).
--   2. Bloqueo del LISTADO. Es lo que impide la doble compra: dos peticiones simultáneas
--      se serializan aquí y la segunda encuentra el estado ya en `sold`.
--   3. Comprobaciones que no dependen del dinero (existe, activo, no es tuyo).
--   4. Cobro. `_ledger_apply` bloquea el perfil del comprador y corta si no llega.
--   5. Traspaso de la carta y cierre del listado.
--
-- Si algo falla en cualquier punto, la transacción entera se deshace: no existe un estado
-- en el que el comprador haya pagado y la carta siga siendo del vendedor.
create or replace function public.app_market_buy(
  p_user uuid, p_listing_id uuid, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.market_listings; v_cfg public.market_config;
  v_fee bigint; v_net bigint; v_balance bigint; v_tx uuid; v_prev jsonb;
begin
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'Comprar necesita clave de idempotencia';
  end if;
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  select * into v_cfg from public.market_config where id = 'default';
  perform public._market_check_rate(p_user, 'buy', v_cfg.max_buys_per_hour);

  select * into v from public.market_listings where id = p_listing_id for update;
  if v.id is null then raise exception 'Listado inexistente' using errcode = 'P0001'; end if;
  if v.status <> 'active' then
    raise exception 'Ese listado ya no está disponible' using errcode = 'P0001';
  end if;
  if v.seller_id = p_user then
    insert into public.market_flags (user_id, kind, severity, listing_id)
      values (p_user, 'self_trade', 'block', p_listing_id);
    raise exception 'No puedes comprar tu propio listado' using errcode = 'P0001';
  end if;
  if v.card_uid is null then
    -- Listado anterior a la Fase 11: no sabe qué ejemplar vende. No se compra.
    raise exception 'Ese listado es de una versión anterior y no se puede comprar'
      using errcode = 'P0001';
  end if;

  v_fee := (v.price * v_cfg.tax_bps) / 10000;
  v_net := v.price - v_fee;

  -- ── Dinero, todo por la puerta única ──
  v_balance := public._ledger_apply(
    p_user, -v.price, 'market_buy:' || v.card_id, p_ref, 'transfer_out', v.seller_id);
  perform public._ledger_apply(
    v.seller_id, v.price, 'market_sell:' || v.card_id, p_ref || ':sell', 'transfer_in', p_user);
  if v_fee > 0 then
    perform public._ledger_apply(
      v.seller_id, -v_fee, 'market_fee', p_ref || ':fee', 'debit', null);
  end if;

  update public.profiles
     set market_volume = market_volume + v.price, taxes_paid = taxes_paid + v_fee
   where id = v.seller_id;
  update public.market_config
     set total_burned = total_burned + v_fee, updated_at = now() where id = 'default';

  -- ── La carta ──
  -- Cambia de dueño y se desbloquea en la misma sentencia. `origin = 'market'` deja el
  -- rastro de cómo llegó, que es lo que distingue una carta comprada de una que salió de
  -- un sobre.
  update public.user_cards
     set user_id = p_user, locked = false, origin = 'market', obtained_at = now()
   where uid = v.card_uid and user_id = v.seller_id;
  if not found then
    raise exception 'La carta ya no pertenece al vendedor' using errcode = 'P0001';
  end if;

  update public.market_listings
     set status = 'sold', buyer_id = p_user, sold_at = now(), updated_at = now()
   where id = p_listing_id;

  insert into public.transactions (buyer_id, seller_id, card_id, serial, price, tax)
  values (p_user, v.seller_id, v.card_id, v.serial, v.price, v_fee) returning id into v_tx;

  perform public._release_listing_offers(p_listing_id, null);
  insert into public.market_audit (user_id, action, card_id, listing_id, price)
  values (p_user, 'buy', v.card_id, p_listing_id, v.price);

  v_prev := jsonb_build_object(
    'transactionId', v_tx, 'listingId', p_listing_id, 'cardId', v.card_id,
    'price', v.price, 'fee', v_fee, 'net', v_net, 'credits', v_balance);
  insert into public.economy_ops (ref, user_id, kind, result) values (p_ref, p_user, 'market_buy', v_prev);
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 6. CADUCAR LISTADOS
-- ----------------------------------------------------------------------------
-- Un listado con `expires_at` cumplido deja de estar activo y libera su depósito. Es la
-- razón de ser del estado `expired`: sin él, una carta publicada y olvidada queda
-- bloqueada para siempre.
create or replace function public.app_market_expire()
returns int language plpgsql security definer set search_path = public as $$
declare v_row record; v_n int := 0;
begin
  for v_row in
    select id, card_uid, seller_id from public.market_listings
     where status = 'active' and expires_at is not null and expires_at <= now()
     for update
  loop
    update public.market_listings
       set status = 'expired', updated_at = now() where id = v_row.id;
    if v_row.card_uid is not null then
      update public.user_cards set locked = false
       where uid = v_row.card_uid and user_id = v_row.seller_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

-- ----------------------------------------------------------------------------
-- 7. NADA DE ESTO ES INVOCABLE DESDE EL NAVEGADOR
-- ----------------------------------------------------------------------------
revoke all on function public._market_check_rate(uuid, text, int)          from public, anon, authenticated;
revoke all on function public._market_check_band(uuid, text, bigint)       from public, anon, authenticated;
revoke all on function public.app_market_list(uuid, uuid, bigint, text)    from public, anon, authenticated;
revoke all on function public.app_market_cancel(uuid, uuid)                from public, anon, authenticated;
revoke all on function public.app_market_buy(uuid, uuid, text)             from public, anon, authenticated;
revoke all on function public.app_market_expire()                          from public, anon, authenticated;

grant execute on function public._market_check_rate(uuid, text, int)          to service_role;
grant execute on function public._market_check_band(uuid, text, bigint)       to service_role;
grant execute on function public.app_market_list(uuid, uuid, bigint, text)    to service_role;
grant execute on function public.app_market_cancel(uuid, uuid)                to service_role;
grant execute on function public.app_market_buy(uuid, uuid, text)             to service_role;
grant execute on function public.app_market_expire()                          to service_role;

-- ----------------------------------------------------------------------------
-- 8. LECTURA DEL ESCAPARATE
-- ----------------------------------------------------------------------------
-- Los listados ACTIVOS son públicos: es un escaparate. Lo que no se expone es quién los
-- publicó más allá de su identificador, ni nada de los listados cerrados de otros.
drop policy if exists "escaparate publico" on public.market_listings;
create policy "escaparate publico" on public.market_listings
  for select using (status = 'active' or seller_id = auth.uid() or buyer_id = auth.uid());
