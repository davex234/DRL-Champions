-- =============================================================================================================
-- 0076 · PRUEBAS CONTRA POSTGRES REAL (stack de QA). Todo dentro de UNA transacción que termina en ROLLBACK:
-- no deja filas, ni admins, ni auditoría. Cada comprobación que falla lanza una excepción (psql ON_ERROR_STOP).
--   docker exec -i vrqa_db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < team-collections-0076.sqltest.sql
-- Necesita 0076 aplicada y una cuenta sintética `coll-tcall@example.invalid` (y `coll-tcempty@…`).
-- =============================================================================================================
\set QUIET on
begin;
set local session_replication_role = replica;  -- solo para marcar admin a la cuenta sintética dentro de esta transacción
create temp table _ids on commit drop as
  select (select id from auth.users where email = 'coll-tcall@example.invalid') as admin_id,
         (select id from auth.users where email = 'coll-tcempty@example.invalid') as user_id;
update public.profiles set is_admin = true  where id = (select admin_id from _ids);
update public.profiles set is_admin = false where id = (select user_id from _ids);
set local session_replication_role = origin;

do $$
declare a uuid := (select admin_id from _ids); u uuid := (select user_id from _ids); r jsonb; n int; audit0 int;
begin
  if a is null or u is null then raise exception 'faltan las cuentas coll-tc*'; end if;

  -- 1 · permisos: solo el servidor
  if has_function_privilege('anon', 'public.app_team_identity_save(uuid,text,text,text,text,text,int)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.app_team_identity_save(uuid,text,text,text,text,text,int)', 'EXECUTE') then
    raise exception '1 FALLO: anon/authenticated pueden ejecutar la función'; end if;
  if not has_function_privilege('service_role', 'public.app_team_identity_save(uuid,text,text,text,text,text,int)', 'EXECUTE') then raise exception '1 FALLO: service_role no puede'; end if;
  if has_table_privilege('anon', 'public.content_team_identities', 'SELECT') or has_table_privilege('authenticated', 'public.content_team_identities', 'SELECT')
     or has_table_privilege('authenticated', 'public.content_team_identities', 'INSERT') or has_table_privilege('authenticated', 'public.content_team_identities', 'UPDATE') then
    raise exception '1 FALLO: los clientes pueden leer o escribir la tabla'; end if;
  select count(*) into n from pg_policies where tablename = 'content_team_identities';
  if n <> 0 then raise exception '1 FALLO: hay políticas'; end if;
  raise notice 'OK 1 · permisos: solo service_role, RLS sin políticas';

  -- 2 · un usuario normal no puede
  select count(*) into audit0 from public.content_audit_log;
  r := public.app_team_identity_save(u, 'QA Equipo', 'qa-equipo', 'QA Equipo', 'QAE', 'EMEA', 0);
  if r->>'code' <> 'NOT_ADMIN' or exists (select 1 from public.content_team_identities where printed_team = 'QA Equipo') then raise exception '2 FALLO: %', r; end if;
  r := public.app_team_identity_save(null, 'QA Equipo', 'qa-equipo', 'QA Equipo', 'QAE', 'EMEA', 0);
  if r->>'code' <> 'NOT_ADMIN' then raise exception '2 FALLO actor nulo: %', r; end if;
  raise notice 'OK 2 · usuario normal y actor nulo: NOT_ADMIN, nada escrito';

  -- 3 · alta + auditoría en la misma transacción
  r := public.app_team_identity_save(a, 'QA Equipo', 'qa-equipo', 'QA Equipo', 'QAE', 'EMEA', 0);
  if r->>'code' <> 'OK' or (r->>'rev')::int <> 1 then raise exception '3 FALLO alta: %', r; end if;
  select count(*) into n from public.content_audit_log where action = 'team_identity_create' and entity_id = 'qa-equipo' and actor = a;
  if n <> 1 then raise exception '3 FALLO: auditoría %', n; end if;
  raise notice 'OK 3 · alta con revisión 1 y su auditoría';

  -- 4 · revisión vieja, clave cambiada, clave ya usada
  r := public.app_team_identity_save(a, 'QA Equipo', 'qa-equipo', 'Otro', 'QAE', 'EMEA', 0);
  if r->>'code' <> 'CONFLICT' then raise exception '4 FALLO revisión vieja: %', r; end if;
  r := public.app_team_identity_save(a, 'QA Equipo', 'otra-clave', 'QA Equipo', 'QAE', 'EMEA', 1);
  if r->>'code' <> 'TEAM_ID_LOCKED' then raise exception '4 FALLO clave cambiada: %', r; end if;
  r := public.app_team_identity_save(a, 'QA Otro', 'qa-equipo', 'QA Otro', 'QAO', 'China', 0);
  if r->>'code' <> 'TEAM_ID_TAKEN' then raise exception '4 FALLO clave repetida: %', r; end if;
  r := public.app_team_identity_save(a, 'QA Equipo', 'qa-equipo', 'QA Corregido', 'QAC', 'Pacific', 1);
  if r->>'code' <> 'OK' or (r->>'rev')::int <> 2 then raise exception '4 FALLO corrección: %', r; end if;
  if (select region || ':' || name || ':' || rev from public.content_team_identities where printed_team = 'QA Equipo') <> 'Pacific:QA Corregido:2' then raise exception '4 FALLO fila'; end if;
  raise notice 'OK 4 · conflicto, clave inmutable, clave única y corrección con revisión 2';

  -- 5 · restricciones: datos inválidos no entran y la auditoría no queda a medias
  select count(*) into audit0 from public.content_audit_log;
  r := public.app_team_identity_save(a, 'QA Malo', 'qa-malo', 'QA Malo', 'QAM', 'Marte', 0);
  if r->>'code' <> 'INVALID' then raise exception '5 FALLO región: %', r; end if;
  r := public.app_team_identity_save(a, 'QA Malo', 'Mayus', 'QA Malo', 'QAM', 'EMEA', 0);
  if r->>'code' <> 'INVALID' then raise exception '5 FALLO clave: %', r; end if;
  r := public.app_team_identity_save(a, 'QA Malo', 'team-g2-v1', 'QA Malo', 'QAM', 'EMEA', 0);
  if r->>'code' <> 'INVALID' then raise exception '5 FALLO clave de set antiguo: %', r; end if;
  r := public.app_team_identity_save(a, 'QA Malo', 'qa-malo', 'QA Malo', 'DEMASIADO', 'EMEA', 0);
  if r->>'code' <> 'INVALID' then raise exception '5 FALLO etiqueta: %', r; end if;
  r := public.app_team_identity_save(a, ' QA Malo', 'qa-malo', 'QA Malo', 'QAM', 'EMEA', 0);
  if r->>'code' <> 'INVALID' then raise exception '5 FALLO texto con espacios: %', r; end if;
  if exists (select 1 from public.content_team_identities where team_id = 'qa-malo') then raise exception '5 FALLO: entró una fila inválida'; end if;
  if (select count(*) from public.content_audit_log) <> audit0 then raise exception '5 FALLO: auditoría de un guardado fallido'; end if;
  raise notice 'OK 5 · región, clave, etiqueta y texto inválidos rechazados sin fila ni auditoría';

  -- 6 · no toca nada más
  if exists (select 1 from public.content_team_identities where printed_team <> 'QA Equipo') then raise exception '6 FALLO: filas ajenas'; end if;
  raise notice 'OK 6 · solo su fila';
end $$;
\echo SQLTEST_0076_OK
rollback;
