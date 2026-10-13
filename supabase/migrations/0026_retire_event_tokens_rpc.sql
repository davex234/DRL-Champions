-- ============================================================================
-- 0026 · RETIRADA DE LA SEGUNDA MONEDA (1/2) — LA RPC DEJA DE CONCEDER FICHAS
-- ============================================================================
--
-- DRL Cards pasa a tener UNA sola moneda económica: los DRL Credits (`profiles.credits`,
-- libro mayor en `credit_transactions`, única puerta `_ledger_apply`). Las FICHAS DE
-- EVENTO (`profiles.tokens`) se retiran.
--
-- ────────────────────────── POR QUÉ SE RETIRAN ──────────────────────────
--
--   1. **No tenían libro mayor.** `credit_transactions` no registra fichas, así que un
--      saldo de fichas no se podía auditar ni reconstruir. Era una contabilidad paralela
--      sin contabilidad.
--   2. **No tenían suelo.** Mientras `points` se escribía con `greatest(0, …)`, `tokens`
--      se escribía a pelo. Quedó demostrado en la F18.1: una recompensa negativa con una
--      `ref` nueva dejaba el perfil en −5000. Nada en la base lo impedía.
--   3. **Su único sumidero estaba roto.** `unlockPremiumWithTokens` llamaba a
--      `app_adjust_credits(p_credits, p_tokens, …)`, y esa función solo acepta
--      `(p_user, p_delta, p_reason, p_ref)`. PostgREST respondía PGRST202 —«could not find
--      the function»— así que abrir el pase con fichas fallaba SIEMPRE. Se concedían y no
--      se podían gastar.
--   4. **Había dos autoridades con el mismo nombre.** `profiles.tokens` en el servidor y
--      `useEventsStore.tokens` en `localStorage`, alimentadas por el MISMO campo
--      `Reward.tokens`. El mismo jugador veía dos saldos distintos según hubiera iniciado
--      sesión o no.
--
-- ────────────────────────── NO HAY CONVERSIÓN ──────────────────────────
--
-- No se convierte ni una ficha en DRL Credits, y no hace falta: en el momento de esta
-- migración hay 39 perfiles y la suma de `profiles.tokens` es **0**. Nadie tiene ninguna,
-- así que no existe saldo que migrar. Convertir habría sido inventar valor.
--
-- ────────────────────────── QUÉ HACE ESTA MIGRACIÓN, Y QUÉ NO ──────────────────────────
--
-- Aquí se retira la ÚNICA vía de escritura: el parámetro `p_tokens` de `app_grant_reward`.
-- El cuerpo de la función no cambia en nada más — mismos créditos, mismo XP, mismos puntos
-- con su suelo, mismo asiento en el libro mayor, mismos sobres, cartas y cosméticos, misma
-- puerta de idempotencia.
--
-- La COLUMNA `profiles.tokens` **sobrevive a esta migración**. Se retira aparte, en 0027,
-- porque borrarla obliga a reescribir el trigger `SEC-02` en la misma transacción y eso es
-- una operación destructiva que merece su propio fichero y su propia decisión.
--
-- Tras aplicar esto, `profiles.tokens` queda congelada: nada la escribe, nada la lee, y su
-- valor (0 para todo el mundo) no puede volver a moverse.
-- ============================================================================

-- La firma anterior se elimina ANTES de crear la nueva. Dejar las dos convierte la llamada
-- en ambigua para PostgREST cuando se omiten parámetros: es el mismo cuidado que tuvo 0018
-- al sustituir la firma de 0013.
drop function if exists public.app_grant_reward(
  uuid, text, text, bigint, int, bigint, text, int, int, text[], text[]);

create or replace function public.app_grant_reward(
  p_user       uuid,
  p_ref        text,
  p_reason     text,
  p_credits    bigint  default 0,
  p_xp         int     default 0,
  -- Aquí iba `p_tokens bigint default 0`. Retirado en 0026.
  p_pack_id    text    default null,
  p_pack_count int     default 0,
  p_points     int     default 0,
  p_card_ids   text[]  default null,
  p_cosmetics  text[]  default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_card    text;
  v_uid     uuid;
  v_uids    jsonb := '[]'::jsonb;
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

  -- Los puntos NO pueden bajar de cero: un duelo perdido puede restar, pero un jugador
  -- con 10 puntos que pierde cinco duelos se queda en 0, no en negativo.
  update public.profiles
     set credits = v_balance,
         xp      = xp + coalesce(p_xp, 0),
         points  = greatest(0, points + coalesce(p_points, 0))
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

  -- ── Cartas ──
  -- Sin número de serie: una carta de recompensa no consume una tirada serializada.
  -- El origen queda marcado como 'reward' para que el historial de propiedad diga de
  -- dónde salió, que es justo lo que distingue una carta ganada de una comprada.
  if p_card_ids is not null then
    foreach v_card in array p_card_ids loop
      insert into public.user_cards (user_id, card_id, serial, origin)
      values (p_user, v_card, null, 'reward')
      returning uid into v_uid;
      v_uids := v_uids || to_jsonb(v_uid);
    end loop;
  end if;

  -- ── Cosméticos ──
  -- La clave primaria (user_id, cosmetic_id) ya impide tenerlo dos veces; el
  -- `do nothing` deja que una recompensa que repite un cosmético no reviente la
  -- transacción entera por un duplicado.
  if p_cosmetics is not null then
    insert into public.user_cosmetics (user_id, cosmetic_id, source)
    select p_user, c, p_ref from unnest(p_cosmetics) as c
    on conflict (user_id, cosmetic_id) do nothing;
  end if;

  return jsonb_build_object('applied', true, 'credits', v_balance, 'cardUids', v_uids);
end; $$;

revoke all on function public.app_grant_reward(uuid, text, text, bigint, int, text, int, int, text[], text[])
  from public, anon, authenticated;
grant execute on function public.app_grant_reward(uuid, text, text, bigint, int, text, int, int, text[], text[])
  to service_role;

comment on column public.profiles.tokens is
  'RETIRADA (F18.2, migración 0026). Fichas de evento: la segunda moneda. Nada la escribe ni '
  'la lee desde 0026, y su valor es 0 en todos los perfiles. La columna se elimina en 0027. '
  'La única moneda de DRL Cards son los DRL Credits (profiles.credits).';
