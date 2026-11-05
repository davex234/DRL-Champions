-- =============================================================================
-- 0058_hardening_grants — v3 (F69, 2026-09-27)  ·  NO APLICADA. NO está en supabase/migrations (cabeza = 0057).
-- =============================================================================
-- Revisión F69 de la propuesta F67. Estado medido en la BD viva (solo lectura, 2026-09-27):
--
--  H1. `profiles`: anon y authenticated tienen SELECT sobre las 20 columnas y la política «perfiles visibles
--      para todos» (USING true) → cualquiera con la clave anon lee credits, xp, is_admin, last_seen_at…
--  H2. anon/authenticated tienen INSERT y DELETE sobre `profiles` (política «crea tu perfil»; DELETE sin política).
--  H3. TRUNCATE concedido a anon/authenticated en 68 tablas de public (postflight en vivo, 2026-09-27 21:14Z) (TRUNCATE no pasa por RLS).
--  H4. Funciones SECURITY DEFINER sin comprobar auth.uid() ejecutables por anon: recompute_* (CPU),
--      expire_offers y _release_listing_offers (mueven créditos: reembolsan ofertas de mercado de CUALQUIERA),
--      _check_wash (inserta avisos contra cualquier usuario), _check_rate, _check_price_band, _price_anchor,
--      _asset_refresh_best. Todos sus llamadores legítimos son SECURITY DEFINER (0004/0007/0020) o service_role
--      (worker esports: src/lib/esports/sync/writers.ts) → revocar a los roles de cliente no rompe nada.
--  H5. NUEVO EN F69 — CRÍTICO ANTES DE RC. Las vistas `pickem_questions_public` (sobre pickem_questions) y
--      `card_photos` (sobre assets) son AUTO-ACTUALIZABLES, sin security_invoker y propiedad de `postgres`
--      (superusuario: salta RLS). anon/authenticated tienen INSERT/UPDATE/DELETE sobre ellas (privilegios por
--      defecto del esquema) → por PostgREST con la clave anon se podrían cambiar puntos/cierre de preguntas de
--      Pick'ems o borrar/alterar fotos de jugador. Hoy NO es alcanzable desde Internet (Kong escucha en
--      127.0.0.1 del VPS; la app va por túnel SSH), pero lo sería el día que la API se publique.
--      El resto de vistas públicas tienen los mismos privilegios de escritura pero no son actualizables.
--
--  H6. NUEVO EN F69 (v3). Aunque anon salga de `profiles`, el registro es ABIERTO y con autoconfirmación: cualquiera
--      obtiene el rol `authenticated` en segundos, y con él la política «visible para todos» + SELECT de tabla le
--      dejaban leer credits, xp, is_admin, last_seen_at, equipped… de TODAS las cuentas. Revocar solo a anon no
--      cumplía la minimización.
--  H7. NUEVO EN F69 (v3). Las vistas heredadas de 0001 `ranking_level`, `ranking_collection`, `ranking_market` y
--      `ranking_rarities` (dueño postgres) publican xp, collection_value, market_volume y rarest_rank del top 100 a
--      anon. Ningún código del producto las lee (medido: solo un comentario de 0030).
--
-- DECISIÓN F69 (B: correcta y necesaria antes de RC, CON AJUSTES):
--  · La v1 revocaba SELECT de columnas privadas también a `authenticated`, lo que rompía el cliente de 0057
--    (auth.tsx leía su perfil con select("*") y useAdminSession leía is_admin por REST).
--  · v2 (primer pase de F69) lo dejó fuera («etapa 2»). v3 lo INCLUYE porque el cliente F69 ya no lee columnas
--    privadas por REST: el perfil propio llega por `GET /api/game/me` (service_role, filtrado por el Bearer), que
--    funciona igual con 0057 y con 0058. Contrato en src/lib/supabase/profileExposure.ts y
--    docs/product/qa/fase69-hardening/profile-exposure.json.
--  · ORDEN OBLIGATORIO: primero la build F69 servida (cliente sin lecturas privadas por REST), DESPUÉS 0058. Con la
--    build F68 y 0058 aplicada, el perfil propio saldría vacío en la interfaz (HUD de nivel/puntos, acceso admin).
--
-- ANTES DE APLICAR (autorización explícita del usuario): 0058_preflight.sql (todo OK) → backup verificado
-- (scripts/ops/backup-drlcards.sh, BACKUP_OK) → aplicar ESTE fichero en una transacción → 0058_postflight.sql →
-- 0058_rls_tests.sql (termina en ROLLBACK) → smoke:production. Rollback exacto: 0058_hardening_grants.ROLLBACK.sql.
begin;

-- Seguro: solo sobre la cabeza esperada (0057 aplicada = existe la tabla de auditoría admin de F58/F60).
do $$ begin
  if to_regclass('public.profiles') is null then raise exception '0058: falta public.profiles'; end if;
  if to_regprocedure('public.recompute_standings(text)') is null then raise exception '0058: firma recompute_standings(text) distinta'; end if;
end $$;

-- H1 (etapa 1) · anon no lee `profiles` directamente. Las clasificaciones públicas siguen por las vistas
-- ranking_* (propiedad de postgres, no dependen del privilegio de anon sobre la tabla).
revoke all on public.profiles from anon;

-- H2 · nadie crea ni borra su perfil a mano: lo crea handle_new_user (SECURITY DEFINER).
revoke insert, delete, truncate on public.profiles from authenticated;
drop policy if exists "crea tu perfil" on public.profiles;

-- H3 · TRUNCATE fuera para los roles de cliente en todas las tablas de public, y para las futuras.
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke truncate on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;

-- H5 · ninguna VISTA de public es escribible por los roles de cliente (SELECT se conserva tal cual).
do $$ declare v record; begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('v', 'm') loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', v.relname);
  end loop;
end $$;

-- H4 · recálculos, mantenimiento y helpers internos del mercado/assets: solo service_role (y sus llamadores
-- SECURITY DEFINER, que se ejecutan como el dueño).
revoke execute on function public.recompute_standings(text)                 from public, anon, authenticated;
revoke execute on function public.recompute_team_stats(text, text)          from public, anon, authenticated;
revoke execute on function public.recompute_player_event_stats(text)        from public, anon, authenticated;
revoke execute on function public.expire_offers()                           from public, anon, authenticated;
revoke execute on function public._release_listing_offers(uuid, uuid)       from public, anon, authenticated;
revoke execute on function public._check_wash(uuid, uuid)                   from public, anon, authenticated;
revoke execute on function public._check_rate(text, integer)                from public, anon, authenticated;
revoke execute on function public._check_price_band(text, bigint)           from public, anon, authenticated;
revoke execute on function public._price_anchor(text)                       from public, anon, authenticated;
revoke execute on function public._asset_refresh_best(text, text, text)     from public, anon, authenticated;
grant execute on function public.recompute_standings(text)                  to service_role;
grant execute on function public.recompute_team_stats(text, text)           to service_role;
grant execute on function public.recompute_player_event_stats(text)         to service_role;
grant execute on function public.expire_offers()                            to service_role;
grant execute on function public._release_listing_offers(uuid, uuid)        to service_role;
grant execute on function public._check_wash(uuid, uuid)                    to service_role;
grant execute on function public._check_rate(text, integer)                 to service_role;
grant execute on function public._check_price_band(text, bigint)            to service_role;
grant execute on function public._price_anchor(text)                        to service_role;
grant execute on function public._asset_refresh_best(text, text, text)      to service_role;

-- H6 · `authenticated` lee por REST solo las columnas públicas de `profiles` (cualquier fila): contar posiciones
-- por puntos/región y editar su avatar/región/nombre. Lo privado del propio jugador va por /api/game/me.
-- (Revocar el SELECT de tabla también retira los de columna; por eso se concede después.)
revoke select, references, trigger on public.profiles from authenticated;
grant select (id, username, avatar, level, points, region) on public.profiles to authenticated;

-- H7 · vistas heredadas sin uso: fuera de los roles de cliente (service_role conserva todo).
revoke all on public.ranking_level, public.ranking_collection, public.ranking_market, public.ranking_rarities from anon, authenticated;

-- Guardia final: si algo no quedó como se espera, no se confirma nada.
do $$ begin
  if has_column_privilege('authenticated', 'public.profiles', 'credits', 'SELECT') then raise exception '0058: authenticated sigue leyendo credits'; end if;
  if has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'SELECT') then raise exception '0058: authenticated sigue leyendo is_admin'; end if;
  if has_column_privilege('authenticated', 'public.profiles', 'last_seen_at', 'SELECT') then raise exception '0058: authenticated sigue leyendo last_seen_at'; end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'points', 'SELECT') then raise exception '0058: authenticated perdió points (posición por puntos)'; end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'avatar', 'UPDATE') then raise exception '0058: authenticated perdió UPDATE de avatar'; end if;
  if has_table_privilege('anon', 'public.ranking_collection', 'SELECT') then raise exception '0058: vista heredada legible'; end if;
  if has_table_privilege('anon', 'public.profiles', 'SELECT') then raise exception '0058: anon sigue leyendo profiles'; end if;
  if has_table_privilege('anon', 'public.pickem_questions_public', 'UPDATE') then raise exception '0058: vista escribible'; end if;
  if has_table_privilege('authenticated', 'public.card_photos', 'DELETE') then raise exception '0058: vista escribible'; end if;
  if has_function_privilege('anon', 'public._release_listing_offers(uuid, uuid)', 'EXECUTE') then raise exception '0058: helper ejecutable'; end if;
  if not has_function_privilege('service_role', 'public.recompute_standings(text)', 'EXECUTE') then raise exception '0058: service_role perdió recompute'; end if;
  if not has_table_privilege('anon', 'public.ranking_points', 'SELECT') then raise exception '0058: clasificación pública rota'; end if;
  if not has_table_privilege('anon', 'public.pickem_questions_public', 'SELECT') then raise exception '0058: Pick''ems públicos rotos'; end if;
end $$;

commit;
