-- ============================================================================================================
-- 0063 · F89 PROFILE 2.0 — EQUIPO FAVORITO DEL PERFIL
--
-- Qué añade (todo aditivo; nada existente cambia de forma):
--   1. player_profile_customization.favorite_team_id   id CANÓNICO de un equipo esports real (identidad de equipo del
--                                                        catálogo, p. ej. `team-heretics`). La lista válida vive en el
--                                                        código (identidades de equipo impresas en cartas) y la valida
--                                                        el servidor ANTES del RPC; aquí solo se exige la forma.
--   2. player_profile_set_favorite_team(user, team, expected_version)
--                                                        mismo contrato que `player_profile_set` (0049) y
--                                                        `player_profile_set_badges` (0062): misma fila, misma versión
--                                                        optimista; mismo contenido = UNCHANGED antes de mirar la versión.
-- Nada de logos ni URLs en BD: el logo lo resuelve el servidor desde el id (nunca un texto del usuario).
--
-- Seguridad: la tabla ya tiene RLS sin políticas (solo service_role, 0049). La función es SECURITY DEFINER con
-- search_path fijo y EXECUTE solo para service_role.
-- Rollback: docs/operations/rollback/0063_profile_favorite_team.ROLLBACK.sql
-- ============================================================================================================

alter table public.player_profile_customization
  add column if not exists favorite_team_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ppc_favorite_team_shape') then
    alter table public.player_profile_customization
      add constraint ppc_favorite_team_shape check (favorite_team_id is null or favorite_team_id ~ '^[a-z0-9-]{1,48}$');
  end if;
end $$;

comment on column public.player_profile_customization.favorite_team_id is
  'F89 · id canónico del equipo favorito (identidad de equipo del catálogo). Validado por el servidor; null = ninguno.';

create or replace function public.player_profile_set_favorite_team(p_user uuid, p_team text, p_expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cur public.player_profile_customization%rowtype;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('code', 'BAD_USER');
  end if;
  if p_team is not null and p_team !~ '^[a-z0-9-]{1,48}$' then
    return jsonb_build_object('code', 'BAD_TEAM');
  end if;

  insert into public.player_profile_customization (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into cur from public.player_profile_customization where user_id = p_user for update;

  if p_team is not distinct from cur.favorite_team_id then
    return jsonb_build_object('code', 'UNCHANGED', 'version', cur.version);
  end if;
  if p_expected_version is not null and p_expected_version <> cur.version then
    return jsonb_build_object('code', 'CONFLICT', 'version', cur.version);
  end if;

  update public.player_profile_customization
     set favorite_team_id = p_team, version = cur.version + 1, updated_at = now()
   where user_id = p_user;
  return jsonb_build_object('code', 'SAVED', 'version', cur.version + 1);
end $$;

revoke all on function public.player_profile_set_favorite_team(uuid, text, int) from public, anon, authenticated;
grant execute on function public.player_profile_set_favorite_team(uuid, text, int) to service_role;
