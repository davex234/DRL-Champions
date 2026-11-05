-- ============================================================================================================
-- 0073 · F87.2 — PICK'EMS LAUNCH GUARD: elegibilidad de cuenta para COBRAR, política congelada con las recompensas
-- y puerta de tiempo en la BD.
--
-- Sobre 0071 (Pick'ems 2.0) y 0072 (corte de autoridad legacy). No reescribe ninguna función de 0071; sustituye las
-- dos guardias de 0072 por versiones que conservan TODO lo que comprobaban y añaden lo nuevo.
--
--   1. ELEGIBILIDAD (`reward-eligibility-v1`): para COBRAR un premio de Pick'ems 2.0 la cuenta debe, en el PRIMER
--      CIERRE del ámbito, tener ≥ 7 días y ≥ 3 partidas completadas/empatadas en PVE, DRAFT_GAUNTLET o PVP (ranked).
--      PVP_PRIVATE no cuenta. Señales solo del servidor: `auth.users.created_at` y `duel_matches`. Predecir, puntuar
--      y salir en la clasificación NO lo exigen: solo el reclamo. El escalón (rendimiento) nunca se toca.
--   2. La política vive en `pickem_brackets.rewards->>'eligibilityPolicy'`: se versiona, se firma (checksum) y se
--      congela con las recompensas. Activar exige una política CONOCIDA. Desconocida o ausente → nadie cobra.
--   3. PUERTA DE TIEMPO: no se activan recompensas, ni se cambian unas ACTIVAS, si el primer cierre ya pasó o algún
--      partido del ámbito ya empezó. Desactivar (ACTIVE → OFF/DRAFT) sí se permite: solo reduce el pasivo.
--   4. Todo lo de 0072 se mantiene: autoridad legacy por evento, reglas v1 exactas, sin Pick'ems legacy nuevos.
--
-- Rollback: docs/operations/rollback/0073_pickems_launch_guard.ROLLBACK.sql (devuelve las guardias EXACTAS de 0072;
-- no reabre la creación de legacy).
-- ============================================================================================================

-- ── 1. registro de políticas (una sola fuente en la BD; espejo en domain/pickems/eligibility.ts) ──────────────
create or replace function public._pickem_eligibility_policy(p_id text)
returns jsonb language sql immutable as $$
  select case p_id
    when 'reward-eligibility-v1' then jsonb_build_object(
      'id', 'reward-eligibility-v1', 'minAccountAgeDays', 7, 'minCompletedMatches', 3,
      'countedModes', jsonb_build_array('PVE', 'DRAFT_GAUNTLET', 'PVP'), 'countedStatuses', jsonb_build_array('COMPLETED', 'DRAW'))
    else null end;
$$;

-- ── 2. primer cierre del ámbito y «¿ya empezó algo?» ─────────────────────────────────────────────────────────
-- Publicado: los cierres reales de `pickem_bracket_matches` (misma expresión que `pickem_match_locked`).
-- Borrador: la hora real de los partidos del descriptor.
create or replace function public._pickem_first_lock(p_bracket uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(case when bm.lock_override_at is not null then least(bm.lock_override_at, m.start_time)
                     else least(bm.lock_at, m.start_time) end)
       from public.pickem_bracket_matches bm left join public.matches m on m.id = bm.match_id
      where bm.bracket_id = p_bracket and bm.voided_at is null),
    (select min(m.start_time)
       from public.pickem_brackets b
       cross join lateral jsonb_array_elements(coalesce(b.descriptor->'nodes', '[]'::jsonb)) n
       join public.matches m on m.id = n->>'matchId'
      where b.id = p_bracket));
$$;

create or replace function public._pickem_window_closed(p_bracket uuid, p_at timestamptz default now())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public._pickem_first_lock(p_bracket) <= p_at, true)
      or exists (select 1 from public.pickem_brackets b
                  cross join lateral jsonb_array_elements(coalesce(b.descriptor->'nodes', '[]'::jsonb)) n
                  join public.matches m on m.id = n->>'matchId'
                 where b.id = p_bracket and lower(coalesce(m.status, 'upcoming')) <> 'upcoming');
$$;

-- ── 3. elegibilidad (autoridad) ──────────────────────────────────────────────────────────────────────────────
-- Se evalúa en el primer cierre: antigüedad en ese instante y partidas terminadas antes de min(primer cierre, ahora).
-- Antes del cierre es la vista previa (lo que el jugador ya puede saber); después, definitiva e inmutable.
create or replace function public.app_pickem_reward_eligibility(p_user uuid, p_bracket uuid, p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_policy_id text; v_p jsonb; v_ref timestamptz; v_created timestamptz; v_n int; v_age_ok boolean; v_m_ok boolean; v_code text;
begin
  select rewards->>'eligibilityPolicy' into v_policy_id from public.pickem_brackets where id = p_bracket;
  v_p := public._pickem_eligibility_policy(v_policy_id);
  if v_p is null then
    return jsonb_build_object('eligible', false, 'code', 'POLICY_MISSING', 'policy', v_policy_id);
  end if;
  v_ref := public._pickem_first_lock(p_bracket);
  if v_ref is null then
    return jsonb_build_object('eligible', false, 'code', 'NO_REFERENCE', 'policy', v_p->>'id');
  end if;
  select created_at into v_created from auth.users where id = p_user;
  if v_created is null then
    return jsonb_build_object('eligible', false, 'code', 'NO_ACCOUNT', 'policy', v_p->>'id', 'referenceAt', v_ref, 'final', p_at >= v_ref);
  end if;
  select count(*) into v_n from public.duel_matches d
   where (d.user_id = p_user or d.player_b_id = p_user)
     and d.mode in (select jsonb_array_elements_text(v_p->'countedModes'))
     and d.status in (select jsonb_array_elements_text(v_p->'countedStatuses'))
     and coalesce(d.closed_at, d.updated_at) < least(v_ref, p_at);
  v_age_ok := v_created + make_interval(days => (v_p->>'minAccountAgeDays')::int) <= v_ref;
  v_m_ok := v_n >= (v_p->>'minCompletedMatches')::int;
  v_code := case when v_age_ok and v_m_ok then 'ELIGIBLE'
                 when not v_age_ok and not v_m_ok then 'ACCOUNT_TOO_NEW_AND_NOT_ENOUGH_MATCHES'
                 when not v_age_ok then 'ACCOUNT_TOO_NEW' else 'NOT_ENOUGH_MATCHES' end;
  return jsonb_build_object('eligible', v_code = 'ELIGIBLE', 'code', v_code, 'policy', v_p->>'id', 'referenceAt', v_ref,
    'ageOkFrom', v_created + make_interval(days => (v_p->>'minAccountAgeDays')::int), 'matches', v_n,
    'matchesRequired', (v_p->>'minCompletedMatches')::int, 'final', p_at >= v_ref);
end; $$;

-- Resumen para el panel: recuentos por código, sin datos personales.
create or replace function public.app_pickem_eligibility_summary(p_bracket uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(code, n), '{}'::jsonb)
    from (select public.app_pickem_reward_eligibility(e.user_id, p_bracket)->>'code' as code, count(*) as n
            from public.pickem_bracket_entries e where e.bracket_id = p_bracket group by 1) s;
$$;

-- ── 4. guardia de recompensas de los ámbitos (sustituye a la de 0072 conservando todo) ─────────────────────────
create or replace function public._pickem_brackets_rewards_guard()
returns trigger language plpgsql as $$
begin
  -- Activar es SIEMPRE un paso aparte sobre un ámbito existente (nunca se nace con recompensas activas).
  if tg_op = 'INSERT' and new.rewards_status = 'ACTIVE' then
    raise exception 'PICKEM_REWARDS_TOO_LATE: un Pick''em no puede nacer con recompensas activas' using errcode = 'P0001';
  end if;
  -- Congelación: unas recompensas ACTIVAS no cambian una vez cerrado el primer partido o empezado alguno.
  -- Desactivarlas (dejar de prometer) sí: solo reduce el pasivo.
  if tg_op = 'UPDATE' and old.rewards_status = 'ACTIVE' and new.rewards_status = 'ACTIVE'
     and new.rewards is distinct from old.rewards and public._pickem_window_closed(new.id) then
    raise exception 'PICKEM_REWARDS_FROZEN: las recompensas de este Pick''em ya están congeladas' using errcode = 'P0001';
  end if;
  if new.rewards_status = 'ACTIVE' and (tg_op = 'INSERT' or old.rewards_status is distinct from 'ACTIVE' or new.rewards is distinct from old.rewards) then
    if public._pickem_event_has_legacy_authority(new.event_id) then
      raise exception 'PICKEM_LEGACY_AUTHORITY: este evento tiene un Pick''em clásico con recompensas propias; Pick''ems 2.0 no puede premiarlo' using errcode = 'P0001';
    end if;
    if not public._pickem_rules_v1_ok(new.rewards, new.slug) then
      raise exception 'PICKEM_RULES_NOT_APPROVED: solo se activan las reglas v1 aprobadas' using errcode = 'P0001';
    end if;
    if public._pickem_eligibility_policy(new.rewards->>'eligibilityPolicy') is null then
      raise exception 'PICKEM_ELIGIBILITY_POLICY_REQUIRED: activar exige una política de elegibilidad conocida' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and public._pickem_window_closed(new.id) then
      raise exception 'PICKEM_REWARDS_TOO_LATE: el primer cierre ya pasó o un partido ya empezó' using errcode = 'P0001';
    end if;
  end if;
  return new;
end; $$;

-- ── 5. guardia del reclamo (sustituye a la de 0072 conservando la autoridad legacy) ───────────────────────────
create or replace function public._pickem_claims_authority_guard()
returns trigger language plpgsql as $$
declare v_e jsonb;
begin
  if public._pickem_event_has_legacy_authority((select event_id from public.pickem_brackets where id = new.bracket_id)) then
    raise exception 'PICKEM_LEGACY_AUTHORITY: este evento se premia por el Pick''em clásico' using errcode = 'P0001';
  end if;
  v_e := public.app_pickem_reward_eligibility(new.user_id, new.bracket_id, now());
  if not coalesce((v_e->>'eligible')::boolean, false) then
    raise exception 'PICKEM_REWARD_INELIGIBLE: %', coalesce(v_e->>'code', 'UNKNOWN') using errcode = 'P0001';
  end if;
  return new;
end; $$;

revoke all on function public._pickem_eligibility_policy(text) from public, anon, authenticated;
revoke all on function public._pickem_first_lock(uuid) from public, anon, authenticated;
revoke all on function public._pickem_window_closed(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.app_pickem_reward_eligibility(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.app_pickem_eligibility_summary(uuid) from public, anon, authenticated;
grant execute on function public._pickem_eligibility_policy(text) to service_role;
grant execute on function public._pickem_first_lock(uuid) to service_role;
grant execute on function public._pickem_window_closed(uuid, timestamptz) to service_role;
grant execute on function public.app_pickem_reward_eligibility(uuid, uuid, timestamptz) to service_role;
grant execute on function public.app_pickem_eligibility_summary(uuid) to service_role;

-- ── guardia final ──────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('pickem_events_legacy_guard', 'pickem_submissions_legacy_guard',
      'credit_tx_pickem_legacy_guard', 'pickem_brackets_rewards_guard', 'pickem_claims_authority_guard')) <> 5 then
    raise exception '0073: faltan los disparadores de 0072';
  end if;
  foreach f in array array['public._pickem_eligibility_policy(text)', 'public._pickem_first_lock(uuid)', 'public._pickem_window_closed(uuid, timestamptz)',
                           'public.app_pickem_reward_eligibility(uuid, uuid, timestamptz)', 'public.app_pickem_eligibility_summary(uuid)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0073: un rol de cliente puede ejecutar %', f;
    end if;
  end loop;
  if public._pickem_eligibility_policy('reward-eligibility-v1') is null or public._pickem_eligibility_policy('x') is not null then
    raise exception '0073: registro de políticas incorrecto';
  end if;
end $$;
