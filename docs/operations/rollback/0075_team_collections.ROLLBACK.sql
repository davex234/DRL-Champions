-- ============================================================================================================
-- ROLLBACK de 0075 · COLECCIONES POR EQUIPO (primeras compleciones, XP de temporada e insignias regionales)
--
-- Se puede ejecutar con el código nuevo o con el anterior desplegado:
--   · código nuevo sin 0075: las colecciones y el progreso siguen funcionando (son derivados); las insignias
--     regionales vuelven a depender del inventario del momento y no se conceden XP (degradación probada).
--   · código anterior (drl-0.1.1-1-4b1f4c01): no usa nada de esto.
--
-- NO PIERDE DATOS: antes de borrar, copia las dos tablas a `ops_rollback_0075_*` (solo service_role). Si esas copias
-- ya existen de un rollback anterior, se detiene sin tocar nada (no se pisa un archivo).
-- NO se tocan a propósito:
--   · los XP de temporada ya concedidos (`season_events`, `season_xp_ledger`, `season_progress`): son del jugador;
--   · las insignias `insignia:regional:*` de `user_cosmetics` ni las destacadas en el perfil: también son suyas, y el
--     código anterior las pinta como una insignia genérica con el nombre de la región.
-- Volver a aplicar 0075 después: restaurar antes las filas desde `ops_rollback_0075_*` (insert … select) para que nadie
-- vuelva a cobrar XP por un equipo ya liquidado; el libro de XP lo impediría en la misma temporada, no en otra.
-- ============================================================================================================
begin;
do $$ begin
  if to_regclass('public.ops_rollback_0075_user_team_completions') is not null or to_regclass('public.ops_rollback_0075_user_region_badges') is not null then
    raise exception 'ya existe un archivo ops_rollback_0075_*: revísalo antes de repetir el rollback';
  end if;
end $$;
drop function if exists public.app_team_collections_settle(uuid, jsonb, jsonb, text, int);
do $$ begin
  if to_regclass('public.user_team_completions') is not null then
    create table public.ops_rollback_0075_user_team_completions as select *, now() as archived_at from public.user_team_completions;
    alter table public.ops_rollback_0075_user_team_completions enable row level security;
    revoke all on public.ops_rollback_0075_user_team_completions from public, anon, authenticated;
  end if;
  if to_regclass('public.user_region_badges') is not null then
    create table public.ops_rollback_0075_user_region_badges as select *, now() as archived_at from public.user_region_badges;
    alter table public.ops_rollback_0075_user_region_badges enable row level security;
    revoke all on public.ops_rollback_0075_user_region_badges from public, anon, authenticated;
  end if;
end $$;
drop table if exists public.user_team_completions;
drop table if exists public.user_region_badges;
commit;
