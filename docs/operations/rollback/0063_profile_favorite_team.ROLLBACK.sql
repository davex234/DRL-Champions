-- ============================================================================================================
-- ROLLBACK OPERATIVO de 0063 (F89 · equipo favorito del perfil). Ejecutar SOLO tras desplegar antes el código anterior
-- a F89 (drl-0.1.1-1-d3973448): la app de F89 lee la columna con degradación (sin ella, el perfil no enseña equipo
-- favorito y guardarlo responde 503 NOT_READY), y la app anterior no la usa en absoluto.
--
-- PIERDE DATOS de F89: el equipo favorito elegido por cada jugador. Nada más (vitrina, logros, insignias y versión de la
-- fila de personalización quedan intactos). Antes: backup (pre-0063) y exportar la columna si se quiere conservar.
-- ============================================================================================================
begin;
drop function if exists public.player_profile_set_favorite_team(uuid, text, int);
alter table public.player_profile_customization
  drop constraint if exists ppc_favorite_team_shape,
  drop column if exists favorite_team_id;
commit;
