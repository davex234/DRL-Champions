-- ============================================================================================================
-- ROLLBACK OPERATIVO de 0062 (F82 · Collection Sets). Ejecutar SOLO tras desplegar antes el código anterior a F82
-- (drl-0.1.1-1-dbe08499): la app de F82 lee estas tablas/RPC y, sin ellas, la Sala de Trofeos responde 503 NOT_READY
-- y el perfil enseña 0 insignias destacadas (degradación probada), pero la app anterior no las usa en absoluto.
--
-- PIERDE DATOS de F82: compleciones e insignias destacadas. Las insignias concedidas en `user_cosmetics`
-- (`insignia:coleccion:*`, source `collection:*`) NO se borran aquí a propósito (son del usuario; quitarlas sería una
-- decisión de producto aparte). Antes: backup (pre-0062 existe) y exportar las dos tablas si se quieren conservar.
--   psql … -v ON_ERROR_STOP=1 < 0062_collection_sets.ROLLBACK.sql     (el operador pone BEGIN/COMMIT si lo desea;
--   el fichero ya es una sola transacción)
-- ============================================================================================================
begin;
drop function if exists public.player_profile_set_badges(uuid, text[], int);
alter table public.player_profile_customization
  drop constraint if exists ppc_badges_max,
  drop constraint if exists ppc_badges_no_nulls,
  drop constraint if exists ppc_badges_unique,
  drop column if exists featured_badge_ids;
drop function if exists public.app_collection_claim(uuid, text);
drop table if exists public.user_collection_completions;
drop trigger if exists trg_collection_sets_guard on public.collection_sets;
drop trigger if exists trg_collection_sets_insert_guard on public.collection_sets;
drop table if exists public.collection_sets;
drop function if exists public._collection_sets_guard();
drop function if exists public._collection_sets_insert_guard();
commit;
