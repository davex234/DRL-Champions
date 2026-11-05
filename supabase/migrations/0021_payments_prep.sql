-- ============================================================================
-- FASE 11 · PREPARACIÓN PARA DINERO REAL — SIN PASARELA
--
-- ────────────────────────── QUÉ ES Y QUÉ NO ES ──────────────────────────
--
-- Esto NO integra ningún proveedor de pago. §12 sigue vigente: sin infraestructura de
-- cobro segura no se conecta ninguna pasarela, y `PAYMENTS_ENABLED` sigue en falso.
--
-- Lo que se crea es la FRONTERA. La Fase 11 pide separar conceptualmente:
--
--     DINERO REAL  →  PAGO  →  CONCESIÓN  →  DRL CREDITS
--
-- y esa separación tiene que existir en el esquema ANTES de que llegue el primer euro. Si
-- se improvisa el día de la integración, lo que sale es una ruta que acepta «dame 5.000
-- créditos» del navegador, que es exactamente el fallo que esta tabla hace imposible.
--
-- ────────────────────────── LAS CUATRO INVARIANTES ──────────────────────────
--
-- **1. El cliente NUNCA nombra una cantidad de créditos.** Nombra un PRODUCTO. Cuántos
--    créditos lleva ese producto lo dice el catálogo del servidor. Por eso aquí hay
--    `product_id` y no un `credits` que venga de fuera: `credits_granted` lo escribe el
--    servidor al liquidar.
--
-- **2. Un pago se verifica contra el PROVEEDOR, no contra el cliente.** `provider` y
--    `provider_tx_id` son la prueba, y son únicos: el mismo cobro no se puede liquidar dos
--    veces aunque el webhook llegue tres.
--
-- **3. La concesión de créditos es una operación económica más.** Cuando un pago pase a
--    `granted`, los créditos entran por `app_grant_reward` con `ref = payment:<id>`, igual
--    que cualquier otra recompensa. No hay una segunda puerta para el dinero real.
--
-- **4. El importe real vive en CÉNTIMOS ENTEROS.** Un `numeric` con decimales en una tabla
--    de dinero acaba, tarde o temprano, en un 4,989999999999999.
--
-- ────────────────────────── EL CICLO ──────────────────────────
--
--   created → paid → granted
--      │        │
--      │        └─→ refunded   (el proveedor devuelve; los créditos se revierten)
--      └─→ failed | cancelled
--
-- Ninguna transición la decide el cliente.
-- ============================================================================

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- QUÉ se compró. Un identificador del catálogo del servidor, no una cantidad.
  product_id      text not null,

  -- CUÁNTO dinero real. Céntimos enteros y divisa ISO-4217 en mayúsculas.
  amount_cents    bigint not null check (amount_cents > 0),
  currency        text   not null check (currency ~ '^[A-Z]{3}$'),

  -- QUIÉN lo cobró y con qué referencia suya. Es la prueba del pago.
  provider        text not null,
  provider_tx_id  text,

  status          text not null default 'created'
                  check (status in ('created', 'paid', 'granted', 'failed', 'cancelled', 'refunded')),

  -- Clave de idempotencia de la INTENCIÓN de pago. La genera el servidor al iniciar el
  -- cobro; el proveedor la devuelve en su webhook.
  idempotency_key text not null,

  -- Cuántos créditos se concedieron finalmente. Lo escribe el servidor al liquidar, jamás
  -- el cliente. Nulo mientras el pago no esté concedido.
  credits_granted bigint,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  paid_at         timestamptz,
  granted_at      timestamptz
);

-- Un cobro del proveedor se liquida UNA vez. Es la defensa contra el webhook repetido,
-- que es la norma y no la excepción en todas las pasarelas.
create unique index if not exists payments_provider_tx_uniq
  on public.payments(provider, provider_tx_id) where provider_tx_id is not null;

-- Y una intención de pago se crea una vez.
create unique index if not exists payments_idem_uniq on public.payments(idempotency_key);

create index if not exists payments_user_idx on public.payments(user_id, created_at desc);
create index if not exists payments_status_idx on public.payments(status, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS: el jugador ve SUS pagos y no escribe ninguno
-- ----------------------------------------------------------------------------
alter table public.payments enable row level security;
revoke insert, update, delete on public.payments from anon, authenticated;

drop policy if exists "tus pagos (lectura)" on public.payments;
create policy "tus pagos (lectura)" on public.payments
  for select using (auth.uid() = user_id);

comment on table public.payments is
  'Frontera entre dinero real y DRL Credits (Fase 11). NO hay pasarela conectada: la tabla existe para que la integración futura no tenga que improvisar la separación. El cliente nunca escribe aquí.';
comment on column public.payments.product_id is
  'Producto del catálogo del SERVIDOR. El cliente nombra productos, nunca cantidades de créditos.';
comment on column public.payments.credits_granted is
  'Créditos concedidos al liquidar. Lo escribe el servidor; se concede por app_grant_reward con ref=payment:<id>.';
