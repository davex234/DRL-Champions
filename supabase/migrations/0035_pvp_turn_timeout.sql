-- ============================================================================
-- 0035 — VENCIMIENTO DEL TURNO PvP (Bloque 7.4.3)
--
-- QUÉ RESUELVE
--   D-PVP-6, abierta desde el bloque 7.2: «el reloj se sincroniza y se pinta, pero no vence
--   solo». Hoy `turn_deadline_at` se escribe en cada turno y `guardAction` RECHAZA una acción
--   tardía… y ahí se acaba todo. Si alguien deja de jugar sin pulsar «abandonar», la partida se
--   queda IN_PROGRESS para siempre — y, por la guarda de partida activa del 7.4, deja a los DOS
--   jugadores sin poder volver a entrar en cola. Esta migración le da al servidor la capacidad
--   de cerrarla.
--
-- ─────────────────────────── NO SE INVENTA VOCABULARIO ───────────────────────────
--
--   El encargo sugería un `TURN_TIMEOUT`. **No se crea.** La migración 0031 ya declaró
--   `closed_reason in ('ABANDONED','EXPIRED')` y dejó `EXPIRED` reservado exactamente para esto;
--   `PvpClosedReason` ya lo tiene, `lifecycleOf` ya lo traduce a `EXPIRED` y el bloque 7.4.2 ya
--   devolvía `EXPIRED_NOT_SETTLED` esperando a que existiera este barrido. Añadir un tercer
--   valor con el mismo significado sería justo el duplicado semántico que hay que evitar.
--
--   Y siguen siendo cosas distintas, que es lo que importa:
--     ABANDONED → alguien pulsó «abandonar». Acto deliberado.
--     EXPIRED   → se acabó el tiempo. Hecho del reloj, sin voluntad.
--   El rating trata ambos como derrota del que se fue, pero la CAUSA queda diferenciada en la
--   fila para siempre.
--
-- ─────────────────────────── DÓNDE ESTÁ LA AUTORIDAD TEMPORAL ───────────────────────────
--
--   En PostgreSQL, y solo ahí. Ninguna de estas funciones acepta una marca de tiempo por
--   parámetro: todas comparan contra `now()`. El servidor de Next no puede decir «ya venció», y
--   el navegador mucho menos. Eso es lo que hace que la carrera del caso crítico
--
--       acción a las 11:59:59.999   vs   barrido a las 12:00:00.001
--
--   la resuelva la base de datos y no dos relojes que pueden ir desincronizados: el cierre va
--   condicionado a la vez por `state_version` (¿alguien escribió antes que yo?) y por
--   `turn_deadline_at <= now()` (¿de verdad ha vencido, según el reloj que manda?).
--
-- ─────────────────────────── POR QUÉ EL PERDEDOR NO SE CALCULA AQUÍ ───────────────────────────
--
--   Quién debía actuar lo decide `actingSide()`, que deriva el bando de `status`, `attacker` y
--   `phase` del motor. Reimplementar eso en SQL sería un segundo motor de duelo — exactamente lo
--   que el proyecto lleva cuatro bloques evitando. Así que el reparto es:
--
--       TypeScript  decide QUIÉN perdió   (reutilizando `expectedPlayer`, sin reimplementar nada)
--       PostgreSQL  decide SI se cierra   (y por tanto quién gana la carrera)
--
--   El id del perdedor entra por parámetro, pero eso NO es confiar en el cliente: lo calcula el
--   servidor a partir de la fila que acaba de leer, y aunque llegara equivocado, la función exige
--   que sea uno de los dos jugadores de esa partida. No hay ningún camino público que llegue aquí.
--
-- ─────────────────────────── LO QUE NO TOCA ───────────────────────────
--
--   La duración del turno (`PVP_TURN_MS = 90 s`, del bloque 7.2, se REUTILIZA sin cambiarla), la
--   matemática del Elo, las reglas de combate, el emparejamiento, la economía, `profiles`,
--   Pick'ems y las migraciones 0026–0028.
--
-- REVERSIÓN (conceptual)
--   drop function if exists public.duel_pvp_expire_turn, public.duel_pvp_expired_candidates;
--   drop index if exists public.duel_matches_pvp_live_deadline_idx;
--   restaurar `duel_pvp_settle_match` de la migración 0034.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL ÍNDICE — por qué el de la 0031 no bastaba
-- ----------------------------------------------------------------------------
--
-- La 0031 creó `duel_matches_pvp_deadline_idx (turn_deadline_at) where mode='PVP' and
-- closed_reason is null`, pensando en este bloque. Pero le falta una condición y la diferencia
-- crece con el tiempo:
--
--   Una partida TERMINADA con normalidad (`status='COMPLETED'`) **no tiene `closed_reason`** —el
--   cierre por motivo es solo para abandono y vencimiento— y conserva su `turn_deadline_at` en el
--   pasado. Es decir: cada partida jugada y acabada entra en aquel índice y se queda ahí para
--   siempre, con una fecha que siempre cumple `<= now()`. El barrido las leería todas para
--   descartarlas después por `status`.
--
-- Este índice añade `status='IN_PROGRESS'`, así que solo contiene partidas VIVAS. Es un índice
-- que se mantiene pequeño por definición: una fila entra cuando empieza la partida y sale cuando
-- termina.
create index if not exists duel_matches_pvp_live_deadline_idx
  on public.duel_matches (turn_deadline_at)
  where mode = 'PVP' and closed_reason is null and status = 'IN_PROGRESS';

-- ----------------------------------------------------------------------------
-- 2. CANDIDATOS — qué partidas han vencido, según el reloj del servidor
-- ----------------------------------------------------------------------------
--
-- Devuelve la fila COMPLETA (incluido `state`) porque quien llama necesita el estado de juego
-- para preguntarle al motor a quién le tocaba. Es caro por fila, pero el conjunto está acotado
-- por `p_limit` y, sobre todo, **normalmente está vacío**: una partida solo aparece aquí si de
-- verdad alguien dejó de jugar.
--
-- `now()` no es un parámetro: es el reloj de la base de datos. No hay forma de pedirle a esta
-- función que finja otra hora.
create or replace function public.duel_pvp_expired_candidates(p_limit int default 20)
returns setof public.duel_matches
language sql stable security definer set search_path = public as $$
  select *
    from public.duel_matches m
   where m.mode = 'PVP'
     and m.closed_reason is null
     and m.status = 'IN_PROGRESS'
     and m.turn_deadline_at is not null
     and m.turn_deadline_at <= now()
   order by m.turn_deadline_at
   limit greatest(p_limit, 1);
$$;

-- ----------------------------------------------------------------------------
-- 3. EL CIERRE — atómico, y con la base de datos arbitrando la carrera
-- ----------------------------------------------------------------------------
--
-- Un solo `UPDATE` condicionado. Las cuatro condiciones del `WHERE` son las cuatro formas de
-- perder la carrera, y las evalúa Postgres en la misma sentencia:
--
--   state_version = p_version   → nadie ha escrito desde que se leyó la fila. Si el jugador metió
--                                 su acción a las 11:59:59.999, la versión ya cambió y este
--                                 UPDATE afecta a CERO filas: **gana la acción**.
--   closed_reason is null       → no se cierra dos veces, ni se pisa un abandono simultáneo.
--   status = 'IN_PROGRESS'      → no se vence una partida que ya terminó por reglas.
--   turn_deadline_at <= now()   → **la comprobación temporal la hace la base de datos**. Aunque
--                                 quien llama creyera que ha vencido, si para Postgres no ha
--                                 vencido, no se cierra.
--
-- No hay `SELECT` previo del que fiarse: leer y decidir en dos pasos es justo la carrera que hay
-- que eliminar.
--
-- Códigos: EXPIRED · NOT_DUE (aún no vencía) · LOST_RACE (otro escribió antes) · NOT_A_PLAYER
create or replace function public.duel_pvp_expire_turn(
  p_match uuid, p_version int, p_loser uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- El perdedor tiene que ser uno de los dos. Aunque lo calcula el servidor, se comprueba: una
  -- partida no puede cerrarse cargándosela a alguien que no juega.
  if not exists (
    select 1 from public.duel_matches m
     where m.id = p_match and m.mode = 'PVP'
       and p_loser is not null and p_loser in (m.user_id, m.player_b_id)
  ) then
    return jsonb_build_object('code', 'NOT_A_PLAYER');
  end if;

  update public.duel_matches
     set closed_reason = 'EXPIRED',
         closed_by     = p_loser,      -- quien se quedó sin tiempo. Es el que pierde.
         closed_at     = now(),
         state_version = state_version + 1
   where id = p_match
     and state_version = p_version
     and closed_reason is null
     and mode = 'PVP'
     and status = 'IN_PROGRESS'
     and turn_deadline_at is not null
     and turn_deadline_at <= now()
   returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('code', 'EXPIRED', 'matchId', v_id, 'loser', p_loser);
  end if;

  -- No se cerró. Se distingue «todavía no tocaba» de «alguien llegó antes» porque significan
  -- cosas distintas para quien llama: lo primero es normal, lo segundo también, pero solo lo
  -- primero indica que hay que volver a mirar más tarde.
  if exists (
    select 1 from public.duel_matches m
     where m.id = p_match and m.closed_reason is null and m.status = 'IN_PROGRESS'
       and (m.turn_deadline_at is null or m.turn_deadline_at > now())
  ) then
    return jsonb_build_object('code', 'NOT_DUE');
  end if;

  return jsonb_build_object('code', 'LOST_RACE');
end $$;

-- ----------------------------------------------------------------------------
-- 4. LIQUIDACIÓN — el vencimiento entra por la MISMA puerta que todo lo demás
-- ----------------------------------------------------------------------------
--
-- Se reemplaza `duel_pvp_settle_match` de la 0034 para que `EXPIRED` deje de devolver
-- `EXPIRED_NOT_SETTLED` y pase a liquidarse igual que un abandono: el que consta en `closed_by`
-- pierde, el otro gana.
--
-- **No se duplica ni una línea de Elo.** Es exactamente la misma función, el mismo `expected_score`,
-- la misma K, la misma escala y el mismo libro con la misma clave de idempotencia. Lo único que
-- cambia es que una rama que antes se rendía ahora sabe qué hacer.
--
-- Códigos: SETTLED · ALREADY_SETTLED · NO_MATCH · NOT_PVP · NOT_FINISHED · NOT_COMPETITIVE ·
--          NO_ABANDONER (no consta quién perdió, ni en abandono ni en vencimiento)
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
  if m.closed_reason in ('ABANDONED', 'EXPIRED') then
    -- Los dos cierres se liquidan IGUAL porque significan lo mismo para el resultado: uno de los
    -- dos dejó de jugar. `closed_by` dice cuál, lo pusiera el abandono o el barrido del reloj.
    if m.closed_by is null or m.closed_by not in (m.user_id, m.player_b_id) then
      return jsonb_build_object('code', 'NO_ABANDONER');
    end if;
    if m.status <> 'IN_PROGRESS' then
      return jsonb_build_object('code', 'NOT_COMPETITIVE', 'status', m.status);
    end if;
    score_a := case when m.closed_by = m.user_id then 0.0 else 1.0 end;

  elsif m.closed_reason is not null then
    return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);

  elsif m.status = 'DRAW' then
    score_a := 0.5;

  elsif m.status = 'COMPLETED' then
    if m.winner is null or m.winner not in ('A','B') then
      return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);
    end if;
    score_a := case when m.winner = 'A' then 1.0 else 0.0 end;

  else
    return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);
  end if;

  res_a := case when score_a = 1.0 then 'WIN' when score_a = 0.0 then 'LOSS' else 'DRAW' end;
  res_b := case when score_a = 1.0 then 'LOSS' when score_a = 0.0 then 'WIN' else 'DRAW' end;

  perform public.duel_pvp_ensure_rating(m.user_id);
  perform public.duel_pvp_ensure_rating(m.player_b_id);

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
    -- La CAUSA se deriva de la fila, no se guarda en el libro. Un abandono y un vencimiento
    -- producen el mismo movimiento de rating, pero no son lo mismo y la fila lo recuerda.
    'cause', coalesce(m.closed_reason, 'FINISHED'),
    'a', jsonb_build_object('userId', ra.user_id, 'oldRating', ra.rating, 'delta', delta_a,
                            'newRating', new_a, 'kFactor', k_a, 'result', res_a),
    'b', jsonb_build_object('userId', rb.user_id, 'oldRating', rb.rating, 'delta', delta_b,
                            'newRating', new_b, 'kFactor', k_b, 'result', res_b)
  );
end $$;

-- ----------------------------------------------------------------------------
-- 5. CONCESIONES — solo el servidor
-- ----------------------------------------------------------------------------
--
-- Ninguna de estas funciones se concede a `anon` ni a `authenticated`. No existe ningún camino
-- por el que un cliente pueda pedir «vence esta partida»: ni eligiendo el `matchId`, ni el
-- instante, ni el perdedor.
do $mig$
declare f text;
begin
  foreach f in array array[
    'duel_pvp_expired_candidates(int)', 'duel_pvp_expire_turn(uuid,int,uuid)',
    'duel_pvp_settle_match(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$mig$;
