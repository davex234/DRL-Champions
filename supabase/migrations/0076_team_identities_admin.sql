-- ============================================================================================================
-- 0076 · IDENTIDAD DE LOS EQUIPOS NUEVOS DESDE EL PANEL (nombre, etiqueta y región) — colecciones por equipo.
--
-- Contexto: la identidad de los 41 equipos del catálogo diseñado vive en código (`src/data/teamIdentities.ts`,
-- verificada y versionada; decide sobres de equipo, maestría y logros). Pero el CMS (0057) deja publicar una carta con
-- un equipo impreso que ese registro no conoce. Hasta ahora esa colección aparecía sin región —no contaba para
-- ninguna insignia— y arreglarlo exigía tocar código y desplegar.
--
-- Esta tabla da a ESOS equipos (solo a los que el registro de código no resuelve) la identidad mínima que necesitan
-- las colecciones: una clave estable, un nombre, una etiqueta y una región. Hasta que un admin la rellena, el equipo
-- NO se enseña al jugador ni liquida XP ni insignias (queda bloqueado de forma segura y listado en /admin/teams).
--
--   `printed_team`  el texto impreso exacto (recortado) de las cartas: es lo que se resuelve.
--   `team_id`       la clave de la colección (la de `user_team_completions` de 0075). INMUTABLE una vez creada: si
--                   cambiara, la primera compleción quedaría con otra clave y el jugador podría cobrar dos veces.
--
-- Solo se escribe con `app_team_identity_save`: comprueba que el actor es admin, revisión optimista (dos admins no se
-- pisan), clave inmutable y auditoría en `content_audit_log` (0055) en la MISMA transacción.
--
-- No cambia ninguna tabla, fila, política ni función existente. No toca créditos, sobres, cartas ni inventario. No
-- inserta nada al aplicarse. Los logos no van aquí: son assets `team_logo` del CMS (0057) con `subject_id = team_id`.
--
-- Seguridad: RLS activada SIN políticas (solo service_role); la función es SECURITY DEFINER con search_path fijo y
-- EXECUTE solo para service_role.
-- Rollback: docs/operations/rollback/0076_team_identities_admin.ROLLBACK.sql
-- ============================================================================================================

create table if not exists public.content_team_identities (
  printed_team text primary key
    check (char_length(printed_team) between 1 and 48 and printed_team = btrim(printed_team) and printed_team !~ '[[:cntrl:]]' and printed_team <> '?'),
  team_id      text not null unique
    check (team_id ~ '^[a-z0-9][a-z0-9-]{1,31}$' and team_id !~ '^team-.+-v[0-9]+$' and team_id !~ '^raw'),
  name         text not null check (char_length(btrim(name)) between 2 and 48 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  tag          text not null check (tag ~ '^[A-Za-z0-9.]{1,6}$'),
  region       text not null check (region in ('Americas', 'EMEA', 'Pacific', 'China')),
  rev          int  not null default 1 check (rev >= 1),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

alter table public.content_team_identities enable row level security;
revoke all on public.content_team_identities from public, anon, authenticated;
grant select on public.content_team_identities to service_role;
comment on table public.content_team_identities is
  '0076 · identidad (clave, nombre, etiqueta, región) de equipos impresos que el registro de código no conoce. Solo servidor; se escribe con app_team_identity_save.';

--   Crea o actualiza la identidad de un equipo impreso. Devuelve { code: OK | NOT_ADMIN | CONFLICT | TEAM_ID_LOCKED |
--   TEAM_ID_TAKEN | INVALID, rev?, teamId? }. Nunca borra.
create or replace function public.app_team_identity_save(
  p_actor uuid, p_printed text, p_team_id text, p_name text, p_tag text, p_region text, p_expected_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cur     public.content_team_identities%rowtype;
  existed boolean;
  v_rev   int;
  v_after jsonb;
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    return jsonb_build_object('code', 'NOT_ADMIN');
  end if;
  if p_printed is null or p_team_id is null then return jsonb_build_object('code', 'INVALID'); end if;

  -- Un guardado a la vez por equipo impreso.
  perform pg_advisory_xact_lock(hashtextextended('team-identity:' || p_printed, 0));
  select * into cur from public.content_team_identities where printed_team = p_printed for update;
  existed := found;

  if existed then
    if p_expected_rev is distinct from cur.rev then return jsonb_build_object('code', 'CONFLICT', 'rev', cur.rev); end if;
    if p_team_id <> cur.team_id then return jsonb_build_object('code', 'TEAM_ID_LOCKED', 'teamId', cur.team_id); end if;
    update public.content_team_identities
       set name = p_name, tag = p_tag, region = p_region, rev = rev + 1, updated_at = now(), updated_by = p_actor
     where printed_team = p_printed
    returning rev into v_rev;
  else
    if coalesce(p_expected_rev, 0) <> 0 then return jsonb_build_object('code', 'CONFLICT', 'rev', 0); end if;
    if exists (select 1 from public.content_team_identities where team_id = p_team_id) then return jsonb_build_object('code', 'TEAM_ID_TAKEN'); end if;
    insert into public.content_team_identities (printed_team, team_id, name, tag, region, created_by, updated_by)
    values (p_printed, p_team_id, p_name, p_tag, p_region, p_actor, p_actor);
    v_rev := 1;
  end if;

  select to_jsonb(t) into v_after from public.content_team_identities t where printed_team = p_printed;
  perform public.app_admin_audit(p_actor, case when existed then 'team_identity_update' else 'team_identity_create' end,
                                 'team_identity', p_team_id,
                                 jsonb_build_object('before', case when existed then to_jsonb(cur) else null end, 'after', v_after));
  return jsonb_build_object('code', 'OK', 'rev', v_rev, 'teamId', p_team_id);
exception
  when check_violation or not_null_violation then return jsonb_build_object('code', 'INVALID');
  when unique_violation then return jsonb_build_object('code', 'TEAM_ID_TAKEN');
end $$;

revoke all on function public.app_team_identity_save(uuid, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.app_team_identity_save(uuid, text, text, text, text, text, int) to service_role;
comment on function public.app_team_identity_save(uuid, text, text, text, text, text, int) is
  '0076 · guarda la identidad de un equipo impreso nuevo (admin, revisión optimista, clave inmutable, auditada). Solo servidor.';
