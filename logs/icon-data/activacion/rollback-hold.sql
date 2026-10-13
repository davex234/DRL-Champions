-- =============================================================================
-- ICON · ROLLBACK DE CÓDIGO · PASO 1 · BARRERA + CUSTODIA de los sobres ICON de la release nueva (2026-10-12, v2)
-- =============================================================================
-- Cuándo: SOLO si se vuelve a la release anterior (drl-0.1.1-1-e5db60b6) con la release nueva todavía sirviendo.
-- Se ejecuta ANTES de `bin/deploy.sh --activate <anterior>`. Después: `rollback-unfreeze.sql`.
--
-- Por qué: la release anterior no conoce `icon-single` y su `icon` es OTRO producto (3 cartas 70 % Prime / 30 % Icon,
-- 60.000): abrir allí un ICON Premium de 80.000 entregaría menos de lo comprado.
--
-- Qué hace, en UNA transacción:
--   1. `LOCK TABLE user_packs`: espera a que terminen las compras/aperturas/crafteos en vuelo y retiene las nuevas.
--   2. BARRERA: un disparador que rechaza cualquier cambio de cantidad de `icon` / `icon-single`. Compra, apertura,
--      crafteo y recompensa son cada una UNA función transaccional sin `EXCEPTION WHEN` (comprobado en producción): el
--      rechazo aborta la operación entera — no se cobra, no se consumen sobres, no se entrega nada a medias.
--   3. CUSTODIA: mueve las unidades sin abrir a `ops_pack_escrow` (mismo usuario, misma cantidad).
-- Al confirmar, lo que estaba en vuelo ya está custodiado y lo que llegue después se rechaza: no queda ninguna ventana
-- en la que una compra pueda quedar fuera. No borra inventario, no devuelve créditos, no toca el libro ni las cartas.
-- Idempotente. Sin `-v commit=1` termina en ROLLBACK (ensayo; el candado dura lo que la transacción).
--
--   psql -X -v ON_ERROR_STOP=1 -v batch=i18n-icon-2026-10 [-v commit=1] -f rollback-hold.sql
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '30s';
LOCK TABLE public.user_packs IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.ops_pack_escrow (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch       text        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  pack_id     text        NOT NULL,
  qty         integer     NOT NULL CHECK (qty > 0),
  reason      text        NOT NULL,
  held_at     timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
ALTER TABLE public.ops_pack_escrow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_pack_escrow FROM PUBLIC, anon, authenticated;

-- BARRERA. Solo deja pasar a los propios scripts de operaciones (`SET LOCAL vr.ops_escrow = 'on'`).
CREATE OR REPLACE FUNCTION public.ops_icon_pack_freeze() RETURNS trigger LANGUAGE plpgsql AS $freeze$
BEGIN
  IF current_setting('vr.ops_escrow', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.pack_id IN ('icon', 'icon-single') AND OLD.qty > 0 THEN
      RAISE EXCEPTION 'ICON_PACKS_FROZEN' USING ERRCODE = 'P0001', HINT = 'Sobres ICON en pausa por mantenimiento: no se ha cobrado ni consumido nada.';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.pack_id IN ('icon', 'icon-single')
     AND ((TG_OP = 'INSERT' AND NEW.qty > 0) OR (TG_OP = 'UPDATE' AND NEW.qty IS DISTINCT FROM OLD.qty)) THEN
    RAISE EXCEPTION 'ICON_PACKS_FROZEN' USING ERRCODE = 'P0001', HINT = 'Sobres ICON en pausa por mantenimiento: no se ha cobrado ni consumido nada.';
  END IF;
  RETURN NEW;
END $freeze$;
REVOKE ALL ON FUNCTION public.ops_icon_pack_freeze() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ops_icon_pack_freeze ON public.user_packs;
CREATE TRIGGER ops_icon_pack_freeze BEFORE INSERT OR UPDATE OR DELETE ON public.user_packs
  FOR EACH ROW EXECUTE FUNCTION public.ops_icon_pack_freeze();

SELECT 'antes' AS fase, pack_id, count(*) AS cuentas, sum(qty) AS unidades
  FROM public.user_packs WHERE pack_id IN ('icon-single', 'icon') AND qty > 0 GROUP BY pack_id ORDER BY pack_id;

-- CUSTODIA. Una fila por (usuario, sobre) con unidades; se restan exactamente las unidades custodiadas.
SET LOCAL vr.ops_escrow = 'on';
WITH held AS (
  INSERT INTO public.ops_pack_escrow (batch, user_id, pack_id, qty, reason)
  SELECT :'batch', p.user_id, p.pack_id, p.qty, 'rollback de código: sobre ICON de la release nueva, en custodia hasta volver a publicarla'
    FROM public.user_packs p
   WHERE p.pack_id IN ('icon-single', 'icon') AND p.qty > 0
  RETURNING user_id, pack_id, qty
)
UPDATE public.user_packs u SET qty = u.qty - h.qty
  FROM held h WHERE u.user_id = h.user_id AND u.pack_id = h.pack_id;
SET LOCAL vr.ops_escrow = 'off';

DO $verify$
DECLARE v bigint;
BEGIN
  SELECT coalesce(sum(qty), 0) INTO v FROM public.user_packs WHERE pack_id IN ('icon-single', 'icon') AND qty > 0;
  IF v <> 0 THEN RAISE EXCEPTION 'quedan % unidades ICON sin custodiar', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_packs'::regclass AND tgname = 'ops_icon_pack_freeze' AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'la barrera no está activa';
  END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: barrera activa; 0 unidades ICON en inventarios; en custodia sin devolver: %',
    (SELECT coalesce(sum(qty), 0) FROM public.ops_pack_escrow WHERE released_at IS NULL);
END $verify$;

SELECT 'custodia' AS fase, batch, pack_id, count(*) AS cuentas, sum(qty) AS unidades
  FROM public.ops_pack_escrow WHERE released_at IS NULL GROUP BY batch, pack_id ORDER BY batch, pack_id;

\if :{?commit}
  COMMIT;
  \echo 'COMMIT: barrera activa y unidades en custodia'
\else
  ROLLBACK;
  \echo 'ENSAYO: ROLLBACK, no se ha escrito nada'
\endif
