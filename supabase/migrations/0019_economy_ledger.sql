-- ============================================================================
-- FASE 11 · LIBRO MAYOR ECONÓMICO E IDEMPOTENCIA REAL
--
-- ────────────────────────── QUÉ ENCONTRÓ LA AUDITORÍA ──────────────────────────
--
-- El libro mayor (`credit_transactions`, migración 0011) ya era bueno: una fila por
-- movimiento, saldo resultante, clave de idempotencia con índice único y RLS que solo
-- deja LEER lo propio. Pero tenía tres agujeros, y los tres son de la clase que no se ve
-- hasta que alguien pierde créditos:
--
--   1. **La idempotencia era OPCIONAL, y en la práctica no se usaba.**
--      `app_buy_pack` acepta `p_ref default null`; la ruta `/api/game/packs` lo lee del
--      cuerpo (`body.ref`) — y el cliente (`lib/game/client.ts`) **nunca lo envía**. Es
--      decir: la única operación que gasta créditos del juego NO era idempotente. Dos
--      clics seguidos = dos cobros.
--
--   2. **Abrir un sobre no tenía clave NI dejaba rastro.**
--      `app_apply_pack_open` consume un sobre y acuña cartas sin ninguna clave de
--      idempotencia y sin escribir en el libro mayor. Un reintento por timeout de red
--      consume un segundo sobre. Y `buy_and_open` era peor: al reintentar, la compra se
--      saltaba por su `ref` y la apertura **volvía a ejecutarse**, así que el jugador
--      perdía un sobre del inventario a cambio de nada.
--
--   3. **Una transferencia no se podía representar.**
--      El libro mayor no tiene contraparte. Una venta en el mercado son dos filas sueltas
--      sin nada que las una, y no se puede responder «¿quién recibió estos créditos?».
--      Además, las RPC del mercado (0004) escriben `profiles.credits` DIRECTAMENTE, así
--      que hoy no dejarían ni esas dos filas.
--
-- ────────────────────────── QUÉ HACE ESTA MIGRACIÓN ──────────────────────────
--
--   · `credit_transactions` gana `kind` y `counterparty_id`: el libro mayor pasa a
--     distinguir CREDIT / DEBIT / TRANSFER / REVERSAL y a saber con quién.
--   · Nace `economy_ops`: el registro de OPERACIONES idempotentes. No guarda solo que
--     algo pasó — guarda su RESULTADO, para que un reintento devuelva lo mismo en vez de
--     ejecutar otra vez o fallar.
--   · `_ledger_apply` centraliza el movimiento de saldo. Ninguna RPC vuelve a tocar
--     `profiles.credits` por su cuenta.
--   · `app_apply_pack_open` acepta clave y devuelve el resultado guardado si se repite.
--   · Nace `app_salvage_cards`: el sumidero de duplicados, server-authoritative.
--
-- ────────────────────────── LO QUE NO CAMBIA ──────────────────────────
--
--   · La forma de las claves ya escritas (`duel:…`, `pickem:…`, `pass:…`) se respeta:
--     el índice único sigue siendo (user_id, ref).
--   · `app_grant_reward` (0018) ya exigía clave y no se toca su contrato.
--   · Ninguna RPC nueva es invocable desde el navegador.
--   · El motor de sorteo de sobres, el catálogo y las reglas de carta no se tocan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL LIBRO MAYOR APRENDE A CONTAR TRANSFERENCIAS
-- ----------------------------------------------------------------------------

alter table public.credit_transactions
  add column if not exists kind text,
  add column if not exists counterparty_id uuid references auth.users(id) on delete set null;

-- Las filas antiguas no tienen `kind`. Se deduce del signo, que es exactamente la
-- información que había: no se inventa nada.
update public.credit_transactions
   set kind = case when delta >= 0 then 'credit' else 'debit' end
 where kind is null;

alter table public.credit_transactions
  alter column kind set default 'credit';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'credit_tx_kind_check') then
    alter table public.credit_transactions
      add constraint credit_tx_kind_check
      check (kind in ('credit', 'debit', 'transfer_in', 'transfer_out', 'reversal'));
  end if;
end $$;

-- Consultar «qué me ha movido con esta persona» sin recorrer el libro entero.
create index if not exists credit_tx_counterparty_idx
  on public.credit_transactions(counterparty_id, created_at desc)
  where counterparty_id is not null;

comment on column public.credit_transactions.kind is
  'credit | debit | transfer_in | transfer_out | reversal. Una transferencia son DOS filas (out y in) con la misma raíz de ref.';
comment on column public.credit_transactions.counterparty_id is
  'La otra parte de una transferencia. Nulo en creaciones y destrucciones de créditos.';

-- ----------------------------------------------------------------------------
-- 2. REGISTRO DE OPERACIONES IDEMPOTENTES
-- ----------------------------------------------------------------------------
--
-- Por qué una tabla aparte y no reutilizar `credit_transactions`:
--
--   El libro mayor responde «cuánto se movió». Esto responde «qué devolvió la operación».
--   Son preguntas distintas: abrir un sobre no mueve un solo crédito y aun así tiene que
--   ser irrepetible, y su reintento tiene que devolver LAS MISMAS CARTAS, no otras.
--   Guardar el resultado es lo que convierte «no repetir» en «responder igual».
create table if not exists public.economy_ops (
  -- La clave la elige quien llama, y es el contrato: misma clave, misma operación.
  ref        text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Qué clase de operación fue: buy_pack | open_pack | salvage | market_buy | …
  kind       text not null,
  -- Lo que devolvió. Un reintento recibe esto tal cual, sin volver a ejecutar.
  result     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists economy_ops_user_idx on public.economy_ops(user_id, created_at desc);

alter table public.economy_ops enable row level security;
revoke insert, update, delete on public.economy_ops from anon, authenticated;
drop policy if exists "tus operaciones (lectura)" on public.economy_ops;
create policy "tus operaciones (lectura)" on public.economy_ops
  for select using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. EL ÚNICO SITIO QUE MUEVE SALDO
-- ----------------------------------------------------------------------------
--
-- Todas las RPC económicas pasan por aquí. Antes cada una hacía su propio
-- `update profiles set credits = …`, y las del mercado (0004) ni siquiera escribían en el
-- libro mayor. Con una sola puerta, auditar la economía es auditar esta función.
create or replace function public._ledger_apply(
  p_user         uuid,
  p_delta        bigint,
  p_reason       text,
  p_ref          text,
  p_kind         text default null,
  p_counterparty uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_balance bigint; v_kind text;
begin
  select credits into v_balance from public.profiles where id = p_user for update;
  if v_balance is null then raise exception 'Perfil inexistente'; end if;

  -- El saldo NUNCA queda en negativo. Es la última línea de defensa: aunque una RPC se
  -- olvidara de comprobar el saldo antes, aquí se corta.
  if v_balance + p_delta < 0 then
    raise exception 'Saldo insuficiente' using errcode = 'P0001';
  end if;

  v_balance := v_balance + p_delta;
  update public.profiles set credits = v_balance where id = p_user;

  v_kind := coalesce(p_kind, case when p_delta >= 0 then 'credit' else 'debit' end);

  insert into public.credit_transactions
    (user_id, delta, reason, ref, balance_after, kind, counterparty_id)
  values (p_user, p_delta, p_reason, p_ref, v_balance, v_kind, p_counterparty);

  return v_balance;
end; $$;

-- ----------------------------------------------------------------------------
-- 4. AJUSTE DE CRÉDITOS — ahora sobre la puerta única
-- ----------------------------------------------------------------------------
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
  return public._ledger_apply(p_user, p_delta, p_reason, p_ref);
end; $$;

-- ----------------------------------------------------------------------------
-- 5. COMPRAR UN SOBRE — la clave deja de ser opcional
-- ----------------------------------------------------------------------------
--
-- `p_ref` pasa a ser OBLIGATORIA. Es el arreglo del agujero nº 1: la única operación que
-- gasta créditos del juego no era idempotente porque nadie le pasaba clave. Ahora, si no
-- llega clave, la operación se rechaza — y quien llama (el servicio de Node) siempre
-- genera una.
-- Se elimina la firma con `p_ref default null` antes de crear la nueva SIN valor por
-- defecto: dejar el defecto permitiría seguir llamando sin clave, que es justo el fallo.
drop function if exists public.app_buy_pack(uuid, text, bigint, text);

create or replace function public.app_buy_pack(
  p_user uuid, p_pack_id text, p_price bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_balance bigint; v_qty int; v_prev jsonb;
begin
  if p_price < 0 then raise exception 'Precio inválido'; end if;
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'Una compra necesita clave de idempotencia';
  end if;

  -- Repetición: se devuelve lo mismo que la primera vez, sin cobrar de nuevo.
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  v_balance := public._ledger_apply(p_user, -p_price, 'buy_pack:' || p_pack_id, p_ref, 'debit');

  insert into public.user_packs (user_id, pack_id, qty) values (p_user, p_pack_id, 1)
  on conflict (user_id, pack_id) do update set qty = public.user_packs.qty + 1
  returning qty into v_qty;

  v_prev := jsonb_build_object('credits', v_balance, 'packId', p_pack_id, 'qty', v_qty);
  insert into public.economy_ops (ref, user_id, kind, result)
  values (p_ref, p_user, 'buy_pack', v_prev);
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 6. ABRIR UN SOBRE — idempotente y con resultado guardado
-- ----------------------------------------------------------------------------
--
-- Arreglo del agujero nº 2. Un reintento devuelve LAS MISMAS CARTAS (los mismos `uid`),
-- no otras y no ninguna. Es lo que hace que `buy_and_open` se pueda reintentar entero sin
-- que el jugador pierda un sobre.
drop function if exists public.app_apply_pack_open(uuid, text, jsonb, jsonb, jsonb, int);

create or replace function public.app_apply_pack_open(
  p_user uuid, p_pack_id text, p_instances jsonb, p_pity jsonb,
  p_mint_delta jsonb, p_xp int default 0, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_qty int; v_inst jsonb; v_uid uuid; v_uids jsonb := '[]'::jsonb;
  v_card text; v_minted int; v_prev jsonb;
begin
  if p_ref is not null then
    select result into v_prev from public.economy_ops where ref = p_ref;
    if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;
  end if;

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

  v_prev := jsonb_build_object('uids', v_uids, 'packId', p_pack_id);
  if p_ref is not null then
    insert into public.economy_ops (ref, user_id, kind, result)
    values (p_ref, p_user, 'open_pack', v_prev);
  end if;
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 7. DESGUACE DE DUPLICADOS — el sumidero que faltaba
-- ----------------------------------------------------------------------------
--
-- QUIÉN DECIDE EL VALOR. **No el cliente, y tampoco esta función.** El importe lo calcula
-- Node a partir del catálogo (`domain/economy/salvage`), que es la fuente de verdad de qué
-- rareza tiene cada carta, y llega aquí ya cerrado. Esta RPC hace lo que la base de datos
-- puede garantizar y Node no: que las cartas sean tuyas, que no estén bloqueadas, que
-- desaparezcan y que el pago ocurra en la misma transacción.
--
-- POR QUÉ NO SE USA `quickSellValue`. Porque el análisis de la Fase 11 demostró que el
-- valor de mercado de una carta está entre 7 y 15 veces por encima del precio del sobre
-- que la produce: pagar el 80 % de eso por desguazarla convierte la tienda en una
-- impresora de dinero. El desguace tiene su propia tabla, calibrada contra el PRECIO DEL
-- SOBRE. Está documentado en `docs/product/economy.md`.
create or replace function public.app_salvage_cards(
  p_user uuid, p_uids uuid[], p_total bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int; v_balance bigint; v_prev jsonb;
begin
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'Un desguace necesita clave de idempotencia';
  end if;
  if p_total < 0 then raise exception 'Importe inválido'; end if;
  if p_uids is null or array_length(p_uids, 1) is null then
    raise exception 'No hay cartas que desguazar';
  end if;

  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  /*
    Se bloquean las filas ANTES de contar. Sin el `for update`, dos peticiones simultáneas
    podrían contar las mismas diez cartas y cobrar dos veces por ellas: la segunda borraría
    cero filas y aun así habría pagado.
  */
  perform 1 from public.user_cards
   where uid = any(p_uids) and user_id = p_user and locked = false
   for update;

  select count(*) into v_count from public.user_cards
   where uid = any(p_uids) and user_id = p_user and locked = false;

  if v_count <> array_length(p_uids, 1) then
    raise exception 'Alguna de esas cartas no es tuya o está bloqueada' using errcode = 'P0001';
  end if;

  delete from public.user_cards where uid = any(p_uids) and user_id = p_user and locked = false;

  v_balance := public._ledger_apply(p_user, p_total, 'salvage', p_ref, 'credit');

  v_prev := jsonb_build_object('credits', v_balance, 'salvaged', v_count, 'paid', p_total);
  insert into public.economy_ops (ref, user_id, kind, result)
  values (p_ref, p_user, 'salvage', v_prev);
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 8. NADA DE ESTO ES INVOCABLE DESDE EL NAVEGADOR
-- ----------------------------------------------------------------------------
revoke all on function public._ledger_apply(uuid, bigint, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.app_adjust_credits(uuid, bigint, text, text)         from public, anon, authenticated;
revoke all on function public.app_buy_pack(uuid, text, bigint, text)               from public, anon, authenticated;
revoke all on function public.app_apply_pack_open(uuid, text, jsonb, jsonb, jsonb, int, text) from public, anon, authenticated;
revoke all on function public.app_salvage_cards(uuid, uuid[], bigint, text)        from public, anon, authenticated;

grant execute on function public._ledger_apply(uuid, bigint, text, text, text, uuid) to service_role;
grant execute on function public.app_adjust_credits(uuid, bigint, text, text)         to service_role;
grant execute on function public.app_buy_pack(uuid, text, bigint, text)               to service_role;
grant execute on function public.app_apply_pack_open(uuid, text, jsonb, jsonb, jsonb, int, text) to service_role;
grant execute on function public.app_salvage_cards(uuid, uuid[], bigint, text)        to service_role;
