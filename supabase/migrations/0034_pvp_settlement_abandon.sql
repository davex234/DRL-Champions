-- ============================================================================
-- 0034 — LIQUIDACIÓN DEL ABANDONO (Bloque 7.4.2)
--
-- QUÉ RESUELVE
--   D-PVP-7, heredada del bloque 7.2: «el abandono no acredita al rival». Hasta ahora
--   `duel_pvp_settle_match` devolvía `ABANDONED_NOT_SETTLED` y se lavaba las manos, porque
--   decidir la política del abandono es decidir el juego y no tocaba hacerlo entonces.
--
--   Esta migración NO cambia ni una constante de la matemática del rating. Rating inicial, K
--   provisional, K asentado, `expected_score` y la escala WIN/DRAW/LOSS quedan EXACTAMENTE como
--   las dejó la 0033. Lo único que cambia es CUÁNDO se aplica: el abandono deja de ser un caso
--   sin liquidar y pasa a ser una derrota del que se va.
--
-- ─────────────────────────── LA POLÍTICA, EN UNA FRASE ───────────────────────────
--
--   Abandonar un duelo QUE YA HABÍA EMPEZADO es perderlo. El rival gana.
--
--   Y con todas sus condiciones, porque son ellas las que impiden regalar victorias:
--
--     · Tiene que haber abandono EXPLÍCITO. `closed_reason = 'ABANDONED'` solo lo escribe
--       `abandonPvpMatch`, que es una acción deliberada del jugador contra el endpoint. Cerrar el
--       navegador, perder la conexión o dejar de sondear NO escriben nada: la partida se queda
--       viva y esperando. Una desconexión no es una derrota.
--     · Tiene que constar QUIÉN se fue (`closed_by`). Sin abandono atribuible no hay a quién
--       cargarle la derrota, y se prefiere no liquidar a liquidar a ciegas.
--     · El que se va tiene que ser UNO DE LOS DOS jugadores.
--     · La partida tiene que haber EMPEZADO de verdad: `status = 'IN_PROGRESS'`. Una partida en
--       `WAITING` no llegó a jugarse, así que abandonarla no le da una victoria a nadie.
--
--   «Los dos abandonan a la vez» no puede ocurrir, y no porque se compruebe aquí: el UPDATE de
--   `abandonPvpMatch` va condicionado por `state_version` y por `closed_reason is null`, así que
--   de dos abandonos simultáneos solo uno escribe. El segundo recibe `MATCH_CLOSED`.
--
-- ─────────────────────────── LO QUE SIGUE SIN LIQUIDARSE ───────────────────────────
--
--   `closed_reason = 'EXPIRED'` → `EXPIRED_NOT_SETTLED`. El reloj de turno (D-PVP-6) NO existe:
--   `turn_deadline_at` se escribe y `guardAction` lo respeta, pero NADIE hace vencer una partida,
--   así que hoy ninguna fila llega a `EXPIRED`. Cuando ese bloque exista tendrá que decir quién
--   se quedó sin tiempo —escribiéndolo en `closed_by`, igual que hace el abandono— y entonces
--   esta función podrá tratarlo como una derrota más. Fingirlo ahora sería inventar un perdedor.
--
-- ─────────────────────────── LO QUE ESTA MIGRACIÓN NO TOCA ───────────────────────────
--
--   La tabla `duel_pvp_ratings`, la tabla `duel_pvp_rating_events` (ni una columna nueva: el
--   MOTIVO de una derrota se deriva de `duel_matches.closed_reason`, no hace falta duplicarlo),
--   el emparejamiento, la cola, el motor de combate, las reglas, la economía, `profiles`,
--   Pick'ems y las migraciones 0026–0028.
--
-- REVERSIÓN (conceptual)
--   Restaurar la versión de `duel_pvp_settle_match` de la migración 0033.
-- ============================================================================

/**
 * LIQUIDA una partida PvP terminada — por resultado o por abandono.
 *
 * Reemplaza a la versión de la 0033. Todo lo que ya garantizaba se conserva palabra por palabra:
 * el resultado se LEE de `duel_matches` (nunca llega por parámetro), la idempotencia la impone el
 * índice único `(match_id, user_id)`, y las dos filas de rating se bloquean ordenadas por
 * `user_id` para que dos liquidaciones de partidas con jugadores comunes no se interbloqueen.
 *
 * Lo único que se añade es la rama del abandono.
 *
 * Códigos:
 *   SETTLED · ALREADY_SETTLED · NO_MATCH · NOT_PVP · NOT_FINISHED
 *   EXPIRED_NOT_SETTLED  — venció el reloj; falta el bloque del turn timer (D-PVP-6)
 *   NOT_COMPETITIVE      — se abandonó una partida que no había empezado
 *   NO_ABANDONER         — hay abandono pero no consta quién, o no es de los dos jugadores
 */
create or replace function public.duel_pvp_settle_match(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m         record;
  ra        public.duel_pvp_ratings%rowtype;
  rb        public.duel_pvp_ratings%rowtype;
  score_a   double precision;
  k_a       int;
  k_b       int;
  delta_a   int;
  delta_b   int;
  new_a     int;
  new_b     int;
  res_a     text;
  res_b     text;
  inserted  int;
begin
  select id, mode, status, winner, user_id, player_b_id, closed_reason, closed_by
    into m
    from public.duel_matches
   where id = p_match;

  if not found then             return jsonb_build_object('code', 'NO_MATCH'); end if;
  if m.mode <> 'PVP' then       return jsonb_build_object('code', 'NOT_PVP');  end if;
  if m.player_b_id is null then return jsonb_build_object('code', 'NOT_PVP');  end if;

  -- ── Qué clase de final es, y por tanto qué puntuación le corresponde a A ──
  if m.closed_reason = 'EXPIRED' then
    -- Ver la cabecera: nadie sabe todavía quién se quedó sin tiempo.
    return jsonb_build_object('code', 'EXPIRED_NOT_SETTLED');

  elsif m.closed_reason = 'ABANDONED' then
    if m.closed_by is null or m.closed_by not in (m.user_id, m.player_b_id) then
      return jsonb_build_object('code', 'NO_ABANDONER');
    end if;
    -- Una partida que no llegó a empezar no reparte victoria por abandonarla.
    if m.status <> 'IN_PROGRESS' then
      return jsonb_build_object('code', 'NOT_COMPETITIVE', 'status', m.status);
    end if;
    -- El que se va, pierde. Sin medias tintas y sin penalización extra: la derrota del Elo YA es
    -- la penalización, y añadirle otra sería inventarse una política de castigo que nadie ha
    -- decidido.
    score_a := case when m.closed_by = m.user_id then 0.0 else 1.0 end;

  elsif m.closed_reason is not null then
    -- Motivo de cierre desconocido: no se liquida a ciegas.
    return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);

  elsif m.status = 'DRAW' then
    score_a := 0.5;

  elsif m.status = 'COMPLETED' then
    if m.winner is null or m.winner not in ('A','B') then
      -- COMPLETED sin ganador es un estado incoherente: se marca, no se interpreta.
      return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);
    end if;
    score_a := case when m.winner = 'A' then 1.0 else 0.0 end;

  else
    -- WAITING, IN_PROGRESS y UNRESOLVED. Una partida a medias no vale nada, y `UNRESOLVED` es
    -- inalcanzable con las reglas vigentes: si apareciera sería un fallo interno, y un fallo
    -- interno no reparte rating.
    return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);
  end if;

  res_a := case when score_a = 1.0 then 'WIN' when score_a = 0.0 then 'LOSS' else 'DRAW' end;
  res_b := case when score_a = 1.0 then 'LOSS' when score_a = 0.0 then 'WIN' else 'DRAW' end;

  perform public.duel_pvp_ensure_rating(m.user_id);
  perform public.duel_pvp_ensure_rating(m.player_b_id);

  -- Salida rápida y barata. La garantía real la da el índice único de más abajo.
  if exists (select 1 from public.duel_pvp_rating_events e where e.match_id = p_match) then
    return jsonb_build_object('code', 'ALREADY_SETTLED');
  end if;

  perform 1 from public.duel_pvp_ratings
   where user_id in (m.user_id, m.player_b_id) order by user_id for update;

  select * into ra from public.duel_pvp_ratings where user_id = m.user_id;
  select * into rb from public.duel_pvp_ratings where user_id = m.player_b_id;

  k_a := public.duel_pvp_k_factor(ra.games_played);
  k_b := public.duel_pvp_k_factor(rb.games_played);

  delta_a := round(k_a * (score_a       - public.duel_pvp_expected_score(ra.rating, rb.rating)));
  delta_b := round(k_b * ((1 - score_a) - public.duel_pvp_expected_score(rb.rating, ra.rating)));

  new_a := least(5000, greatest(0, ra.rating + delta_a));
  new_b := least(5000, greatest(0, rb.rating + delta_b));
  delta_a := new_a - ra.rating;
  delta_b := new_b - rb.rating;

  insert into public.duel_pvp_rating_events
    (match_id, user_id, old_rating, delta, new_rating, opponent_rating, k_factor, result)
  values
    (p_match, ra.user_id, ra.rating, delta_a, new_a, rb.rating, k_a, res_a),
    (p_match, rb.user_id, rb.rating, delta_b, new_b, ra.rating, k_b, res_b)
  on conflict (match_id, user_id) do nothing;
  get diagnostics inserted = row_count;

  -- LA PUERTA. Si otra transacción liquidó esta partida mientras tanto, aquí se insertaron 0
  -- filas y NO se toca ni un rating.
  if inserted <> 2 then
    return jsonb_build_object('code', 'ALREADY_SETTLED');
  end if;

  update public.duel_pvp_ratings
     set rating = new_a, games_played = games_played + 1,
         wins   = wins   + (case when res_a = 'WIN'  then 1 else 0 end),
         losses = losses + (case when res_a = 'LOSS' then 1 else 0 end),
         draws  = draws  + (case when res_a = 'DRAW' then 1 else 0 end)
   where user_id = ra.user_id;

  update public.duel_pvp_ratings
     set rating = new_b, games_played = games_played + 1,
         wins   = wins   + (case when res_b = 'WIN'  then 1 else 0 end),
         losses = losses + (case when res_b = 'LOSS' then 1 else 0 end),
         draws  = draws  + (case when res_b = 'DRAW' then 1 else 0 end)
   where user_id = rb.user_id;

  return jsonb_build_object(
    'code', 'SETTLED',
    'matchId', p_match,
    -- Por qué acabó así. Se DERIVA de la fila, no se guarda en el libro: duplicarlo sería un
    -- segundo sitio donde el mismo hecho puede desincronizarse.
    'cause', case when m.closed_reason = 'ABANDONED' then 'ABANDONED' else 'FINISHED' end,
    'a', jsonb_build_object('userId', ra.user_id, 'oldRating', ra.rating, 'delta', delta_a,
                            'newRating', new_a, 'kFactor', k_a, 'result', res_a),
    'b', jsonb_build_object('userId', rb.user_id, 'oldRating', rb.rating, 'delta', delta_b,
                            'newRating', new_b, 'kFactor', k_b, 'result', res_b)
  );
end $$;

-- La función se ha reemplazado: hay que reponerle las concesiones.
revoke all on function public.duel_pvp_settle_match(uuid) from public, anon, authenticated;
grant execute on function public.duel_pvp_settle_match(uuid) to service_role;
