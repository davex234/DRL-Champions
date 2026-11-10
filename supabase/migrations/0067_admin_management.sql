-- ============================================================================================================
-- 0067 · GESTIÓN DE ADMINISTRADORES — conceder y revocar `profiles.is_admin` desde /admin, con enforcement en la BD.
--
-- NO es un sistema de roles nuevo: el administrador sigue siendo `profiles.is_admin` (0006), lo comprueba `verifyAdmin`
-- en cada petición y las RPC `app_admin_*` con `p_actor`. Lo que cambia:
--
--   1. GUARDIA DE ESCRITURA. Hasta ahora `profiles_guard` (0009/0027) solo impedía tocar `is_admin` a `anon` y
--      `authenticated`; service_role o una consola podían cambiarlo sin rastro. Ahora CUALQUIER cambio de `is_admin`
--      (UPDATE o INSERT con true), sea cual sea el rol, choca salvo que la transacción lleve `drl.admin_writer = on`,
--      que solo pone `app_admin_set_admin` (o un operador a mano, a sabiendas, y auditándolo). Patrón de `drl.rating_writer` (0065).
--   2. SUELO. Nunca puede quedar 0 administradores: si un UPDATE o un DELETE deja la tabla sin admins, la transacción
--      entera se deshace (LAST_ADMIN). Vale para la RPC, para un operador y para el borrado de una cuenta.
--   3. app_admin_set_admin(p_actor, p_target, p_grant, p_reason) — SECURITY DEFINER, EXECUTE solo service_role:
--      cerrojo global del registro de admins (concurrencia: doble clic, dos pestañas, dos admins a la vez), el ACTOR
--      tiene que ser admin AHORA (se relee en la BD, nunca se cree al cliente), usuario inexistente = USER_NOT_FOUND,
--      repetir = idempotente (ALREADY_*, sin escribir ni auditar), no se nombra admin a una cuenta con sanción vigente,
--      revocar al último = LAST_ADMIN, y la AUDITORÍA (GRANT_ADMIN / REVOKE_ADMIN, actor, afectado, hora) va en la
--      MISMA transacción (content_audit_log es append-only desde 0055).
--
-- Nada toca economía, ranked, social, temporadas ni ninguna otra columna. Los admins actuales no cambian.
-- Rollback: docs/operations/rollback/0067_admin_management.ROLLBACK.sql
-- Operador (emergencia o QA), dentro de UNA transacción:
--   begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = … where id = …;
--   insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '<id>', '{"via":"operator"}'); commit;
-- ============================================================================================================

-- ── 1. guardia de escritura de is_admin ──────────────────────────────────────────────────────────────────
create or replace function public._profiles_admin_write_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('drl.admin_writer', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) then raise exception 'ADMIN_WRITE_FORBIDDEN: is_admin solo cambia con app_admin_set_admin' using errcode = '42501'; end if;
    return new;
  end if;
  if new.is_admin is distinct from old.is_admin then
    raise exception 'ADMIN_WRITE_FORBIDDEN: is_admin solo cambia con app_admin_set_admin' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists profiles_admin_write_guard on public.profiles;
create trigger profiles_admin_write_guard
  before insert or update of is_admin on public.profiles
  for each row execute function public._profiles_admin_write_guard();

-- ── 2. suelo: nunca 0 administradores ────────────────────────────────────────────────────────────────────
create or replace function public._profiles_admin_floor()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.profiles where is_admin) then
    raise exception 'LAST_ADMIN: no puede quedar ningún administrador' using errcode = 'P0001';
  end if;
  return null;
end $$;

drop trigger if exists profiles_admin_floor_upd on public.profiles;
create trigger profiles_admin_floor_upd
  after update of is_admin on public.profiles
  for each row when (old.is_admin and not new.is_admin)
  execute function public._profiles_admin_floor();

drop trigger if exists profiles_admin_floor_del on public.profiles;
create trigger profiles_admin_floor_del
  after delete on public.profiles
  for each row when (old.is_admin)
  execute function public._profiles_admin_floor();

-- ── 3. conceder / revocar ────────────────────────────────────────────────────────────────────────────────
create or replace function public.app_admin_set_admin(p_actor uuid, p_target uuid, p_grant boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_is boolean; v_admins int;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- Un solo cambio del registro de admins a la vez (doble clic, dos pestañas, dos admins): el recuento del suelo y la
  -- comprobación del actor se hacen con todo lo anterior ya confirmado.
  perform pg_advisory_xact_lock(hashtext('drl:admin_roster'));

  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_target is null or p_grant is null then raise exception 'BAD_ID' using errcode = 'P0001'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'BAD_REASON' using errcode = 'P0001'; end if;

  select username, is_admin into v_name, v_is from public.profiles where id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0001'; end if;

  if p_grant then
    if v_is then
      return jsonb_build_object('code', 'ALREADY_ADMIN', 'username', v_name, 'admins', (select count(*) from public.profiles where is_admin));
    end if;
    if exists (select 1 from public.user_sanctions s where s.user_id = p_target and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())) then
      raise exception 'TARGET_SANCTIONED' using errcode = 'P0001';
    end if;
  else
    if not v_is then
      return jsonb_build_object('code', 'ALREADY_NOT_ADMIN', 'username', v_name, 'admins', (select count(*) from public.profiles where is_admin));
    end if;
    if (select count(*) from public.profiles where is_admin) <= 1 then
      raise exception 'LAST_ADMIN' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('drl.admin_writer', 'on', true);
  update public.profiles set is_admin = p_grant where id = p_target;
  perform set_config('drl.admin_writer', '', true);

  select count(*) into v_admins from public.profiles where is_admin;
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, case when p_grant then 'GRANT_ADMIN' else 'REVOKE_ADMIN' end, 'user', p_target::text,
          jsonb_build_object('target_username', v_name, 'reason', v_reason, 'admins_after', v_admins, 'self', p_actor = p_target));

  return jsonb_build_object('code', case when p_grant then 'GRANTED' else 'REVOKED' end, 'username', v_name, 'admins', v_admins);
end $$;

revoke all on function public.app_admin_set_admin(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.app_admin_set_admin(uuid, uuid, boolean, text) to service_role;
revoke all on function public._profiles_admin_write_guard() from public, anon, authenticated;
revoke all on function public._profiles_admin_floor() from public, anon, authenticated;

-- ── 4. guardia final: los admins de antes siguen siendo los mismos y hay al menos uno ─────────────────────
do $$
begin
  if not exists (select 1 from public.profiles where is_admin) then raise exception '0067: no hay ningún administrador'; end if;
  if has_function_privilege('authenticated', 'public.app_admin_set_admin(uuid, uuid, boolean, text)', 'EXECUTE') then
    raise exception '0067: authenticated puede ejecutar app_admin_set_admin';
  end if;
end $$;
