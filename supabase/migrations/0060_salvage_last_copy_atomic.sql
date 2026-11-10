-- =====================================================================================================================
-- 0060 · DESGUACE ATÓMICO: «te queda al menos una copia» dentro de la transacción.
--
-- Por qué (auditoría F73, 2026-09-30): `app_salvage_cards` (0019) bloqueaba SOLO los ejemplares elegidos y la regla del
-- desguace —solo duplicados: de cada carta te queda al menos una copia DESBLOQUEADA— se comprobaba en Node, ANTES de
-- la transacción (`previewSalvage` → `salvageableCount = copias − 1`). Desde F73 el intercambio de cartas
-- (`app_craft_card`) también consume copias. Carrera real: tienes X e Y de una carta; el desguace de [X] pasa la
-- comprobación de Node («queda Y»); a la vez un intercambio consume Y (válido en SU transacción: «queda X»); después el
-- desguace borra X → 0 copias. Igual con dos desguaces simultáneos de copias distintas.
--
-- Qué cambia (mínimo, sin tocar economía):
--   · se bloquean TODAS las copias del usuario de las cartas implicadas, con la MISMA forma de consulta que
--     `app_craft_card` (`card_id = any(...) for update`), así que los dos se serializan sobre las mismas filas;
--   · la regla «te queda al menos una copia desbloqueada de cada carta» se comprueba DENTRO de la transacción.
-- Qué NO cambia: firma, importe (lo sigue calculando el servidor), idempotencia por `p_ref`, libro mayor, permisos
-- (solo service_role), valores de desguace, reglas de qué se puede desguazar. Node sigue filtrando antes (misma regla):
-- esto es la autoridad final.
--
-- Rollback: volver al cuerpo de 0019 (`supabase/migrations/0019_economy_ledger.sql`, función app_salvage_cards).
-- =====================================================================================================================
begin;

create or replace function public.app_salvage_cards(p_user uuid, p_uids uuid[], p_total bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int; v_balance bigint; v_prev jsonb; v_cards text[]; v_bad int;
begin
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'Un desguace necesita clave de idempotencia';
  end if;
  if p_total < 0 then raise exception 'Importe inválido'; end if;
  if p_uids is null or array_length(p_uids, 1) is null then
    raise exception 'No hay cartas que desguazar';
  end if;

  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  /*
    0060 · Se bloquean TODAS las copias del usuario de las cartas implicadas (no solo las elegidas), igual que
    `app_craft_card`: un intercambio o un desguace simultáneos sobre copias DISTINTAS de la misma carta esperan aquí.
    Sigue bloqueando antes de contar (0019): dos peticiones no pueden contar las mismas cartas.
  */
  select coalesce(array_agg(distinct card_id), '{}') into v_cards
    from public.user_cards where uid = any(p_uids) and user_id = p_user;
  perform 1 from public.user_cards where user_id = p_user and card_id = any(v_cards) for update;

  select count(*) into v_count from public.user_cards
   where uid = any(p_uids) and user_id = p_user and locked = false;

  if v_count <> array_length(p_uids, 1) then
    raise exception 'Alguna de esas cartas no es tuya o está bloqueada' using errcode = 'P0001';
  end if;

  -- 0060 · la regla del desguace la impone la base de datos: de cada carta queda al menos una copia desbloqueada.
  select count(*) into v_bad from (
    select c.card_id, count(*) filter (where c.locked = false and not (c.uid = any(p_uids))) as kept
      from public.user_cards c where c.user_id = p_user and c.card_id = any(v_cards)
     group by c.card_id) k
   where k.kept < 1;
  if v_bad > 0 then
    raise exception 'LAST_COPY: te quedarías sin ninguna copia de esa carta' using errcode = 'P0001';
  end if;

  delete from public.user_cards where uid = any(p_uids) and user_id = p_user and locked = false;

  v_balance := public._ledger_apply(p_user, p_total, 'salvage', p_ref, 'credit');

  v_prev := jsonb_build_object('credits', v_balance, 'salvaged', v_count, 'paid', p_total);
  insert into public.economy_ops (ref, user_id, kind, result)
  values (p_ref, p_user, 'salvage', v_prev);
  return v_prev;
end; $$;

-- Permisos: los mismos de 0019 (create or replace los conserva; se reafirman).
revoke all on function public.app_salvage_cards(uuid, uuid[], bigint, text) from public, anon, authenticated;
grant execute on function public.app_salvage_cards(uuid, uuid[], bigint, text) to service_role;

-- Guardia final: el cuerpo nuevo está en vigor y sigue sin ser invocable desde el navegador.
do $$ begin
  if (select prosrc from pg_proc where oid = 'public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure) not like '%LAST_COPY%' then
    raise exception '0060: el desguace no tiene la guardia de última copia';
  end if;
  if has_function_privilege('anon', 'public.app_salvage_cards(uuid, uuid[], bigint, text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_salvage_cards(uuid, uuid[], bigint, text)', 'execute') then
    raise exception '0060: el desguace es invocable desde el navegador';
  end if;
end $$;

commit;
