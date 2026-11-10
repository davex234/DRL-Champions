-- =============================================================================
-- 0061_forge_progression — F79 · NEXUS FORGE 2.0  (+ F79.1: carta protegida en la BD)
-- =============================================================================
-- Aplicar DENTRO de una transacción (BEGIN … COMMIT), como 0045–0059: este fichero no abre ni cierra ninguna, para que
-- el dry-run pueda terminar en ROLLBACK. Aditiva e idempotente (`if not exists`, `create or replace`, `on conflict`).
--
-- POR QUÉ HACE FALTA (el modelo existente no basta para TRES cosas, y SOLO para esas tres):
--   1. CONFIGURACIÓN EDITABLE SIN CÓDIGO. La progresión de la Forja (XP, curva, maestría, recetas avanzadas, cadenas,
--      planos, objetivos, logros, pity) tiene que poder configurarla el admin. No existe ninguna tabla genérica de
--      configuración (solo `market_config`/`market_flags`, del mercado). → tabla `forge_config` (UN documento versionado).
--      Todo lo que el JUGADOR tiene en la Forja se DERIVA del libro mayor que ya existe (`economy_ops`,
--      `user_project_claims`, `credit_transactions`): no se crea NINGUNA tabla de progreso por usuario.
--   2. ÚLTIMA COPIA COHERENTE. `app_craft_card` (0059) contaba como «copia que conservas» una copia BLOQUEADA (en venta);
--      el desguace (0060) no. Se alinea con 0060: queda al menos una copia DESBLOQUEADA. Misma firma, permisos,
--      idempotencia y libro mayor.
--   3. CARTA PROTEGIDA DENTRO DE LA TRANSACCIÓN (F79.1). Favorita (0052) y vitrina (0049) solo se pueden destruir si el
--      jugador lo CONFIRMA copia a copia, y una copia de un equipo nunca: hasta ahora solo lo decía Node (y el desguace ni
--      eso). Dos RPC NUEVAS (`app_craft_card_guarded`, `app_salvage_cards_guarded`) envuelven a las existentes:
--        · se serializan con las altas de favoritas (MISMO cerrojo consultivo que el disparador de 0052) y con los cambios
--          de vitrina (fila de 0049 con FOR SHARE; se crea vacía si no existe, como hace `player_profile_set`);
--        · comprueban equipo / favorita / vitrina con lo YA confirmado, y llaman a la RPC de siempre (que bloquea las
--          copias y aplica última copia + idempotencia + libro mayor).
--      Las RPC de antes (`app_craft_card`, `app_salvage_cards`) NO cambian de firma: la app desplegada hoy sigue
--      funcionando igual contra 0061 (compatibilidad hacia atrás); el código F79.1 usa SOLO las guardadas.
--
-- NO cambia: precios, probabilidades, recompensas, créditos, cartas, sobres, recetas sembradas, valores de desguace,
-- mercado, pagos, telemetría, ni 0059/0060 (más allá de la condición de última copia de `app_craft_card`).
--
-- Las recetas avanzadas reutilizan `app_craft_card` con una fila espejo CARD en `craft_recipes` (id `forge-…`) que
-- escribe el panel; nacen DISABLED. Esta migración NO crea ninguna fila de contenido.
--
-- ROLLBACK OPERATIVO (el sistema de migraciones es solo hacia delante; no hay «down»): ver
-- `docs/operations/rollback/0061_forge_progression.ROLLBACK.sql` — borra las 4 funciones nuevas y `forge_config`
-- (tras guardar su contenido) y devuelve `app_craft_card` al cuerpo exacto de 0059. Requiere desplegar ANTES el código
-- anterior a F79.1 (el de F79.1 llama a las RPC guardadas).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. CONFIGURACIÓN DE LA FORJA (un documento, versión optimista, solo service_role)
-- ----------------------------------------------------------------------------
create table if not exists public.forge_config (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  doc         jsonb not null check (jsonb_typeof(doc) = 'object'),
  version     int   not null default 1 check (version >= 1),
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.forge_config enable row level security;
revoke all on public.forge_config from public, anon, authenticated;
grant select, insert, update on public.forge_config to service_role;
-- Sin políticas: el navegador no la lee ni la escribe; la lee y la escribe el servidor (service_role, que salta RLS).

-- ----------------------------------------------------------------------------
-- 2. INTERCAMBIO / FORJA DE CARTAS — misma función que 0059, «te queda al menos una copia DESBLOQUEADA».
-- ----------------------------------------------------------------------------
create or replace function public.app_craft_card(
  p_user uuid, p_recipe text, p_uids uuid[], p_expected jsonb, p_output_card_id text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.craft_recipes%rowtype; v_prev jsonb; v_n int; v_bad int; v_uid uuid; v_cards text[];
begin
  if p_ref is null or length(p_ref) = 0 then raise exception 'Un crafteo necesita clave de idempotencia'; end if;
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  select * into r from public.craft_recipes where id = p_recipe;
  if not found then raise exception 'RECIPE_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.kind <> 'CARD' then raise exception 'RECIPE_KIND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' or (r.available_from is not null and now() < r.available_from)
     or (r.available_to is not null and now() >= r.available_to) then
    raise exception 'RECIPE_DISABLED' using errcode = 'P0001';
  end if;
  if p_uids is null or array_length(p_uids, 1) is distinct from r.input_qty then raise exception 'WRONG_COUNT' using errcode = 'P0001'; end if;
  if (select count(distinct u) from unnest(p_uids) u) <> r.input_qty then raise exception 'DUPLICATE_INPUT' using errcode = 'P0001'; end if;
  if p_output_card_id is null or length(p_output_card_id) = 0 then raise exception 'NO_OUTPUT' using errcode = 'P0001'; end if;

  select array_agg(distinct value) into v_cards from jsonb_each_text(p_expected);
  perform 1 from public.user_cards where user_id = p_user and card_id = any(v_cards) for update;

  select count(*) into v_n from public.user_cards
   where uid = any(p_uids) and user_id = p_user and locked = false
     and card_id = (p_expected ->> uid::text);
  if v_n <> r.input_qty then raise exception 'NOT_ELIGIBLE' using errcode = 'P0001'; end if;

  if exists (select 1 from public.duel_decks d where d.user_id = p_user and d.card_uids && p_uids) then
    raise exception 'IN_DECK' using errcode = 'P0001';
  end if;

  -- 0061 · como el desguace (0060): de cada carta queda al menos una copia DESBLOQUEADA (una en venta no cuenta).
  select count(*) into v_bad from (
    select c.card_id,
           count(*) filter (where c.locked = false and not (c.uid = any(p_uids))) as kept
      from public.user_cards c where c.user_id = p_user and c.card_id = any(v_cards)
     group by c.card_id) t where t.kept < 1;
  if v_bad > 0 then raise exception 'LAST_COPY' using errcode = 'P0001'; end if;

  delete from public.user_cards where uid = any(p_uids) and user_id = p_user;
  insert into public.user_cards (user_id, card_id, serial, origin) values (p_user, p_output_card_id, null, 'craft')
    returning uid into v_uid;

  v_prev := jsonb_build_object(
    'recipeId', r.id, 'kind', 'CARD',
    'inputs', (select jsonb_agg(jsonb_build_object('uid', u, 'cardId', p_expected ->> u::text)) from unnest(p_uids) u),
    'outputs', jsonb_build_array(jsonb_build_object('uid', v_uid, 'cardId', p_output_card_id)));
  insert into public.economy_ops (ref, user_id, kind, result) values (p_ref, p_user, 'craft_card', v_prev);
  return v_prev;
end; $$;

revoke all on function public.app_craft_card(uuid, text, uuid[], jsonb, text, text) from public, anon, authenticated;
grant execute on function public.app_craft_card(uuid, text, uuid[], jsonb, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 3. CARTA PROTEGIDA (F79.1) — la regla de `src/domain/cards/protection.ts`, dentro de la transacción.
-- ----------------------------------------------------------------------------
-- 3a. Serialización por jugador con todo lo que puede PROTEGER una copia mientras se destruye:
--     · alta de favorita → el disparador de 0052 toma `pg_advisory_xact_lock(hashtextextended('user_card_favorites:'||uid, 0))`;
--       aquí se toma EL MISMO, así que una favorita que llega a la vez espera o es esperada (nunca se cuela en medio);
--     · vitrina → `player_profile_set` (0049) hace `insert … on conflict do nothing` + `select … for update` de su fila;
--       aquí se hace el mismo insert (fila vacía si no existía) + `for share`: un cambio de vitrina a la vez espera.
create or replace function public._card_consume_lock(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('user_card_favorites:' || p_user::text, 0));
  insert into public.player_profile_customization (user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from public.player_profile_customization where user_id = p_user for share;
end; $$;

-- 3b. La comprobación: en un equipo → nunca; favorita (por carta) o vitrina (por copia) → solo si está en p_confirm.
create or replace function public._card_consume_guard(p_user uuid, p_uids uuid[], p_confirm uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_show uuid[];
begin
  if exists (select 1 from public.duel_decks d where d.user_id = p_user and d.card_uids && p_uids) then
    raise exception 'IN_DECK' using errcode = 'P0001';
  end if;
  select showcase_card_uids into v_show from public.player_profile_customization where user_id = p_user;
  if exists (
    select 1 from public.user_cards c
     where c.user_id = p_user and c.uid = any(p_uids)
       and not (c.uid = any(coalesce(p_confirm, '{}'::uuid[])))
       and (c.uid = any(coalesce(v_show, '{}'::uuid[]))
            or exists (select 1 from public.user_card_favorites f where f.user_id = p_user and f.card_id = c.card_id))
  ) then
    raise exception 'PROTECTED_COPY' using errcode = 'P0001';
  end if;
end; $$;

revoke all on function public._card_consume_lock(uuid) from public, anon, authenticated, service_role;
revoke all on function public._card_consume_guard(uuid, uuid[], uuid[]) from public, anon, authenticated, service_role;

-- 3c. Intercambio / forja GUARDADA. Idempotencia primero (un reintento de algo ya hecho devuelve lo guardado, aunque
--     las copias ya no existan); otra vez tras esperar el cerrojo (otra petición con la MISMA clave pudo terminar).
create or replace function public.app_craft_card_guarded(
  p_user uuid, p_recipe text, p_uids uuid[], p_expected jsonb, p_output_card_id text, p_ref text, p_confirm uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb;
begin
  if p_ref is null or length(p_ref) = 0 then raise exception 'Un crafteo necesita clave de idempotencia'; end if;
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;
  perform public._card_consume_lock(p_user);
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;
  perform public._card_consume_guard(p_user, p_uids, p_confirm);
  return public.app_craft_card(p_user, p_recipe, p_uids, p_expected, p_output_card_id, p_ref);
end; $$;

-- 3d. Desguace GUARDADO (mismo patrón; el cuerpo de 0060 —última copia dentro de la transacción— no se toca).
create or replace function public.app_salvage_cards_guarded(p_user uuid, p_uids uuid[], p_total bigint, p_ref text, p_confirm uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb;
begin
  if p_ref is null or length(p_ref) = 0 then raise exception 'Un desguace necesita clave de idempotencia'; end if;
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;
  perform public._card_consume_lock(p_user);
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;
  perform public._card_consume_guard(p_user, p_uids, p_confirm);
  return public.app_salvage_cards(p_user, p_uids, p_total, p_ref);
end; $$;

revoke all on function public.app_craft_card_guarded(uuid, text, uuid[], jsonb, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.app_craft_card_guarded(uuid, text, uuid[], jsonb, text, text, uuid[]) to service_role;
revoke all on function public.app_salvage_cards_guarded(uuid, uuid[], bigint, text, uuid[]) from public, anon, authenticated;
grant execute on function public.app_salvage_cards_guarded(uuid, uuid[], bigint, text, uuid[]) to service_role;

-- ----------------------------------------------------------------------------
-- GUARDIA FINAL: si algo no quedó como debe, la transacción que envuelve este fichero se aborta.
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.forge_config') is null then raise exception '0061: falta forge_config'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.forge_config'::regclass) then raise exception '0061: forge_config sin RLS'; end if;
  if has_table_privilege('anon', 'public.forge_config', 'select') or has_table_privilege('authenticated', 'public.forge_config', 'select')
     or has_table_privilege('authenticated', 'public.forge_config', 'insert') or has_table_privilege('anon', 'public.forge_config', 'insert') then
    raise exception '0061: forge_config accesible desde el navegador';
  end if;
  if (select count(*) from public.forge_config) <> 0 and not exists (select 1 from public.forge_config where id = 'main') then
    raise exception '0061: contenido inesperado en forge_config';
  end if;
  if (select prosrc from pg_proc where oid = 'public.app_craft_card(uuid, text, uuid[], jsonb, text, text)'::regprocedure)
     not like '%c.locked = false and not (c.uid = any(p_uids))%' then
    raise exception '0061: app_craft_card sin la última copia desbloqueada';
  end if;
  if (select prosrc from pg_proc where oid = 'public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure) not like '%LAST_COPY%' then
    raise exception '0061: el desguace de 0060 no está (o perdió la última copia)';
  end if;
  if (select prosrc from pg_proc where oid = 'public._card_consume_guard(uuid, uuid[], uuid[])'::regprocedure) not like '%PROTECTED_COPY%' then
    raise exception '0061: falta la guardia de carta protegida';
  end if;
  if has_function_privilege('anon', 'public.app_craft_card(uuid, text, uuid[], jsonb, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_craft_card(uuid, text, uuid[], jsonb, text, text)', 'execute')
     or has_function_privilege('anon', 'public.app_craft_card_guarded(uuid, text, uuid[], jsonb, text, text, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.app_craft_card_guarded(uuid, text, uuid[], jsonb, text, text, uuid[])', 'execute')
     or has_function_privilege('anon', 'public.app_salvage_cards_guarded(uuid, uuid[], bigint, text, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.app_salvage_cards_guarded(uuid, uuid[], bigint, text, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public._card_consume_guard(uuid, uuid[], uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public._card_consume_lock(uuid)', 'execute') then
    raise exception '0061: alguna RPC de cartas es invocable desde el navegador';
  end if;
  if not has_function_privilege('service_role', 'public.app_craft_card_guarded(uuid, text, uuid[], jsonb, text, text, uuid[])', 'execute')
     or not has_function_privilege('service_role', 'public.app_salvage_cards_guarded(uuid, uuid[], bigint, text, uuid[])', 'execute') then
    raise exception '0061: el servidor no puede llamar a las RPC guardadas';
  end if;
  if (select count(*) from public.craft_recipes where status = 'ACTIVE' and id not like 'forge-%') < 1 then
    raise exception '0061: las recetas F73 deberían seguir ahí';
  end if;
  if exists (select 1 from public.craft_recipes where id like 'forge-%' and status = 'ACTIVE') then
    raise exception '0061: no puede haber recetas de la Forja activas al aplicar (todo nace DRAFT)';
  end if;
end $$;
