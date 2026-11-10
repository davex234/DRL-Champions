-- ============================================================================================================
-- ROLLBACK OPERATIVO de 0065 (F84 · Ranked 2.0). Ejecutar SOLO tras desplegar antes el código anterior a F84
-- (drl-0.1.1-1-22c509c6): esa app no usa nada de 0065 y su liquidación es la de 0035, que este fichero restaura.
--
-- PIERDE DATOS de F84: temporadas competitivas, récord por temporada, fotos, ajustes y las columnas que F84 añadió al
-- libro (temporada, número de partida, versión de fórmula, regla). Los RATINGS y los asientos (old/delta/new) NO se
-- pierden: siguen en duel_pvp_ratings y duel_pvp_rating_events. Antes: backup (pre-0065) y exportar si se quieren conservar.
-- ============================================================================================================
begin;
drop view if exists public.competitive_ladder;
drop view if exists public.competitive_rating_ledger;
drop function if exists public.competitive_rating_correct(uuid, int, text, uuid, text);
drop function if exists public.competitive_season_seed(text);
drop function if exists public.competitive_season_close(text);

-- La liquidación vuelve EXACTAMENTE a la de 0035 (copiada de esa migración) antes de quitar las columnas que usa F84.
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
revoke all on function public.duel_pvp_settle_match(uuid) from public, anon, authenticated;
grant execute on function public.duel_pvp_settle_match(uuid) to service_role;
drop function if exists public._competitive_season_record(public.competitive_seasons, uuid, int, int, text, int);
drop function if exists public.competitive_active_season();
drop trigger if exists trg_duel_pvp_ratings_guard on public.duel_pvp_ratings;
drop function if exists public._duel_pvp_ratings_guard();
drop table if exists public.competitive_season_snapshots;
drop table if exists public.competitive_rating_adjustments;
drop table if exists public.competitive_season_players;
drop trigger if exists trg_duel_pvp_rating_events_immutable on public.duel_pvp_rating_events;
drop function if exists public._duel_pvp_rating_events_immutable();
drop index if exists public.duel_pvp_rating_events_season_seq;
alter table public.duel_pvp_rating_events drop constraint if exists duel_pvp_rating_events_pair_cap;
alter table public.duel_pvp_rating_events drop constraint if exists duel_pvp_rating_events_season_shape;
alter table public.duel_pvp_rating_events drop constraint if exists duel_pvp_rating_events_rule;
alter table public.duel_pvp_rating_events drop column if exists rule;
alter table public.duel_pvp_rating_events drop column if exists season_match_number;
alter table public.duel_pvp_rating_events drop column if exists competitive_season_id;
alter table public.duel_pvp_rating_events drop column if exists formula_version;
drop trigger if exists trg_competitive_seasons_guard on public.competitive_seasons;
drop trigger if exists trg_competitive_seasons_insert_guard on public.competitive_seasons;
drop table if exists public.competitive_seasons;
drop function if exists public._competitive_seasons_guard();
drop function if exists public._competitive_seasons_insert_guard();
commit;
