-- ============================================================================
-- FASE B/C/D · AUTORIDAD DEL SERVIDOR: inventario, economía y sobres
--
-- QUÉ RESUELVE
--   Hasta ahora la propiedad de cartas, el saldo y el pity vivían en
--   `localStorage` (`useGameStore`) y Supabase solo guardaba un volcado opaco en
--   `game_state.data`. El cliente era la autoridad (SEC-04). Aquí se crean las
--   tablas reales y las operaciones ATÓMICAS que las mueven.
--
-- PRINCIPIO DE DISEÑO
--   El cliente NUNCA escribe estas tablas: RLS solo concede SELECT de las filas
--   propias. Toda mutación pasa por las RPC `app_*`, que se ejecutan con
--   `service_role` desde las rutas de servidor de Next. Se revoca EXECUTE a
--   `authenticated` para que conocer el nombre de la RPC no sirva de nada.
--
-- POR QUÉ RPC Y NO VARIOS UPDATE DESDE NODE
--   Node no puede abrir una transacción con supabase-js. Una compra o una
--   apertura son varias escrituras que DEBEN cuadrar (cobrar, consumir el sobre,
--   insertar cartas, mover pity y seriales). Cada RPC es una transacción.
--
-- QUÉ NO SE TOCA
--   `domain/cards`, `domain/packs/openPack.ts` y `PackEngine` siguen siendo la
--   ÚNICA fuente de decisión de drops: el servidor los ejecuta en Node y esta
--   capa solo PERSISTE el resultado. El esquema competitivo (0003) y el mercado
--   (0004) quedan intactos.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. INVENTARIO REAL — una fila por INSTANCIA de carta
-- ----------------------------------------------------------------------------
create table if not exists public.user_cards (
  uid         uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  card_id     text not null,
  serial      int,
  origin      text not null default 'pack'
              check (origin in ('pack','market','reward','tournament','starter',
                                'craft','unknown','event','battlepass','admin',
                                'gift','promo','code')),
  locked      boolean not null default false,
  obtained_at timestamptz not null default now()
);
create index if not exists user_cards_user_idx      on public.user_cards(user_id);
create index if not exists user_cards_user_card_idx on public.user_cards(user_id, card_id);
create index if not exists user_cards_card_idx      on public.user_cards(card_id);
-- Un número de serie es ÚNICO en todo el sistema para esa carta: es lo que le da
-- valor. Sin esto, dos usuarios podrían tener el #1 de la misma carta.
create unique index if not exists user_cards_serial_uniq
  on public.user_cards(card_id, serial) where serial is not null;

-- ----------------------------------------------------------------------------
-- 2. SOBRES SIN ABRIR
-- ----------------------------------------------------------------------------
create table if not exists public.user_packs (
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_id text not null,
  qty     int  not null default 0 check (qty >= 0),
  primary key (user_id, pack_id)
);

-- ----------------------------------------------------------------------------
-- 3. ESTADO DE JUEGO DEL USUARIO (pity + contadores)
-- ----------------------------------------------------------------------------
create table if not exists public.user_game (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  pity         jsonb not null default '{"version":1,"counters":{}}'::jsonb,
  packs_opened int   not null default 0,
  updated_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. ACUÑACIÓN GLOBAL DE SERIALES
-- ----------------------------------------------------------------------------
-- El motor recibe `mintCounts` para calcular el siguiente nº de serie. Antes era
-- por usuario (localStorage), lo que hacía los seriales carentes de significado.
-- Aquí pasa a ser GLOBAL, que es lo que un producto real necesita.
create table if not exists public.card_mints (
  card_id text primary key,
  minted  int not null default 0 check (minted >= 0)
);

-- ----------------------------------------------------------------------------
-- 5. LIBRO MAYOR DE CRÉDITOS
-- ----------------------------------------------------------------------------
-- `profiles.credits` sigue siendo el saldo (ya protegido por 0009). Esta tabla es
-- su historial auditable. `ref` es la clave de idempotencia: la misma operación
-- lógica nunca se aplica dos veces.
create table if not exists public.credit_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         bigint not null,
  reason        text   not null,
  ref           text,
  balance_after bigint not null,
  created_at    timestamptz not null default now()
);
create index if not exists credit_tx_user_idx on public.credit_transactions(user_id, created_at desc);
create unique index if not exists credit_tx_ref_uniq
  on public.credit_transactions(user_id, ref) where ref is not null;

-- ----------------------------------------------------------------------------
-- 6. RLS — lectura de lo propio, escritura NUNCA desde el cliente
-- ----------------------------------------------------------------------------
alter table public.user_cards          enable row level security;
alter table public.user_packs          enable row level security;
alter table public.user_game           enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.card_mints          enable row level security;

drop policy if exists "tus cartas (lectura)" on public.user_cards;
create policy "tus cartas (lectura)" on public.user_cards for select using (auth.uid() = user_id);

drop policy if exists "tus sobres (lectura)" on public.user_packs;
create policy "tus sobres (lectura)" on public.user_packs for select using (auth.uid() = user_id);

drop policy if exists "tu estado de juego (lectura)" on public.user_game;
create policy "tu estado de juego (lectura)" on public.user_game for select using (auth.uid() = user_id);

drop policy if exists "tus transacciones de credito (lectura)" on public.credit_transactions;
create policy "tus transacciones de credito (lectura)" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- Los contadores de acuñación son públicos en lectura (cuántas copias existen).
drop policy if exists "acunacion publica (lectura)" on public.card_mints;
create policy "acunacion publica (lectura)" on public.card_mints for select using (true);

-- Sin políticas de INSERT/UPDATE/DELETE: el cliente no puede escribir NADA aquí.
-- Además, retirada explícita de privilegios de escritura.
revoke insert, update, delete on public.user_cards          from anon, authenticated;
revoke insert, update, delete on public.user_packs          from anon, authenticated;
revoke insert, update, delete on public.user_game           from anon, authenticated;
revoke insert, update, delete on public.credit_transactions from anon, authenticated;
revoke insert, update, delete on public.card_mints          from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. ALTA DE USUARIO — extender el trigger existente sin romperlo
-- ----------------------------------------------------------------------------
-- `handle_new_user` (0001) ya crea profile + game_state. Se amplía para crear
-- también el estado de juego servidor y los sobres iniciales.
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
  insert into public.user_game  (user_id) values (new.id);

  -- Sobres de bienvenida (equivalen a los STARTER_PACKS del store local).
  insert into public.user_packs (user_id, pack_id, qty)
  values (new.id, 'inicial', 3), (new.id, 'estandar', 1)
  on conflict (user_id, pack_id) do nothing;

  -- Asiento inicial del libro mayor: el saldo de partida deja de ser un número
  -- suelto y pasa a tener origen trazable.
  insert into public.credit_transactions (user_id, delta, reason, ref, balance_after)
  values (new.id, 6000, 'starter_grant', 'starter:' || new.id::text, 6000);
  return new;
end; $$;

-- ============================================================================
-- 8. OPERACIONES ATÓMICAS (service_role)
-- ============================================================================

-- ── Ajuste de saldo idempotente ─────────────────────────────────────────────
-- Devuelve el saldo resultante. Si `p_ref` ya existe para ese usuario, NO vuelve
-- a aplicar el movimiento y devuelve el saldo actual: reintentar una petición de
-- red nunca duplica créditos ni recompensas.
create or replace function public.app_adjust_credits(
  p_user uuid, p_delta bigint, p_reason text, p_ref text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  if p_ref is not null and exists (
    select 1 from public.credit_transactions where user_id = p_user and ref = p_ref
  ) then
    select credits into v_balance from public.profiles where id = p_user;
    return v_balance;
  end if;

  select credits into v_balance from public.profiles where id = p_user for update;
  if v_balance is null then raise exception 'Perfil inexistente'; end if;
  if v_balance + p_delta < 0 then
    raise exception 'Saldo insuficiente' using errcode = 'P0001';
  end if;

  v_balance := v_balance + p_delta;
  update public.profiles set credits = v_balance where id = p_user;
  insert into public.credit_transactions (user_id, delta, reason, ref, balance_after)
  values (p_user, p_delta, p_reason, p_ref, v_balance);
  return v_balance;
end; $$;

-- ── Comprar un sobre ────────────────────────────────────────────────────────
create or replace function public.app_buy_pack(
  p_user uuid, p_pack_id text, p_price bigint, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_balance bigint; v_qty int;
begin
  if p_price < 0 then raise exception 'Precio inválido'; end if;
  v_balance := public.app_adjust_credits(p_user, -p_price, 'buy_pack:' || p_pack_id, p_ref);

  insert into public.user_packs (user_id, pack_id, qty) values (p_user, p_pack_id, 1)
  on conflict (user_id, pack_id) do update set qty = public.user_packs.qty + 1
  returning qty into v_qty;

  return jsonb_build_object('credits', v_balance, 'packId', p_pack_id, 'qty', v_qty);
end; $$;

-- ── Aplicar el resultado de una apertura ────────────────────────────────────
-- El SORTEO lo hace `openPack()` en Node (fuente única, no se duplica aquí).
-- Esta función solo PERSISTE, y valida de nuevo que el usuario tenía el sobre:
-- entre la lectura de estado y la escritura no puede colarse una doble apertura.
--
-- p_instances: [{"cardId":"...","serial":3|null,"origin":"pack"}, ...]
-- p_mint_delta: {"cardId": nuevoMaximoDeSerie, ...}
create or replace function public.app_apply_pack_open(
  p_user uuid, p_pack_id text, p_instances jsonb, p_pity jsonb,
  p_mint_delta jsonb, p_xp int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_qty int; v_inst jsonb; v_uid uuid; v_uids jsonb := '[]'::jsonb;
  v_card text; v_minted int;
begin
  -- 1. Consumir el sobre (con bloqueo de fila). Si no hay, aborta todo.
  select qty into v_qty from public.user_packs
   where user_id = p_user and pack_id = p_pack_id for update;
  if v_qty is null or v_qty < 1 then
    raise exception 'No tienes ese sobre' using errcode = 'P0001';
  end if;
  update public.user_packs set qty = qty - 1 where user_id = p_user and pack_id = p_pack_id;

  -- 2. Insertar las instancias acuñadas.
  for v_inst in select * from jsonb_array_elements(p_instances) loop
    insert into public.user_cards (user_id, card_id, serial, origin)
    values (p_user, v_inst->>'cardId',
            nullif(v_inst->>'serial','null')::int,
            coalesce(v_inst->>'origin','pack'))
    returning uid into v_uid;
    v_uids := v_uids || to_jsonb(v_uid);
  end loop;

  -- 3. Fundir los contadores globales de acuñación (nunca hacia atrás).
  for v_card, v_minted in select key, value::int from jsonb_each_text(coalesce(p_mint_delta,'{}'::jsonb)) loop
    insert into public.card_mints (card_id, minted) values (v_card, v_minted)
    on conflict (card_id) do update set minted = greatest(public.card_mints.minted, excluded.minted);
  end loop;

  -- 4. Pity + contador de aperturas.
  insert into public.user_game (user_id, pity, packs_opened, updated_at)
  values (p_user, coalesce(p_pity, '{"version":1,"counters":{}}'::jsonb), 1, now())
  on conflict (user_id) do update
    set pity = coalesce(p_pity, public.user_game.pity),
        packs_opened = public.user_game.packs_opened + 1,
        updated_at = now();

  -- 5. XP (columna protegida: solo el servidor puede tocarla).
  if p_xp <> 0 then
    update public.profiles set xp = xp + p_xp where id = p_user;
  end if;

  return jsonb_build_object('uids', v_uids, 'packId', p_pack_id);
end; $$;

-- ── Conceder cartas ya decididas (recompensas) ──────────────────────────────
create or replace function public.app_grant_cards(
  p_user uuid, p_instances jsonb, p_mint_delta jsonb, p_origin text default 'reward')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inst jsonb; v_uid uuid; v_uids jsonb := '[]'::jsonb; v_card text; v_minted int;
begin
  for v_inst in select * from jsonb_array_elements(p_instances) loop
    insert into public.user_cards (user_id, card_id, serial, origin)
    values (p_user, v_inst->>'cardId', nullif(v_inst->>'serial','null')::int,
            coalesce(v_inst->>'origin', p_origin))
    returning uid into v_uid;
    v_uids := v_uids || to_jsonb(v_uid);
  end loop;
  for v_card, v_minted in select key, value::int from jsonb_each_text(coalesce(p_mint_delta,'{}'::jsonb)) loop
    insert into public.card_mints (card_id, minted) values (v_card, v_minted)
    on conflict (card_id) do update set minted = greatest(public.card_mints.minted, excluded.minted);
  end loop;
  return jsonb_build_object('uids', v_uids);
end; $$;

-- ── Otorgar sobres (recompensas) ────────────────────────────────────────────
create or replace function public.app_grant_pack(
  p_user uuid, p_pack_id text, p_count int default 1)
returns int language plpgsql security definer set search_path = public as $$
declare v_qty int;
begin
  insert into public.user_packs (user_id, pack_id, qty) values (p_user, p_pack_id, greatest(p_count,0))
  on conflict (user_id, pack_id) do update set qty = public.user_packs.qty + greatest(p_count,0)
  returning qty into v_qty;
  return v_qty;
end; $$;

-- ----------------------------------------------------------------------------
-- 9. Ninguna de estas RPC es invocable por el cliente
-- ----------------------------------------------------------------------------
revoke all on function public.app_adjust_credits(uuid, bigint, text, text)          from public, anon, authenticated;
revoke all on function public.app_buy_pack(uuid, text, bigint, text)                from public, anon, authenticated;
revoke all on function public.app_apply_pack_open(uuid, text, jsonb, jsonb, jsonb, int) from public, anon, authenticated;
revoke all on function public.app_grant_cards(uuid, jsonb, jsonb, text)             from public, anon, authenticated;
revoke all on function public.app_grant_pack(uuid, text, int)                       from public, anon, authenticated;

grant execute on function public.app_adjust_credits(uuid, bigint, text, text)          to service_role;
grant execute on function public.app_buy_pack(uuid, text, bigint, text)                to service_role;
grant execute on function public.app_apply_pack_open(uuid, text, jsonb, jsonb, jsonb, int) to service_role;
grant execute on function public.app_grant_cards(uuid, jsonb, jsonb, text)             to service_role;
grant execute on function public.app_grant_pack(uuid, text, int)                       to service_role;
