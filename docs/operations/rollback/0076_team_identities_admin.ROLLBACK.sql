-- ============================================================================================================
-- ROLLBACK de 0076 · IDENTIDAD DE LOS EQUIPOS NUEVOS DESDE EL PANEL
--
-- Se puede ejecutar con el código nuevo o con el anterior desplegado:
--   · código nuevo sin 0076: los equipos del registro de código siguen igual; un equipo creado solo desde el panel
--     vuelve a quedarse sin región y deja de enseñarse al jugador (degradación probada). Sus compleciones y XP de 0075
--     NO se tocan: siguen guardadas con su clave.
--   · código anterior: no usa nada de esto.
--
-- NO PIERDE DATOS: antes de borrar, copia la tabla a `ops_rollback_0076_content_team_identities` (solo service_role).
-- Si esa copia ya existe de un rollback anterior, se detiene sin tocar nada.
-- La auditoría (`content_audit_log`) es append-only y se conserva.
-- Volver a aplicar 0076 después: restaurar antes las filas desde la copia (insert … select) para que cada equipo
-- recupere SU clave (`team_id`); con otra clave, una primera compleción ya cobrada se podría volver a cobrar.
-- ============================================================================================================
begin;
do $$ begin
  if to_regclass('public.ops_rollback_0076_content_team_identities') is not null then
    raise exception 'ya existe un archivo ops_rollback_0076_*: revísalo antes de repetir el rollback';
  end if;
end $$;
drop function if exists public.app_team_identity_save(uuid, text, text, text, text, text, int);
do $$ begin
  if to_regclass('public.content_team_identities') is not null then
    create table public.ops_rollback_0076_content_team_identities as select *, now() as archived_at from public.content_team_identities;
    alter table public.ops_rollback_0076_content_team_identities enable row level security;
    revoke all on public.ops_rollback_0076_content_team_identities from public, anon, authenticated;
  end if;
end $$;
drop table if exists public.content_team_identities;
commit;
