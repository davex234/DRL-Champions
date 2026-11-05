-- F70 · Purga de cuentas QA desechables. TERMINA EN ROLLBACK POR DEFECTO.
--
-- NO cambiar el ROLLBACK final por COMMIT sin autorización humana explícita y por escrito,
-- y solo DESPUÉS de los gates finales (F68/F69/F70 usan cuentas QA; ver
-- docs/operations/drlcards-qa-accounts.md). Hacer antes una copia de seguridad.
--
-- Efecto: borrar de auth.users arrastra en cascada perfil, cartas, libro mayor, seriales e
-- historial de esas cuentas. Si se quiere conservar el historial, usar la OPCIÓN B (bloqueo)
-- en vez de la A (borrado).
--
-- Guards:
--   * solo emails `@example.invalid`;
--   * nunca una cuenta con profiles.is_admin = true;
--   * lista opcional de ids a conservar (qa_keep) — p. ej. las cuentas de los gates si aún se
--     necesitan;
--   * aborta si el conjunto contiene algo que no sea QA o si no coincide con lo esperado.

begin;

create temp table qa_keep (id uuid primary key) on commit drop;
-- insert into qa_keep values ('00000000-0000-0000-0000-000000000000');  -- cuentas a conservar

create temp table qa_target on commit drop as
select u.id, u.email
  from auth.users u
  left join public.profiles p on p.id = u.id
 where lower(u.email) like '%@example.invalid'
   and coalesce(p.is_admin, false) = false
   and u.id not in (select id from qa_keep);

-- Guard explícito: ninguna cuenta objetivo puede ser admin ni tener un email fuera del dominio QA.
do $$
declare bad int;
begin
  select count(*) into bad
    from qa_target t
    left join public.profiles p on p.id = t.id
   where lower(t.email) not like '%@example.invalid' or coalesce(p.is_admin, false);
  if bad > 0 then
    raise exception 'GUARD: % cuentas no-QA o admin en el objetivo; abortado', bad;
  end if;
end $$;

select count(*) as a_purgar from qa_target;
select id, email from qa_target order by email;

-- OPCIÓN A · borrado (cascada). Descomentar solo una de las dos opciones.
-- delete from auth.users where id in (select id from qa_target);

-- OPCIÓN B · bloqueo sin perder historial: sesión imposible y contraseña inservible.
-- update auth.users
--    set banned_until = 'infinity',
--        encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
--  where id in (select id from qa_target);
-- delete from auth.sessions where user_id in (select id from qa_target);
-- delete from auth.refresh_tokens where user_id in (select id::text from qa_target);

-- Por defecto NO se aplica nada. Cambiar a COMMIT solo con autorización humana explícita.
rollback;
