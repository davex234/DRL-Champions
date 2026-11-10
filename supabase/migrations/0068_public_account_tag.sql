-- ============================================================================================================
-- 0068 · TAG PÚBLICO DE CUENTA — un identificador PÚBLICO, único y PERMANENTE por cuenta («#7K4M92X»). Aditiva.
--
-- NO sustituye a nada: el id interno (`auth.users.id` = `profiles.id`, UUID) sigue siendo la clave técnica de TODAS las
-- relaciones y el nombre (`profiles.username`) sigue siendo editable. El tag es una TERCERA identidad, pública:
--
--   1. account_tag_registry  el REGISTRO HISTÓRICO de tags (tag → user_id). SIN clave foránea a auth.users: borrar una
--                            cuenta (auth.users → profiles ON DELETE CASCADE) borra su perfil pero NO su fila aquí, así que
--                            su tag jamás vuelve a repartirse. Append-only para CUALQUIER rol (un disparador rechaza UPDATE y
--                            DELETE). Solo lo escribe `_account_tag_claim`. Clientes: sin ningún privilegio.
--   2. profiles.public_tag   el tag de la cuenta, canónico (7 símbolos de `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, sin «#»):
--                            CHECK de formato, UNIQUE y NOT NULL tras el backfill. INMUTABLE para cualquier rol (también
--                            service_role/postgres): solo puede pasar de NULL a su tag del registro, y solo con la bandera
--                            `drl.account_tag_writer` (el backfill de esta migración).
--   3. Generación EN LA BD   `_account_tag_random`: pgcrypto `gen_random_bytes`, muestreo por rechazo (byte < 248 = 31·8:
--                            sin sesgo de módulo). `_account_tag_claim`: si la cuenta ya tiene tag en el registro, ESE (un
--                            reintento o un perfil recreado nunca cambian de tag); si no, inserta uno nuevo y ante colisión
--                            (clave única del registro) reintenta, como mucho 10 veces → ACCOUNT_TAG_EXHAUSTED (sin bucles).
--   4. Cuentas NUEVAS        disparador BEFORE INSERT en profiles: el tag lo pone la BD SIEMPRE (un valor enviado por el
--                            cliente o por `handle_new_user` se sustituye). Sin depender del navegador.
--   5. Cuentas EXISTENTES    backfill idempotente (solo `public_tag is null`), con `profiles_touch` suspendido dentro de la
--                            transacción para no mover `updated_at`: no cambia NINGUNA otra columna de nadie.
--   6. Auditoría admin       `app_admin_set_admin` (0067) añade `target_tag` (instantánea humana) a su detalle; el id
--                            interno sigue siendo `entity_id`. Mismas reglas, misma firma, mismas concesiones.
--
-- Rollback: docs/operations/rollback/0068_public_account_tag.ROLLBACK.sql (conserva el REGISTRO: un reaplicado devuelve a
-- cada cuenta el MISMO tag y ninguno se reutiliza).
-- ============================================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ── 1. registro histórico ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.account_tag_registry (
  tag         text primary key,
  user_id     uuid not null,
  assigned_at timestamptz not null default now(),
  constraint account_tag_registry_user_uniq unique (user_id),
  constraint account_tag_registry_format check (tag ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$')
);
comment on table public.account_tag_registry is '0068 · tags públicos repartidos (append-only, sin FK: un tag nunca se reutiliza aunque la cuenta se borre).';
alter table public.account_tag_registry enable row level security;
revoke all on public.account_tag_registry from public, anon, authenticated;
grant select on public.account_tag_registry to service_role;

create or replace function public._account_tag_registry_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'ACCOUNT_TAG_REGISTRY_APPEND_ONLY: un tag repartido no se modifica ni se borra' using errcode = '42501';
end $$;
drop trigger if exists account_tag_registry_append_only on public.account_tag_registry;
create trigger account_tag_registry_append_only before update or delete on public.account_tag_registry
  for each row execute function public._account_tag_registry_append_only();

-- ── 2. generación ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._account_tag_random()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text := '';
  b bytea;
  i int;
  v int;
begin
  while char_length(out) < 7 loop
    b := extensions.gen_random_bytes(16);
    for i in 0 .. 15 loop
      v := get_byte(b, i);
      if v < 248 and char_length(out) < 7 then out := out || substr(alphabet, (v % 31) + 1, 1); end if;
    end loop;
  end loop;
  return out;
end $$;

create or replace function public._account_tag_claim(p_user uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v text;
  attempt int := 0;
begin
  if p_user is null then raise exception 'BAD_ID' using errcode = 'P0001'; end if;
  select r.tag into v from public.account_tag_registry r where r.user_id = p_user;
  if found then return v; end if;
  loop
    attempt := attempt + 1;
    if attempt > 10 then raise exception 'ACCOUNT_TAG_EXHAUSTED' using errcode = 'P0001'; end if;
    v := public._account_tag_random();
    begin
      insert into public.account_tag_registry (tag, user_id) values (v, p_user);
      return v;
    exception when unique_violation then
      -- ¿Chocó el USUARIO (otra transacción le acaba de dar tag)? Entonces ese. Si chocó el TAG, otro intento.
      select r.tag into v from public.account_tag_registry r where r.user_id = p_user;
      if found then return v; end if;
    end;
  end loop;
end $$;

-- ── 3. columna del perfil ─────────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists public_tag text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_public_tag_format') then
    alter table public.profiles add constraint profiles_public_tag_format check (public_tag is null or public_tag ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_public_tag_key') then
    alter table public.profiles add constraint profiles_public_tag_key unique (public_tag);
  end if;
end $$;

-- Cuentas NUEVAS: el tag lo pone la BD (cualquier valor que llegue en el INSERT se sustituye).
create or replace function public._profiles_account_tag_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.public_tag := public._account_tag_claim(new.id);
  return new;
end $$;
drop trigger if exists profiles_account_tag_insert on public.profiles;
create trigger profiles_account_tag_insert before insert on public.profiles
  for each row execute function public._profiles_account_tag_insert();

-- INMUTABLE: solo NULL → su tag del registro, y solo con la bandera del backfill. Para CUALQUIER rol.
create or replace function public._profiles_account_tag_immutable()
returns trigger language plpgsql as $$
begin
  if new.public_tag is not distinct from old.public_tag then return new; end if;
  if old.public_tag is null
     and coalesce(current_setting('drl.account_tag_writer', true), '') = 'on'
     and new.public_tag = (select r.tag from public.account_tag_registry r where r.user_id = new.id) then
    return new;
  end if;
  raise exception 'ACCOUNT_TAG_IMMUTABLE: el tag público de una cuenta no cambia' using errcode = '42501';
end $$;
drop trigger if exists profiles_account_tag_immutable on public.profiles;
create trigger profiles_account_tag_immutable before update on public.profiles
  for each row execute function public._profiles_account_tag_immutable();

-- ── 4. backfill de las cuentas existentes (idempotente; no mueve updated_at ni ninguna otra columna) ──────
alter table public.profiles disable trigger profiles_touch;
select set_config('drl.account_tag_writer', 'on', true);
update public.profiles p set public_tag = public._account_tag_claim(p.id) where p.public_tag is null;
select set_config('drl.account_tag_writer', '', true);
alter table public.profiles enable trigger profiles_touch;
alter table public.profiles alter column public_tag set not null;

-- ── 5. auditoría de admins con el tag como instantánea humana (0067, misma firma y reglas) ─────────────────
create or replace function public.app_admin_set_admin(p_actor uuid, p_target uuid, p_grant boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_tag text; v_is boolean; v_admins int;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform pg_advisory_xact_lock(hashtext('drl:admin_roster'));

  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_target is null or p_grant is null then raise exception 'BAD_ID' using errcode = 'P0001'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'BAD_REASON' using errcode = 'P0001'; end if;

  select username, public_tag, is_admin into v_name, v_tag, v_is from public.profiles where id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0001'; end if;

  if p_grant then
    if v_is then
      return jsonb_build_object('code', 'ALREADY_ADMIN', 'username', v_name, 'tag', v_tag, 'admins', (select count(*) from public.profiles where is_admin));
    end if;
    if exists (select 1 from public.user_sanctions s where s.user_id = p_target and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())) then
      raise exception 'TARGET_SANCTIONED' using errcode = 'P0001';
    end if;
  else
    if not v_is then
      return jsonb_build_object('code', 'ALREADY_NOT_ADMIN', 'username', v_name, 'tag', v_tag, 'admins', (select count(*) from public.profiles where is_admin));
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
          jsonb_build_object('target_username', v_name, 'target_tag', v_tag, 'reason', v_reason, 'admins_after', v_admins, 'self', p_actor = p_target));

  return jsonb_build_object('code', case when p_grant then 'GRANTED' else 'REVOKED' end, 'username', v_name, 'tag', v_tag, 'admins', v_admins);
end $$;

-- ── 6. concesiones ────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.app_admin_set_admin(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.app_admin_set_admin(uuid, uuid, boolean, text) to service_role;
do $mig$
declare f text;
begin
  foreach f in array array['_account_tag_random()', '_account_tag_claim(uuid)', '_profiles_account_tag_insert()', '_profiles_account_tag_immutable()', '_account_tag_registry_append_only()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $mig$;

-- ── 7. guardia final ──────────────────────────────────────────────────────────────────────────────────────
do $$
declare n_null int; n_dup int; n_bad int; n_unreg int;
begin
  select count(*) into n_null from public.profiles where public_tag is null;
  select count(*) - count(distinct public_tag) into n_dup from public.profiles;
  select count(*) into n_bad from public.profiles where public_tag !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$';
  select count(*) into n_unreg from public.profiles p where not exists (select 1 from public.account_tag_registry r where r.user_id = p.id and r.tag = p.public_tag);
  if n_null + n_dup + n_bad + n_unreg > 0 then
    raise exception '0068: tags inválidos (nulos %, duplicados %, formato %, fuera del registro %)', n_null, n_dup, n_bad, n_unreg;
  end if;
  -- (Los privilegios de columna de `profiles` se comprueban en producción al aplicar: una copia restaurada trae otras
  -- concesiones. Aunque un cliente pudiera escribir la columna, el disparador de inmutabilidad lo rechaza igual.)
  if has_table_privilege('authenticated', 'public.account_tag_registry', 'select')
     or has_table_privilege('authenticated', 'public.account_tag_registry', 'insert')
     or has_table_privilege('anon', 'public.account_tag_registry', 'select') then
    raise exception '0068: privilegios de cliente inesperados sobre el registro de tags';
  end if;
end $$;
