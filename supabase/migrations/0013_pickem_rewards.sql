-- ============================================================================
-- FASE B · CONCESIÓN DE RECOMPENSAS EN UNA SOLA TRANSACCIÓN (bloque H)
--
-- POR QUÉ
--   Repartir una recompensa toca cuatro cosas (créditos, XP, tokens y sobres).
--   Hacerlo con cuatro llamadas desde Node no es atómico y obliga a deducir la
--   idempotencia leyendo el libro mayor, que es frágil: si el proceso muere entre
--   la segunda y la tercera llamada, el usuario se queda con media recompensa.
--
--   Esta RPC lo hace todo dentro de una transacción y decide la idempotencia con
--   un ÚNICO criterio: si ya existe un asiento con esa `ref`, no hace nada y
--   devuelve `applied: false`.
-- ============================================================================

create or replace function public.app_grant_reward(
  p_user       uuid,
  p_ref        text,
  p_reason     text,
  p_credits    bigint default 0,
  p_xp         int    default 0,
  p_tokens     bigint default 0,
  p_pack_id    text   default null,
  p_pack_count int    default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'La recompensa necesita una clave de idempotencia';
  end if;

  -- Puerta de idempotencia: una sola comprobación para TODA la recompensa.
  if exists (select 1 from public.credit_transactions where user_id = p_user and ref = p_ref) then
    select credits into v_balance from public.profiles where id = p_user;
    return jsonb_build_object('applied', false, 'credits', v_balance);
  end if;

  select credits into v_balance from public.profiles where id = p_user for update;
  if v_balance is null then raise exception 'Perfil inexistente'; end if;

  v_balance := v_balance + coalesce(p_credits, 0);
  update public.profiles
     set credits = v_balance,
         xp      = xp + coalesce(p_xp, 0),
         tokens  = tokens + coalesce(p_tokens, 0)
   where id = p_user;

  -- El asiento se escribe SIEMPRE (aunque p_credits sea 0): es lo que marca la
  -- recompensa como concedida y hace idempotente al conjunto.
  insert into public.credit_transactions (user_id, delta, reason, ref, balance_after)
  values (p_user, coalesce(p_credits, 0), p_reason, p_ref, v_balance);

  if p_pack_id is not null and coalesce(p_pack_count, 0) > 0 then
    insert into public.user_packs (user_id, pack_id, qty)
    values (p_user, p_pack_id, p_pack_count)
    on conflict (user_id, pack_id) do update
      set qty = public.user_packs.qty + excluded.qty;
  end if;

  return jsonb_build_object('applied', true, 'credits', v_balance);
end; $$;

revoke all on function public.app_grant_reward(uuid, text, text, bigint, int, bigint, text, int)
  from public, anon, authenticated;
grant execute on function public.app_grant_reward(uuid, text, text, bigint, int, bigint, text, int)
  to service_role;
