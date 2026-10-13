-- ============================================================================================================
-- ROLLBACK OPERATIVO de 0069 (F86 · torneos de jugadores). Ejecutar DESPUÉS de desplegar el código anterior (sin /copas).
--
-- Quita las tablas `cups`, `cup_registrations`, `cup_matches`, sus disparadores y sus RPC, y el índice de dueño único de
-- los trofeos de torneo. NO toca `duel_matches`: las partidas de torneo ya jugadas siguen ahí como lo que técnicamente son
-- (duelos PVP_PRIVATE, sin rating), y NO borra trofeos ya concedidos (`insignia:torneo:*` en `user_cosmetics`): un trofeo
-- ganado no se le quita a nadie por un rollback de código. Si un torneo de PRUEBA dejó un trofeo en una cuenta QA, se
-- retira a mano, a sabiendas:  delete from public.user_cosmetics where cosmetic_id = 'insignia:torneo:<slug-qa>';
--
-- ATENCIÓN: borrar las tablas borra la historia de los torneos (inscripciones, cuadros, campeones). Antes de ejecutar,
-- exporta lo que haya:  \copy (select * from public.cups) to 'cups.csv' csv header  (y lo mismo con las otras dos).
-- Ninguna otra tabla, columna ni dato cambia.
-- ============================================================================================================
begin;
drop index if exists public.user_cosmetics_cup_trophy_once;

drop function if exists public.cup_admin_resolve(uuid, uuid, text, text, text);
drop function if exists public.cup_admin_cancel(uuid, uuid, text, text);
drop function if exists public.cup_admin_publish(uuid, uuid, int);
drop function if exists public.cup_settle_game(uuid);
drop function if exists public.cup_start_failed(uuid, uuid, uuid);
drop function if exists public.cup_mark_active(uuid, uuid);
drop function if exists public.cup_ready(uuid, uuid, uuid, int);
drop function if exists public.cup_generate(uuid, uuid);
drop function if exists public.cup_withdraw(uuid, uuid);
drop function if exists public.cup_register(uuid, uuid);

drop trigger if exists cup_matches_guard on public.cup_matches;
drop trigger if exists cup_registrations_guard on public.cup_registrations;
drop trigger if exists cups_guard on public.cups;
drop table if exists public.cup_matches;
drop table if exists public.cup_registrations;
drop table if exists public.cups;

drop function if exists public._cup_assert_admin(uuid);
drop function if exists public._cup_auto(uuid);
drop function if exists public._cup_finish(uuid, uuid, text, text, uuid, text);
drop function if exists public._cup_complete(uuid, uuid);
drop function if exists public._cup_tag(uuid);
drop function if exists public._cup_audit(uuid, text, uuid, jsonb);
drop function if exists public._cup_placement(int, int);
drop function if exists public._cup_seed_positions(int);
drop function if exists public._cup_rows_guard();
drop function if exists public._cups_guard();
commit;
