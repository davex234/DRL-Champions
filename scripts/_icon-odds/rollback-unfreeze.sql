-- =============================================================================
-- ICON · ROLLBACK DE CÓDIGO · PASO 3 · RETIRAR LA BARRERA (2026-10-12)
-- =============================================================================
-- Cuándo: DESPUÉS de `rollback-hold.sql` y de `bin/deploy.sh --activate <release anterior>`, con la release anterior
-- ya sirviendo. A partir de ahí un `icon` que se compre es el producto antiguo, coherente con el código que lo abre, y
-- `icon-single` no se puede comprar ni abrir (la release anterior responde 404 sin consumir). La custodia NO se toca.
-- Si lo que se activa a continuación es OTRA VEZ la release nueva, no hace falta: `rollback-release.sql` la retira.
-- Idempotente. Sin `-v commit=1` → ROLLBACK.
--
--   psql -X -v ON_ERROR_STOP=1 [-v commit=1] -f rollback-unfreeze.sql
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '30s';
DROP TRIGGER IF EXISTS ops_icon_pack_freeze ON public.user_packs;
DROP FUNCTION IF EXISTS public.ops_icon_pack_freeze();
SELECT 'barrera' AS fase, count(*) AS activa FROM pg_trigger WHERE tgrelid = 'public.user_packs'::regclass AND tgname = 'ops_icon_pack_freeze';
SELECT 'custodia sin devolver' AS fase, coalesce(sum(qty), 0) AS unidades FROM public.ops_pack_escrow WHERE released_at IS NULL;
\if :{?commit}
  COMMIT;
  \echo 'COMMIT: barrera retirada'
\else
  ROLLBACK;
  \echo 'ENSAYO: ROLLBACK, no se ha escrito nada'
\endif
