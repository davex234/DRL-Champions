-- ============================================================================
-- FASE 18 · DRL CREDITS — LA MONEDA OFICIAL DE DRL CARDS
--
-- ────────────────────────── QUÉ NO HACE ESTA MIGRACIÓN ──────────────────────────
--
-- No crea una moneda nueva, no crea una tabla de saldos y no toca ni un saldo existente.
-- `profiles.credits` sigue siendo la ÚNICA fuente de verdad y `_ledger_apply` la única
-- puerta que lo mueve. Lo que cambia es la IDENTIDAD (esos créditos se llaman DRL Credits)
-- y se añade el camino de compra en SANDBOX.
--
-- No conecta ninguna pasarela. No hay Stripe, ni PayPal, ni llamada externa, ni un solo
-- euro. `PAYMENTS_ENABLED` sigue en falso.
--
-- ────────────────────────── POR QUÉ HAY MIGRACIÓN ──────────────────────────
--
-- Solo por una razón: el `check` de `credit_transactions.kind` admitía cinco valores y la
-- Fase 18 pide poder distinguir estructuralmente una COMPRA de una recompensa y una
-- DEVOLUCIÓN de una reversión de mercado. Codificarlo en el texto de `reason` obligaría a
-- parsear cadenas para responder «cuántos DRL Credits se han comprado», que es justo la
-- clase de consulta que un libro mayor debe responder por columna.
--
-- Ampliar un CHECK es **aditivo y reversible**: ninguna fila existente deja de cumplirlo,
-- ningún saldo se recalcula y volver atrás es restaurar la restricción anterior.
--
-- ────────────────────────── LAS TRES INVARIANTES ──────────────────────────
--
-- 1. **El cliente nombra un PRODUCTO, nunca una cantidad.** Cuántos DRL Credits lleva cada
--    producto lo dice el catálogo del servidor (`src/domain/economy/drlCredits.ts`). Aquí
--    llega ya resuelto, y queda escrito en `payments.product_id`.
-- 2. **Una compra se liquida UNA vez.** Idempotencia por `economy_ops.ref` (clave primaria)
--    y por el índice único `(user_id, ref)` de `credit_transactions`. Repetir la petición
--    devuelve el mismo resultado y concede 0.
-- 3. **Una devolución exige la compra original.** No existe el reembolso arbitrario: hay
--    que nombrar la referencia de la compra, tiene que ser del mismo usuario y tiene que
--    estar concedida.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TIPOS DE MOVIMIENTO — se AMPLÍA la restricción, no se sustituye la semántica
-- ----------------------------------------------------------------------------
--
--   credit / debit            EARN / SPEND   (los de siempre; nada que migrar)
--   transfer_in/out           mercado entre jugadores
--   reversal                  reversión interna
--   purchase                  COMPRA de DRL Credits            ← nuevo
--   refund                    DEVOLUCIÓN de una compra         ← nuevo
--   adjustment                ajuste administrativo trazado    ← nuevo
--
-- Las filas ya escritas usan los cinco antiguos y siguen siendo válidas.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'credit_tx_kind_check') then
    alter table public.credit_transactions drop constraint credit_tx_kind_check;
  end if;
  alter table public.credit_transactions
    add constraint credit_tx_kind_check
    check (kind in ('credit', 'debit', 'transfer_in', 'transfer_out', 'reversal',
                    'purchase', 'refund', 'adjustment'));
end $$;

comment on column public.credit_transactions.kind is
  'credit | debit | transfer_in | transfer_out | reversal | purchase | refund | adjustment. '
  'purchase = compra de DRL Credits; refund = su devolución; adjustment = ajuste administrativo.';

-- ----------------------------------------------------------------------------
-- 2. COMPRA SANDBOX
-- ----------------------------------------------------------------------------
--
-- Atraviesa la MISMA frontera que atravesará el dinero real (la tabla `payments` de la
-- 0021), para que el día que se conecte una pasarela no haya que inventar el camino: solo
-- cambia quién marca el pago como cobrado. `provider = 'sandbox'` es lo que hace imposible
-- confundir una compra de prueba con un cobro: no es una etiqueta de la interfaz, es una
-- columna de la base de datos.
--
-- `p_price_cents` es el precio de REFERENCIA del catálogo. Se guarda porque `payments`
-- exige un importe y porque el día de mañana hay que poder comparar lo anunciado con lo
-- cobrado. NO representa un cobro: no se ha movido un céntimo.
create or replace function public.app_sandbox_purchase(
  p_user        uuid,
  p_product_id  text,
  p_credits     bigint,
  p_price_cents bigint,
  p_currency    text,
  p_ref         text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_balance bigint; v_payment uuid;
begin
  if p_ref is null or length(btrim(p_ref)) = 0 then
    raise exception 'Referencia obligatoria' using errcode = 'P0001';
  end if;
  -- Cantidad: entera y positiva. Un producto que conceda 0 o negativo no es un producto.
  if p_credits is null or p_credits <= 0 then
    raise exception 'Cantidad inválida' using errcode = 'P0001';
  end if;

  -- Idempotencia: la misma operación devuelve lo mismo y NO vuelve a conceder.
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev; end if;

  insert into public.payments
    (user_id, product_id, amount_cents, currency, provider, provider_tx_id,
     status, idempotency_key, credits_granted, paid_at, granted_at)
  values
    (p_user, p_product_id, p_price_cents, p_currency, 'sandbox', 'sandbox:' || p_ref,
     'granted', p_ref, p_credits, now(), now())
  returning id into v_payment;

  -- Los DRL Credits entran por la puerta de siempre. No hay una segunda puerta.
  v_balance := public._ledger_apply(
    p_user, p_credits, 'sandbox_purchase:' || p_product_id, p_ref, 'purchase');

  v_prev := jsonb_build_object(
    'credits', v_balance, 'granted', p_credits,
    'productId', p_product_id, 'paymentId', v_payment, 'sandbox', true);

  insert into public.economy_ops (ref, user_id, kind, result)
  values (p_ref, p_user, 'sandbox_purchase', v_prev);
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 3. DEVOLUCIÓN SANDBOX
-- ----------------------------------------------------------------------------
--
-- Exige la referencia de la compra ORIGINAL. Sin ella no hay devolución posible, que es lo
-- que impide el reembolso arbitrario: nadie puede pedir «devuélveme 5.000» a secas.
--
-- Si el jugador ya se gastó los DRL Credits, `_ledger_apply` corta por saldo insuficiente.
-- Es lo correcto: el saldo no puede quedar negativo ni siquiera devolviendo.
create or replace function public.app_sandbox_refund(
  p_user         uuid,
  p_purchase_ref text,
  p_ref          text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_balance bigint; v_pay record;
begin
  if p_ref is null or length(btrim(p_ref)) = 0 then
    raise exception 'Referencia obligatoria' using errcode = 'P0001';
  end if;

  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev; end if;

  -- La compra original: tiene que existir, ser de ESTE usuario y estar concedida.
  -- El filtro por `user_id` es lo que impide devolver la compra de otro.
  select * into v_pay from public.payments
   where idempotency_key = p_purchase_ref and user_id = p_user and provider = 'sandbox';
  if not found then
    raise exception 'Compra original inexistente' using errcode = 'P0001';
  end if;
  if v_pay.status = 'refunded' then
    raise exception 'La compra ya fue devuelta' using errcode = 'P0001';
  end if;
  if v_pay.status <> 'granted' or coalesce(v_pay.credits_granted, 0) <= 0 then
    raise exception 'La compra no está concedida' using errcode = 'P0001';
  end if;

  v_balance := public._ledger_apply(
    p_user, -v_pay.credits_granted, 'sandbox_refund:' || v_pay.product_id, p_ref, 'refund');

  update public.payments set status = 'refunded', updated_at = now() where id = v_pay.id;

  v_prev := jsonb_build_object(
    'credits', v_balance, 'refunded', v_pay.credits_granted,
    'productId', v_pay.product_id, 'paymentId', v_pay.id, 'sandbox', true);

  insert into public.economy_ops (ref, user_id, kind, result)
  values (p_ref, p_user, 'sandbox_refund', v_prev);
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 4. NADA DE ESTO ES INVOCABLE DESDE EL NAVEGADOR
-- ----------------------------------------------------------------------------
revoke all on function public.app_sandbox_purchase(uuid, text, bigint, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.app_sandbox_refund(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.app_sandbox_purchase(uuid, text, bigint, bigint, text, text)
  to service_role;
grant execute on function public.app_sandbox_refund(uuid, text, text)
  to service_role;
