-- 0058 v3 · PRUEBAS RLS/PRIVILEGIOS CRUZADAS (terminan en ROLLBACK: no persisten nada).
-- Se ejecutan contra la BD como los roles reales de PostgREST (anon / authenticated con claims) y service_role.
-- Cada caso imprime «ok» o «FALLA: …». Diseñadas para correr ANTES (documenta el agujero: varias FALLA) y
-- DESPUÉS de 0058 (todo ok). Las escrituras se prueban con «WHERE false»/filas inexistentes: no tocan datos.
begin;
create temp table _r (caso text, res text) on commit drop;
grant all on _r to anon, authenticated, service_role;

-- Un usuario para los claims (no se modifica: todo acaba en ROLLBACK). En la BD viva se fija una cuenta QA con
-- `set f69.qa_uid = '<uuid>';` ANTES de este fichero; sin ella, el perfil más antiguo (réplica sintética).
select set_config('f69.uid', coalesce(nullif(current_setting('f69.qa_uid', true), ''), (select id::text from public.profiles order by created_at limit 1)), true);

-- ── anon ──────────────────────────────────────────────────────────────────
set local role anon;
do $$ begin
  begin perform 1 from public.profiles limit 1; insert into _r values ('anon lee profiles', 'FALLA: legible');
  exception when insufficient_privilege then insert into _r values ('anon lee profiles', 'ok'); end;
  begin perform 1 from public.ranking_points limit 1; insert into _r values ('anon lee ranking_points', 'ok');
  exception when others then insert into _r values ('anon lee ranking_points', 'FALLA: ' || sqlerrm); end;
  begin perform 1 from public.pickem_questions_public limit 1; insert into _r values ('anon lee pickem_questions_public', 'ok');
  exception when others then insert into _r values ('anon lee pickem_questions_public', 'FALLA: ' || sqlerrm); end;
  begin update public.pickem_questions_public set points = points where false; insert into _r values ('anon escribe pickem_questions_public', 'FALLA: permitido');
  exception when insufficient_privilege then insert into _r values ('anon escribe pickem_questions_public', 'ok'); end;
  begin delete from public.card_photos where false; insert into _r values ('anon borra card_photos', 'FALLA: permitido');
  exception when insufficient_privilege then insert into _r values ('anon borra card_photos', 'ok'); end;
  begin perform public.recompute_standings('__f69_inexistente__'); insert into _r values ('anon ejecuta recompute_standings', 'FALLA: permitido');
  exception when insufficient_privilege then insert into _r values ('anon ejecuta recompute_standings', 'ok'); end;
  begin perform public._release_listing_offers('00000000-0000-0000-0000-000000000000'::uuid, null); insert into _r values ('anon ejecuta _release_listing_offers', 'FALLA: permitido');
  exception when insufficient_privilege then insert into _r values ('anon ejecuta _release_listing_offers', 'ok'); end;
  begin perform 1 from public.ranking_collection limit 1; insert into _r values ('anon lee vista heredada ranking_collection', 'FALLA: legible');
  exception when insufficient_privilege then insert into _r values ('anon lee vista heredada ranking_collection', 'ok'); end;
end $$;
reset role;

-- ── authenticated (claims de un usuario real) ─────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', current_setting('f69.uid'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare n int; me uuid := current_setting('f69.uid')::uuid; begin
  begin select count(*) into n from public.profiles where id = me; insert into _r values ('auth lee su perfil', case when n = 1 then 'ok' else 'FALLA: ' || n end);
  exception when others then insert into _r values ('auth lee su perfil', 'FALLA: ' || sqlerrm); end;
  begin select count(*) into n from public.profiles where points > 0; insert into _r values ('auth cuenta posiciones por puntos', 'ok');
  exception when others then insert into _r values ('auth cuenta posiciones por puntos', 'FALLA: ' || sqlerrm); end;
  begin update public.profiles set avatar = avatar where id = me; insert into _r values ('auth edita su avatar', 'ok');
  exception when others then insert into _r values ('auth edita su avatar', 'FALLA: ' || sqlerrm); end;
  begin update public.profiles set credits = credits + 1 where id = me; insert into _r values ('auth se sube créditos', 'FALLA: permitido');
  exception when insufficient_privilege or raise_exception then insert into _r values ('auth se sube créditos', 'ok'); end;
  begin select count(*) into n from public.profiles where id <> me and id is not null; update public.profiles set avatar = 'x' where id <> me; get diagnostics n = row_count; insert into _r values ('auth edita perfil ajeno', case when n = 0 then 'ok' else 'FALLA: ' || n end);
  exception when others then insert into _r values ('auth edita perfil ajeno', 'ok'); end;
  begin insert into public.profiles (id, username) values (gen_random_uuid(), '__f69__'); insert into _r values ('auth inserta perfil', 'FALLA: permitido');
  exception when insufficient_privilege or check_violation or foreign_key_violation then insert into _r values ('auth inserta perfil', 'ok'); end;
  begin delete from public.profiles where false; insert into _r values ('auth borra profiles', 'FALLA: permitido');
  exception when insufficient_privilege then insert into _r values ('auth borra profiles', 'ok'); end;
  begin update public.pickem_questions_public set points = points where false; insert into _r values ('auth escribe pickem_questions_public', 'FALLA: permitido');
  exception when insufficient_privilege then insert into _r values ('auth escribe pickem_questions_public', 'ok'); end;
  begin perform public.expire_offers(); insert into _r values ('auth ejecuta expire_offers', 'FALLA: permitido');
  exception when insufficient_privilege then insert into _r values ('auth ejecuta expire_offers', 'ok'); end;
  -- v3 · H6: columnas privadas de OTRA cuenta (y de la propia) no salen por REST; las públicas sí.
  begin perform credits from public.profiles where id <> me limit 1; insert into _r values ('auth lee credits de otra cuenta', 'FALLA: legible');
  exception when insufficient_privilege then insert into _r values ('auth lee credits de otra cuenta', 'ok'); end;
  begin perform is_admin from public.profiles limit 1; insert into _r values ('auth lee is_admin', 'FALLA: legible');
  exception when insufficient_privilege then insert into _r values ('auth lee is_admin', 'ok'); end;
  begin perform last_seen_at from public.profiles limit 1; insert into _r values ('auth lee last_seen_at', 'FALLA: legible');
  exception when insufficient_privilege then insert into _r values ('auth lee last_seen_at', 'ok'); end;
  begin perform * from public.profiles limit 1; insert into _r values ('auth select * de profiles', 'FALLA: legible');
  exception when insufficient_privilege then insert into _r values ('auth select * de profiles', 'ok'); end;
  begin select count(*) into n from public.profiles where region = 'EMEA' and points > 0; insert into _r values ('auth lee columnas públicas (posición regional)', 'ok');
  exception when others then insert into _r values ('auth lee columnas públicas (posición regional)', 'FALLA: ' || sqlerrm); end;
  begin perform username, avatar, level from public.profiles where id <> me limit 1; insert into _r values ('auth lee nombre/avatar/nivel ajenos', 'ok');
  exception when others then insert into _r values ('auth lee nombre/avatar/nivel ajenos', 'FALLA: ' || sqlerrm); end;
  begin update public.profiles set region = region where id = me; insert into _r values ('auth edita su región', 'ok');
  exception when others then insert into _r values ('auth edita su región', 'FALLA: ' || sqlerrm); end;
end $$;
-- TRUNCATE no admite «where false»: se comprueba el privilegio, no se ejecuta.
insert into _r select 'auth tiene TRUNCATE en profiles', case when has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE') then 'FALLA: concedido' else 'ok' end;
reset role;

-- ── service_role ──────────────────────────────────────────────────────────
insert into _r select 'service_role ejecuta recompute_standings', case when has_function_privilege('service_role', 'public.recompute_standings(text)', 'EXECUTE') then 'ok' else 'FALLA' end;
insert into _r select 'service_role lee profiles', case when has_table_privilege('service_role', 'public.profiles', 'SELECT') then 'ok' else 'FALLA' end;

select caso || ' | ' || res from _r;
rollback;
