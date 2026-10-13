-- =============================================================================================================
-- LIMPIEZA DE CUENTAS (2026-10-05) · instrumento de operador, fuera de CI y fuera de la release.
-- Conserva SOLO davex (#NB2Z9BM) y valorosters (#H5ND8K7), los hace administradores por la RPC canónica (0067) y
-- borra el resto de cuentas por el mecanismo canónico del esquema: borrar la fila de auth.users, de la que cuelga
-- TODO por FK ON DELETE CASCADE (perfil, cartas, sobres, equipos, partidas, rating, social, temporada, misiones,
-- feedback, sesiones y tokens de auth). El libro de rating y las instantáneas competitivas aceptan el borrado SOLO en
-- cascada (pg_trigger_depth > 1): es el camino previsto. Lo que NO tiene FK sobrevive como HISTÓRICO anonimizado:
-- torneos (cups/cup_registrations con instantánea de nombre y #TAG, cup_matches), auditoría (content_audit_log,
-- append-only) y el registro de tags (account_tag_registry, append-only: los tags borrados NUNCA se reutilizan).
--
-- Una sola transacción. Cualquier guarda que falle → RAISE → no se aplica NADA.
-- Uso:  psql -v ON_ERROR_STOP=1 -v commit_or_rollback=COMMIT|ROLLBACK -f _account-cleanup.sql
-- =============================================================================================================
\set ON_ERROR_STOP on
begin;

-- ── 0. KEEP por UUID, revalidado contra #TAG y nombre (nunca por nombre solo) ─────────────────────────────────────
create temp table keep_set (id uuid primary key, tag text not null, username text not null) on commit drop;
insert into keep_set values
  ('3befce61-4c21-4c84-8397-40504fe6ec27', 'NB2Z9BM', 'davex_234_3bef'),
  ('b7ccff02-e845-4a5d-ac1c-4ab23689b0a9', 'H5ND8K7', 'ValoRosters_b7cc');
do $$
begin
  if (select count(*) from keep_set k join public.profiles p on p.id = k.id and p.public_tag = k.tag and p.username = k.username
        join auth.users u on u.id = k.id) <> 2 then
    raise exception 'GUARD_KEEP: davex/valorosters no coinciden exactamente (uuid + tag + nombre)';
  end if;
  if (select count(*) from public.profiles where username ilike '%valoroster%') <> 1 then
    raise exception 'GUARD_AMBIGUO: hay más de una cuenta que podría ser «valorosters»';
  end if;
end $$;

-- ── 1. admins definitivos por la RPC canónica (0067: cerrojo, auditoría GRANT_ADMIN en la misma transacción) ─────
-- Actor = el admin vigente (#9KZAWPC), operado a petición del propietario; queda en content_audit_log.
select public.app_admin_set_admin('2f86cbe8-f663-40fb-a87c-4896b9a45b62', '3befce61-4c21-4c84-8397-40504fe6ec27', true, 'Admins definitivos: davex (operador, a petición del propietario)');
select public.app_admin_set_admin('2f86cbe8-f663-40fb-a87c-4896b9a45b62', 'b7ccff02-e845-4a5d-ac1c-4ab23689b0a9', true, 'Admins definitivos: valorosters (operador, a petición del propietario)');
do $$
begin
  if (select count(*) from public.profiles where is_admin and id in (select id from keep_set)) <> 2 then
    raise exception 'GUARD_ADMINS: davex y valorosters no quedaron admin';
  end if;
end $$;
-- Retirada AUDITADA del admin antiguo (actor = davex, ya admin) ANTES de borrarlo: el suelo de admins sigue activo.
select public.app_admin_set_admin('3befce61-4c21-4c84-8397-40504fe6ec27', '2f86cbe8-f663-40fb-a87c-4896b9a45b62', false, 'Cuenta admin antigua retirada antes de su borrado (limpieza de cuentas)');

-- ── 2. DELETE SET = todo auth.users salvo KEEP; recuento esperado fijo ──────────────────────────────────────────
create temp table delete_set on commit drop as select u.id from auth.users u where u.id not in (select id from keep_set);
do $$
begin
  if exists (select 1 from delete_set d join keep_set k on k.id = d.id) then raise exception 'GUARD_KEEP_EN_DELETE'; end if;
  if (select count(*) from delete_set) <> 47 then raise exception 'GUARD_RECUENTO: se esperaban 47 cuentas a borrar, hay %', (select count(*) from delete_set); end if;
  if not exists (select 1 from delete_set where id = '2f86cbe8-f663-40fb-a87c-4896b9a45b62') then raise exception 'GUARD_ADMIN_ANTIGUO_NO_INCLUIDO'; end if;
  if exists (select 1 from public.profiles where is_admin and id in (select id from delete_set)) then raise exception 'GUARD_ADMIN_EN_DELETE'; end if;
end $$;
create temp table tags_before on commit drop as select count(*) n from public.account_tag_registry;
create temp table audit_before on commit drop as select count(*) n from public.content_audit_log;
create temp table cups_before on commit drop as select (select count(*) from public.cups) c, (select count(*) from public.cup_registrations) r, (select count(*) from public.cup_matches) m;

-- ── 3. borrado canónico (cascada por FK); revalidación del KEEP justo antes ────────────────────────────────────
do $$
begin
  if (select count(*) from keep_set k join public.profiles p on p.id = k.id) <> 2 then raise exception 'GUARD_KEEP_ANTES_DE_BORRAR'; end if;
end $$;
-- Sanciones de cuentas que se borran: la cascada (user_id) las borraría igualmente, pero el SET NULL de revoked_by
-- (si quien la revocó también se borra) dispararía antes user_sanctions_revoke_check. Se borran PRIMERO, solo las del
-- DELETE SET (mismo resultado final que la cascada; su rastro sigue en content_audit_log). Ninguna restricción se toca.
do $$
begin
  if exists (select 1 from public.user_sanctions where user_id in (select id from keep_set) and (created_by in (select id from delete_set) or revoked_by in (select id from delete_set))) then
    raise exception 'GUARD_SANCION_KEEP: una sanción de una cuenta KEEP depende de una cuenta a borrar';
  end if;
end $$;
delete from public.user_sanctions where user_id in (select id from delete_set) and user_id not in (select id from keep_set);
delete from auth.users where id in (select id from delete_set) and id not in (select id from keep_set);

-- ── 4. invariantes después ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare v_bad int;
begin
  if (select count(*) from auth.users) <> 2 then raise exception 'POST: auth.users <> 2'; end if;
  if (select count(*) from public.profiles) <> 2 then raise exception 'POST: profiles <> 2'; end if;
  if (select count(*) from public.profiles where is_admin) <> 2 then raise exception 'POST: admins <> 2'; end if;
  if (select count(*) from keep_set k join auth.users u on u.id = k.id join public.profiles p on p.id = k.id and p.is_admin) <> 2 then raise exception 'POST: KEEP no intacto'; end if;
  if (select count(*) from public.account_tag_registry) <> (select n from tags_before) then raise exception 'POST: el registro de tags cambió'; end if;
  if not exists (select 1 from public.account_tag_registry where tag = '9KZAWPC') then raise exception 'POST: #9KZAWPC no sigue reservado'; end if;
  if (select count(*) from public.content_audit_log) < (select n from audit_before) then raise exception 'POST: se perdió auditoría'; end if;
  if (select (select count(*) from public.cups) <> c or (select count(*) from public.cup_registrations) <> r or (select count(*) from public.cup_matches) <> m from cups_before) then raise exception 'POST: histórico de torneos alterado'; end if;
  -- referencias por FK colgando: imposibles (FK); se comprueban las tablas SIN FK que el juego lee en vivo.
  select count(*) into v_bad from public.duel_decks d where not exists (select 1 from auth.users u where u.id = d.user_id);
  if v_bad > 0 then raise exception 'POST: equipos huérfanos %', v_bad; end if;
  select count(*) into v_bad from public.user_cards c where not exists (select 1 from auth.users u where u.id = c.user_id);
  if v_bad > 0 then raise exception 'POST: cartas huérfanas %', v_bad; end if;
  select count(*) into v_bad from public.duel_matches m where not exists (select 1 from auth.users u where u.id = m.user_id) or (m.player_b_id is not null and not exists (select 1 from auth.users u where u.id = m.player_b_id));
  if v_bad > 0 then raise exception 'POST: partidas huérfanas %', v_bad; end if;
  select count(*) into v_bad from public.user_cosmetics c where not exists (select 1 from auth.users u where u.id = c.user_id);
  if v_bad > 0 then raise exception 'POST: trofeos/cosméticos huérfanos %', v_bad; end if;
  select count(*) into v_bad from public.duel_friendships f where not exists (select 1 from auth.users u where u.id = f.user_lo) or not exists (select 1 from auth.users u where u.id = f.user_hi);
  if v_bad > 0 then raise exception 'POST: amistades rotas %', v_bad; end if;
  select count(*) into v_bad from public.alpha_feedback;
  if v_bad > 0 then raise exception 'POST: queda feedback (solo había QA) %', v_bad; end if;
  if (select status from public.cups where slug = 'valorosters-open-1') <> 'DRAFT' then raise exception 'POST: Open #1 no está en DRAFT'; end if;
  if (select status || '/' || visibility from public.cups where slug = 'valorosters-closed-alpha-cup') <> 'DRAFT/UNLISTED' then raise exception 'POST: Closed Alpha Cup cambió'; end if;
  if (select status from public.game_seasons where id = 'temporada-2') <> 'DRAFT' then raise exception 'POST: Temporada 2 no está en DRAFT'; end if;
  select count(*) into v_bad from auth.sessions s where not exists (select 1 from auth.users u where u.id = s.user_id);
  if v_bad > 0 then raise exception 'POST: sesiones de cuentas borradas %', v_bad; end if;
  select count(*) into v_bad from auth.refresh_tokens r where not exists (select 1 from auth.users u where u.id::text = r.user_id);
  if v_bad > 0 then raise exception 'POST: refresh tokens de cuentas borradas %', v_bad; end if;
  select count(*) into v_bad from auth.identities i where not exists (select 1 from auth.users u where u.id = i.user_id);
  if v_bad > 0 then raise exception 'POST: identidades de cuentas borradas %', v_bad; end if;
end $$;

select 'RESUMEN usuarios=' || (select count(*) from auth.users) || ' perfiles=' || (select count(*) from public.profiles)
  || ' admins=' || (select string_agg(username || ' #' || public_tag, ', ' order by username) from public.profiles where is_admin)
  || ' tags_registrados=' || (select count(*) from public.account_tag_registry)
  || ' auditoría=' || (select count(*) from public.content_audit_log)
  || ' copas=' || (select count(*) from public.cups) || ' inscripciones=' || (select count(*) from public.cup_registrations) || ' cruces=' || (select count(*) from public.cup_matches)
  || ' sesiones=' || (select count(*) from auth.sessions) || ' refresh_tokens=' || (select count(*) from auth.refresh_tokens)
  || ' identities=' || (select count(*) from auth.identities);

:commit_or_rollback;
