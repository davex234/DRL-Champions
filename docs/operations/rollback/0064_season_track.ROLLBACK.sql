-- ============================================================================================================
-- ROLLBACK OPERATIVO de 0064 (F83 · temporadas, XP de temporada, retos y recompensas de nivel). Ejecutar SOLO tras
-- desplegar antes el código anterior a F83 (drl-0.1.1-1-fd07721d): la app de F83 degrada sin estas tablas (la ruta de
-- temporada responde «sin temporada» y los ganchos no hacen nada), y la app anterior no las usa.
--
-- PIERDE DATOS de F83: temporadas, libro mayor de XP, progreso, retos y reclamos. Las recompensas YA entregadas
-- (créditos/sobres/insignias vía award) NO se deshacen aquí (están en sus libros: credit_transactions, user_packs,
-- user_cosmetics). Antes: backup (pre-0064) y exportar estas tablas si se quieren conservar.
-- ============================================================================================================
begin;
drop function if exists public.app_season_claim(uuid, text, int);
drop function if exists public.app_season_apply(uuid, text, text, text, int, int, jsonb, jsonb);
drop table if exists public.season_reward_claims;
drop table if exists public.season_challenge_progress;
drop table if exists public.season_progress;
drop table if exists public.season_xp_ledger;
drop table if exists public.season_events;
drop trigger if exists trg_game_seasons_guard on public.game_seasons;
drop trigger if exists trg_game_seasons_insert_guard on public.game_seasons;
drop table if exists public.game_seasons;
drop function if exists public._game_seasons_guard();
drop function if exists public._game_seasons_insert_guard();
commit;
