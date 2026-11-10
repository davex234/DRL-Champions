-- =============================================================================
-- ICON · DEVOLVER a los inventarios los sobres en custodia (2026-10-12, v2) — pareja de `rollback-hold.sql`
-- =============================================================================
-- Cuándo: DESPUÉS de volver a activar una release que conoce `icon-single` y el ICON Premium de 3 ICON.
-- En UNA transacción: retira la barrera si seguía puesta y devuelve cada unidad a su dueño (1:1), marcando la fila como
-- devuelta. Idempotente. Sin `-v commit=1` → ROLLBACK.
--
--   psql -X -v ON_ERROR_STOP=1 -v batch=i18n-icon-2026-10 [-v commit=1] -f rollback-release.sql
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '30s';
LOCK TABLE public.user_packs IN SHARE ROW EXCLUSIVE MODE;

SELECT 'antes' AS fase, pack_id, count(*) AS cuentas, sum(qty) AS unidades
  FROM public.ops_pack_escrow WHERE batch = :'batch' AND released_at IS NULL GROUP BY pack_id ORDER BY pack_id;

SET LOCAL vr.ops_escrow = 'on';
WITH back AS (
  UPDATE public.ops_pack_escrow SET released_at = now()
   WHERE batch = :'batch' AND released_at IS NULL
  RETURNING user_id, pack_id, qty
), agg AS (
  SELECT user_id, pack_id, sum(qty)::int AS qty FROM back GROUP BY user_id, pack_id
)
INSERT INTO public.user_packs (user_id, pack_id, qty)
SELECT user_id, pack_id, qty FROM agg
ON CONFLICT (user_id, pack_id) DO UPDATE SET qty = public.user_packs.qty + EXCLUDED.qty;
SET LOCAL vr.ops_escrow = 'off';

DROP TRIGGER IF EXISTS ops_icon_pack_freeze ON public.user_packs;
DROP FUNCTION IF EXISTS public.ops_icon_pack_freeze();

DO $verify$
BEGIN
  RAISE NOTICE 'VERIFICACIÓN: barrera retirada; custodia sin devolver (todos los lotes): %',
    (SELECT coalesce(sum(qty), 0) FROM public.ops_pack_escrow WHERE released_at IS NULL);
END $verify$;

SELECT 'despues' AS fase, pack_id, count(*) AS cuentas, sum(qty) AS unidades
  FROM public.user_packs WHERE pack_id IN ('icon-single', 'icon') AND qty > 0 GROUP BY pack_id ORDER BY pack_id;

\if :{?commit}
  COMMIT;
  \echo 'COMMIT: unidades devueltas'
\else
  ROLLBACK;
  \echo 'ENSAYO: ROLLBACK, no se ha escrito nada'
\endif
