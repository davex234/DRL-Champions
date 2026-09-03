-- ============================================================================
-- FASE 10 · EL CICLO DE JUEGO — UNA SOLA RUTA DE RECOMPENSA
--
-- QUÉ PROBLEMA RESUELVE
--
--   La auditoría de la Fase 10 encontró que `Reward` (domain/events/types) declara
--   SIETE campos —créditos, XP, fichas, sobres, CARTAS, cosméticos y materiales— pero
--   la única RPC que concede recompensas, `app_grant_reward` (0013), solo sabía entregar
--   CUATRO. El resto se repartía por fuera:
--
--     · los COSMÉTICOS los escribía `server/services/progression.ts` con un `upsert`
--       aparte, DESPUÉS de la RPC y fuera de su transacción. Si esa segunda escritura
--       fallaba, el jugador se quedaba con los créditos y sin el cosmético, y la puerta
--       de idempotencia ya estaba cerrada: al reintentar no se le daba nada.
--     · las CARTAS no se concedían nunca como recompensa. `data/season.ts` lo dice
--       explícitamente de los materiales; con `cardId` pasaba lo mismo y sin decirlo.
--     · los PUNTOS COMPETITIVOS no eran una recompensa en absoluto: solo los movía
--       `app_score_pickem_event`. Un duelo ganado no podía dar puntos aunque quisiéramos.
--
--   El encargo de la Fase 10 lo pide con estas palabras: «no duplicar lógica de rewards
--   en múltiples rutas; crear un sistema central si actualmente hay lógica dispersa».
--   Esto es ese sistema central, en el sitio donde tiene que estar: dentro de la
--   transacción.
--
-- QUÉ CAMBIA
--
--   `app_grant_reward` pasa a conceder, en UNA transacción y bajo UNA clave de
--   idempotencia: créditos · XP · fichas · sobres · PUNTOS · CARTAS · COSMÉTICOS.
--
--   La firma antigua se sustituye por otra con los tres parámetros nuevos AL FINAL y
--   con valor por defecto. Todas las llamadas existentes usan argumentos con nombre y
--   omiten los nuevos, así que siguen funcionando exactamente igual.
--
-- QUÉ NO CAMBIA
--
--   · La puerta de idempotencia sigue siendo la misma y la única: un asiento en
--     `credit_transactions` con esa `ref`.
--   · `app_score_pickem_event` sigue siendo el corrector de Pick'ems y sigue ajustando
--     `profiles.points` POR DIFERENCIA (0012). Por eso los puntos que conceda esta RPC
--     —los de un duelo, por ejemplo— SOBREVIVEN a una recorrección: el corrector suma o
--     resta su propio delta, no sobrescribe el total.
--   · `profiles.points` sigue cerrado al cliente por el trigger guardián de 0012.
--   · Ninguna RPC nueva es invocable desde el navegador.
--
-- LOS MATERIALES SIGUEN FUERA, Y A PROPÓSITO
--   `Reward.materials` (polvo de crafteo) solo existe en el store local: no hay tabla
--   ni columna donde guardarlos. Conceder algo que el servidor no sabe almacenar es
--   repartir una recompensa que desaparece en la siguiente sincronización. Cuando exista
--   esa tabla, se añade aquí y en ningún otro sitio.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LA RUTA ÚNICA
-- ----------------------------------------------------------------------------

-- Se elimina la firma anterior antes de crear la nueva: dejar las dos convierte la
-- llamada en ambigua para PostgREST cuando se omiten los parámetros nuevos.
drop function if exists public.app_grant_reward(uuid, text, text, bigint, int, bigint, text, int);

create or replace function public.app_grant_reward(
  p_user       uuid,
  p_ref        text,
  p_reason     text,
  p_credits    bigint  default 0,
  p_xp         int     default 0,
  p_tokens     bigint  default 0,
  p_pack_id    text    default null,
  p_pack_count int     default 0,
  -- ── Fase 10 ──
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
         tokens  = tokens + coalesce(p_tokens, 0),
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

revoke all on function public.app_grant_reward(uuid, text, text, bigint, int, bigint, text, int, int, text[], text[])
  from public, anon, authenticated;
grant execute on function public.app_grant_reward(uuid, text, text, bigint, int, bigint, text, int, int, text[], text[])
  to service_role;

-- ----------------------------------------------------------------------------
-- 2. ÍNDICE PARA EL RESUMEN DE UNA PARTIDA
-- ----------------------------------------------------------------------------
-- El ciclo de juego necesita responder «¿qué me ha dado este duelo?» y «¿cuántos
-- duelos he ganado esta semana?» sin abrir un jsonb por partida. `duel_matches` ya
-- tiene el índice (user_id, status, winner) de 0016; falta poder ordenar por fecha
-- para el historial reciente, que es lo que lee el panel de progreso.
create index if not exists duel_matches_user_recent_idx
  on public.duel_matches (user_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- 3. PREGUNTAS DE PICK'EM GENERADAS DESDE PARTIDOS REALES
-- ----------------------------------------------------------------------------
-- Una pregunta de tipo `match_winner` pertenece a UN partido. Sin esta restricción,
-- ejecutar dos veces el generador crea dos preguntas idénticas para el mismo partido
-- y el jugador ve la misma predicción repetida.
--
-- NO es un índice parcial, y el motivo es práctico: `ON CONFLICT (cols)` no puede usar un
-- índice parcial a menos que la propia sentencia repita su predicado, y el cliente de
-- Supabase no sabe expresar eso. Un índice único normal sirve igual porque en PostgreSQL
-- **dos NULL no colisionan entre sí**: las preguntas que no cuelgan de un partido
-- concreto (`champion`, `advance`) tienen `match_id` nulo y pueden ser tantas como haga
-- falta, exactamente como antes.
create unique index if not exists pickem_questions_match_uniq
  on public.pickem_questions (pickem_event_id, match_id);
