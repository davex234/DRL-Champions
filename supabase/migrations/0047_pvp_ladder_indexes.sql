-- 0047 · ÍNDICES DE LA ESCALERA PvP Y DEL HISTORIAL (Fase 28) — APLICADA (VPS 2026-09-15, Fase 35.1).
--
-- Estado: fichero LOCAL, aditivo e idempotente. Aplicada en la BD del VPS el 2026-09-15 11:57Z (Fase 35.1) y NADA depende
-- de que exista: las consultas de `services/competitive.ts` son correctas sin él, solo más lentas
-- con población grande. No toca `schema_migrations`.
--
-- 1. ORDEN DE LA ESCALERA. La clasificación se lee como
--      order by rating desc, updated_at asc, user_id asc   where games_played >= 1
--    (empates deterministas: quien alcanzó el rating ANTES va delante). El índice existente
--    `duel_pvp_ratings_rating_idx (rating desc)` cubre la primera clave; este cubre las tres y el
--    filtro, para que `range()` y los tres recuentos de posición no ordenen en memoria.
create index if not exists duel_pvp_ratings_ladder_idx
  on public.duel_pvp_ratings (rating desc, updated_at asc, user_id asc)
  where games_played >= 1;

-- 2. HISTORIAL POR JUGADOR. «Mis partidas PvP, de la más reciente a la más antigua» se lee por los
--    dos bandos (`user_id` = A, `player_b_id` = B) con cursor por `updated_at`. Hoy solo hay
--    (user_id, status) y (player_b_id, status) parciales, sin fecha.
create index if not exists duel_matches_pvp_a_recent_idx
  on public.duel_matches (user_id, updated_at desc) where mode = 'PVP';
create index if not exists duel_matches_pvp_b_recent_idx
  on public.duel_matches (player_b_id, updated_at desc) where mode = 'PVP';
