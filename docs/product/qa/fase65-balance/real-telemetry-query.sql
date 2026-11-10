-- FASE 65 · TELEMETRÍA REAL DE PARTIDAS (SOLO LECTURA, agregada, sin user_id).
-- Ejecutar en el VPS dentro de una transacción de solo lectura:
--   ssh … 'docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At' < real-telemetry-query.sql
-- Devuelve una fila JSON con los mismos indicadores que simulation-report.json para comparar real frente a simulado.
begin transaction read only;
with m as (
  select coalesce(mode, 'PVE') as mode, difficulty, status,
         state->'result'->'combat'->>'decidedBy'            as decided_by,
         state->'result'->>'winner'                          as winner,
         (state->'result'->'combat'->>'scoreA')::int         as score_a,
         (state->'result'->'combat'->>'scoreB')::int         as score_b,
         (state->'result'->'combat'->>'tiedEncounters')::int as ties,
         state->'turns'->0->>'attacker'                      as first_attacker,
         state->'result'->'combat'->'encounters'             as enc
  from public.duel_matches
  where status in ('COMPLETED', 'DRAW') and state ? 'result'
)
select json_build_object(
  'byMode', (select json_agg(x) from (
      select mode, difficulty, count(*) as n,
             avg(case when winner = 'A' then 1 when winner = 'B' then 0 else 0.5 end) as side_a_score,
             avg(case when status = 'DRAW' then 1 else 0 end)                         as draw_rate,
             avg(case when winner = first_attacker then 1 else 0 end)                 as first_attacker_win,
             avg(case when decided_by = 'OVR_TIEBREAK' then 1 else 0 end)             as ovr_tiebreak_rate,
             avg(case when decided_by = 'STAT_MARGIN' then 1 else 0 end)              as stat_margin_rate,
             avg(case when abs(score_a - score_b) >= 6 then 1 else 0 end)             as stomp_rate,
             avg(ties)                                                                as mean_tied_encounters
      from m group by mode, difficulty order by mode, difficulty) x),
  'attackerWinByStat', (select json_agg(y) from (
      select e->'a'->>'stat' as stat_a, count(*) as n
      from m, jsonb_array_elements(enc) e group by 1 order by 1) y)
);
rollback;
