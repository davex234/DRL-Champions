-- ============================================================================================================
-- ROLLBACK de 0074 · COLECCIONES ILIMITADAS (índices de cursor y resumen por carta)
--
-- Seguro en cualquier momento: 0074 no cambia tablas, filas ni funciones existentes. Sin la función, el servidor
-- calcula el resumen recorriendo la colección por cursor; sin los índices, ese recorrido ordena en cada página.
-- El juego sigue siendo correcto; solo es más lento con colecciones grandes.
-- ============================================================================================================
begin;
drop function if exists public.app_collection_summary(uuid);
drop index if exists public.user_cards_user_card_uid_idx;
drop index if exists public.user_cards_user_uid_idx;
commit;
