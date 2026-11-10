-- ============================================================================================================
-- ROLLBACK OPERATIVO de 0068 (tag público de cuenta). Ejecutar DESPUÉS de desplegar el código anterior (sin tag).
-- Quita la columna `profiles.public_tag`, sus disparadores y la generación, y devuelve `app_admin_set_admin` EXACTA a 0067.
-- CONSERVA `account_tag_registry` (y su disparador append-only): reaplicar 0068 devuelve a cada cuenta EL MISMO tag y
-- ningún tag repartido vuelve a darse a otra cuenta. Ninguna otra columna ni dato cambia.
-- ============================================================================================================
begin;
drop trigger if exists profiles_account_tag_insert on public.profiles;
drop trigger if exists profiles_account_tag_immutable on public.profiles;
alter table public.profiles drop constraint if exists profiles_public_tag_key;
alter table public.profiles drop constraint if exists profiles_public_tag_format;
alter table public.profiles drop column if exists public_tag;
drop function if exists public._profiles_account_tag_insert();
drop function if exists public._profiles_account_tag_immutable();

-- app_admin_set_admin COPIADA LITERALMENTE de 0067 (sin `target_tag`): el ensayo comprueba que queda byte a byte igual.
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
commit;
