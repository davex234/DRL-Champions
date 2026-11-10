-- =============================================================================================================
-- F87 · LIMPIEZA DE LAS CUENTAS QA DE LA FASE · instrumento de operador, fuera de CI y fuera de la release.
-- Conserva davex (#NB2Z9BM) y ValoRosters (#H5ND8K7) —validadas por uuid + #TAG + nombre— y borra SOLO las cuentas QA
-- de F87: correo @example.invalid, creadas a partir de :since. Mecanismo canónico (2026-10-05): borrar auth.users, de
-- la que cuelga todo por FK ON DELETE CASCADE; lo que no tiene FK queda como histórico (torneos con instantánea de
-- nombre/#TAG, auditoría append-only, registro de tags que nunca se reutilizan).
-- Una transacción; cualquier guarda que falle → RAISE → no se aplica NADA.
-- Uso:  psql -v ON_ERROR_STOP=1 -v since="'2026-10-06T08:00:00Z'" -v expected=N -v commit_or_rollback=COMMIT|ROLLBACK -f _f87-qa-cleanup.sql
-- =============================================================================================================
\set ON_ERROR_STOP on
begin;
select set_config('f87.expected', :'expected', true);
create temp table keep_set (id uuid primary key, tag text not null, username text not null) on commit drop;
insert into keep_set values
  ('3befce61-4c21-4c84-8397-40504fe6ec27', 'NB2Z9BM', 'davex_234_3bef'),
  ('b7ccff02-e845-4a5d-ac1c-4ab23689b0a9', 'H5ND8K7', 'ValoRosters_b7cc');
do $$ begin
  if (select count(*) from keep_set k join public.profiles p on p.id = k.id and p.public_tag = k.tag and p.username = k.username and p.is_admin join auth.users u on u.id = k.id) <> 2 then
    raise exception 'GUARD_KEEP: davex/ValoRosters no coinciden exactamente (uuid + tag + nombre + admin)';
  end if;
end $$;
create temp table keep_before on commit drop as
  select p.id, p.public_tag, p.username, p.is_admin, p.credits, p.xp, p.level from public.profiles p where p.id in (select id from keep_set);

create temp table delete_set on commit drop as
  select u.id from auth.users u
   where u.id not in (select id from keep_set) and u.email ilike '%@example.invalid' and u.created_at >= :since::timestamptz;
do $$ begin
  if exists (select 1 from delete_set d join keep_set k on k.id = d.id) then raise exception 'GUARD_KEEP_EN_DELETE'; end if;
  if exists (select 1 from public.profiles where is_admin and id in (select id from delete_set)) then raise exception 'GUARD_ADMIN_EN_DELETE: una QA sigue siendo admin'; end if;
  if exists (select 1 from auth.users where id not in (select id from keep_set) and id not in (select id from delete_set)) then
    raise exception 'GUARD_OTRAS: hay cuentas que no son ni reales ni QA de F87 (no se tocan; revisar a mano)';
  end if;
end $$;
select 'a borrar', count(*) from delete_set;
do $$ begin if (select count(*) from delete_set) <> current_setting('f87.expected')::int then raise exception 'GUARD_RECUENTO: % (esperado %)', (select count(*) from delete_set), current_setting('f87.expected'); end if; end $$;

delete from public.user_sanctions where user_id in (select id from delete_set);
delete from auth.users where id in (select id from delete_set);

do $$ begin
  if (select count(*) from auth.users) <> 2 then raise exception 'POST: auth.users <> 2'; end if;
  if (select count(*) from public.profiles) <> 2 then raise exception 'POST: profiles <> 2'; end if;
  if (select string_agg(left(id::text,8)||'#'||public_tag, ',' order by id) from public.profiles where is_admin) <> '3befce61#NB2Z9BM,b7ccff02#H5ND8K7' then raise exception 'POST: admins distintos'; end if;
  if exists (select 1 from keep_before b join public.profiles p on p.id = b.id where (p.public_tag, p.username, p.is_admin, p.credits, p.xp, p.level) is distinct from (b.public_tag, b.username, b.is_admin, b.credits, b.xp, b.level)) then
    raise exception 'POST: una cuenta real cambió';
  end if;
end $$;
select 'después', (select count(*) from auth.users), (select count(*) from public.profiles), (select count(*) from public.pickem_bracket_entries), (select count(*) from public.pickem_brackets);
:commit_or_rollback;
