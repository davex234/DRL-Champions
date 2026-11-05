-- F70 · Inventario de cuentas QA desechables. SOLO LECTURA: ningún INSERT/UPDATE/DELETE.
-- Criterio de cuenta QA: email en el dominio reservado `@example.invalid` (RFC 2606, no puede
-- recibir correo real). El nombre de usuario (`QA-xxxx`, `qa…`) es solo informativo: el guard
-- de verdad es el dominio del email y que la cuenta NO sea admin.
-- Uso: psql … -v ON_ERROR_STOP=1 -f scripts/ops/qa-accounts.sql   (ver docs/operations/drlcards-qa-accounts.md)

begin read only;

-- 1) Cuentas QA con su perfil y señales de actividad.
select u.id,
       u.email,
       p.username,
       coalesce(p.is_admin, false)             as is_admin,
       u.created_at,
       u.last_sign_in_at,
       u.banned_until,
       (select count(*) from public.user_cards c where c.user_id = u.id) as cartas
  from auth.users u
  left join public.profiles p on p.id = u.id
 where lower(u.email) like '%@example.invalid'
 order by u.created_at;

-- 2) Totales y comprobación de seguridad: debe devolver qa_admins = 0.
select count(*)                                                  as qa_total,
       count(*) filter (where coalesce(p.is_admin, false))       as qa_admins,
       count(*) filter (where u.last_sign_in_at > now() - interval '7 days') as qa_activas_7d
  from auth.users u
  left join public.profiles p on p.id = u.id
 where lower(u.email) like '%@example.invalid';

-- 3) Cuentas NO QA (para comparar; nunca se tocan).
select count(*) as no_qa_total
  from auth.users u
 where u.email is null or lower(u.email) not like '%@example.invalid';

rollback;
