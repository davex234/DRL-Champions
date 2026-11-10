-- =============================================================================
-- ROLLBACK OPERATIVO de 0061_forge_progression (F79 / F79.1)
-- =============================================================================
-- El sistema de migraciones de DRLCards es SOLO HACIA DELANTE (no hay «down»). Esto es el procedimiento operativo,
-- probado en el dry-run de F79.1 contra una copia restaurada de producción.
--
-- ORDEN OBLIGATORIO:
--   1. Desplegar ANTES el código anterior a F79.1 (el de F79.1 llama a app_craft_card_guarded / app_salvage_cards_guarded;
--      sin ellas el intercambio y el desguace responderían 503 «necesita la migración 0061»).
--   2. Guardar el documento de la Forja si existe:  \copy (select * from public.forge_config) to 'forge_config.csv' csv header
--   3. Ejecutar este fichero dentro de BEGIN … COMMIT.
-- No toca datos de jugadores: inventario, libro mayor, misiones y recetas quedan igual. Las filas espejo `forge-…` de
-- craft_recipes (si el panel creó alguna) se dejan DISABLED: sin la Forja nadie puede usarlas.
-- =============================================================================

drop function if exists public.app_craft_card_guarded(uuid, text, uuid[], jsonb, text, text, uuid[]);
drop function if exists public.app_salvage_cards_guarded(uuid, uuid[], bigint, text, uuid[]);
drop function if exists public._card_consume_guard(uuid, uuid[], uuid[]);
drop function if exists public._card_consume_lock(uuid);
update public.craft_recipes set status = 'DISABLED', version = version + 1, updated_at = now()
 where id like 'forge-%' and status = 'ACTIVE';
drop table if exists public.forge_config;

-- app_craft_card: cuerpo EXACTO de 0059 (sección 7b), copiado mecánicamente de supabase/migrations/0059_crafting_missions.sql.
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

  -- Cartas implicadas según Node; se bloquean TODAS las copias del usuario de esas cartas (no solo las entregadas):
  -- así otro crafteo o un desguace simultáneo de otra copia de la misma carta espera, y el recuento de «te queda al
  -- menos una» se hace sobre el estado ya confirmado.
  select array_agg(distinct value) into v_cards from jsonb_each_text(p_expected);
  perform 1 from public.user_cards where user_id = p_user and card_id = any(v_cards) for update;

  select count(*) into v_n from public.user_cards
   where uid = any(p_uids) and user_id = p_user and locked = false
     and card_id = (p_expected ->> uid::text);
  if v_n <> r.input_qty then raise exception 'NOT_ELIGIBLE' using errcode = 'P0001'; end if;

  if exists (select 1 from public.duel_decks d where d.user_id = p_user and d.card_uids && p_uids) then
    raise exception 'IN_DECK' using errcode = 'P0001';
  end if;

  select count(*) into v_bad from (
    select c.card_id,
           count(*) filter (where not (c.uid = any(p_uids))) as kept
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

do $$
begin
  if to_regclass('public.forge_config') is not null then raise exception 'rollback 0061: forge_config sigue ahí'; end if;
  if to_regprocedure('public.app_craft_card_guarded(uuid, text, uuid[], jsonb, text, text, uuid[])') is not null then raise exception 'rollback 0061: sigue la RPC guardada'; end if;
  if (select prosrc from pg_proc where oid = 'public.app_craft_card(uuid, text, uuid[], jsonb, text, text)'::regprocedure) like '%c.locked = false and not (c.uid = any(p_uids))%' then
    raise exception 'rollback 0061: app_craft_card no volvió al cuerpo de 0059';
  end if;
  if (select prosrc from pg_proc where oid = 'public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure) not like '%LAST_COPY%' then
    raise exception 'rollback 0061: el desguace de 0060 debe seguir intacto';
  end if;
end $$;
