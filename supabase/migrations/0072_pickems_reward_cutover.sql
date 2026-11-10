-- ============================================================================================================
-- 0072 · F87.1 — CORTE DE AUTORIDAD DE RECOMPENSAS DE PICK'EMS: LEGACY (0012/0018) → PICK'EMS 2.0 (0071).
--
-- Hallazgo (auditado en el bundle desplegado del worker, sha 872f5449…): `runPickemLifecycle` crea un Pick'em legacy
-- por cada evento que sincroniza y `scorePickemEvent` PAGA escalones (`app_grant_reward`, ref `pickem:<id>:<escalón>`,
-- motivo `pickem_reward:<escalón>`) en cuanto alguien puntúa. A partir de aquí, para Pick'ems FUTUROS, la única
-- autoridad de recompensas es Pick'ems 2.0. Sin tocar el worker y sin reescribir ninguna función existente: solo
-- datos de clasificación + disparadores (la BD decide; cualquier camino —worker viejo, app, script, rollback— choca).
--
--   1. `pickem_events.legacy_mode`: discriminador ESTRUCTURAL. Las filas que existen al aplicar quedan `LEGACY_V1`
--      (conservan íntegras sus reglas: hay un Pick'em legacy en curso —Champions 2026— con un participante). El
--      valor por defecto pasa a `RETIRED`, y además ya no se pueden crear Pick'ems legacy (paso 2).
--   2. No se crean Pick'ems legacy nuevos (INSERT en `pickem_events` → PICKEM_LEGACY_RETIRED). El worker lo recibe
--      como nota informativa de su ciclo (lo atrapa y sigue: el sync no se ve afectado).
--   3. Solo se predice en un Pick'em legacy `LEGACY_V1` (guardia en `pickem_submissions`).
--   4. LIBRO: un asiento `pickem_reward:*` solo entra si su ref es `pickem:<uuid de un Pick'em LEGACY_V1>:…`. Lo que no
--      se pueda clasificar → no se paga (falla cerrada; la transacción entera se deshace: ni créditos ni sobres).
--   5. Una autoridad por EVENTO: Pick'ems 2.0 no puede activar ni pagar recompensas en un evento que tiene un Pick'em
--      legacy `LEGACY_V1` (evita premiar dos veces los mismos partidos).
--   6. Activar recompensas de Pick'ems 2.0 exige las REGLAS V1 APROBADAS exactas (`pickem-rewards-v1`).
--   7. `legacy_mode` es inmutable (nadie convierte un RETIRED en LEGACY_V1 sin la bandera de operador).
--
-- Nada borra ni recalcula histórico: ni picks, ni puntos, ni el libro (los 500 créditos de 2026-10-03 siguen).
-- Rollback: docs/operations/rollback/0072_pickems_reward_cutover.ROLLBACK.sql — ATENCIÓN: devolver el worker a crear
-- y pagar Pick'ems legacy en eventos nuevos reabre el riesgo de doble premio; el rollback lo dice y no lo hace solo.
-- ============================================================================================================

-- ── 1. discriminador ────────────────────────────────────────────────────────────────────────────────────────
alter table public.pickem_events add column if not exists legacy_mode text not null default 'LEGACY_V1';
alter table public.pickem_events alter column legacy_mode set default 'RETIRED';
alter table public.pickem_events drop constraint if exists pickem_events_legacy_mode_check;
alter table public.pickem_events add constraint pickem_events_legacy_mode_check check (legacy_mode in ('LEGACY_V1', 'RETIRED'));
comment on column public.pickem_events.legacy_mode is
  'F87.1 · LEGACY_V1 = Pick''em legacy anterior al corte (conserva predicciones y recompensas legacy). RETIRED = sin predicciones ni recompensas legacy. Las recompensas futuras son de Pick''ems 2.0.';

-- ── 2 y 7. no se crean Pick'ems legacy; legacy_mode inmutable ───────────────────────────────────────────────
create or replace function public._pickem_events_legacy_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('drl.pickem_legacy_writer', true), '') <> 'on' then
      raise exception 'PICKEM_LEGACY_RETIRED: los Pick''ems clásicos ya no se crean; las predicciones nuevas van por Pick''ems 2.0' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.legacy_mode is distinct from old.legacy_mode and coalesce(current_setting('drl.pickem_legacy_writer', true), '') <> 'on' then
    raise exception 'PICKEM_LEGACY_MODE_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists pickem_events_legacy_guard on public.pickem_events;
create trigger pickem_events_legacy_guard before insert or update on public.pickem_events
  for each row execute function public._pickem_events_legacy_guard();

-- ── 3. solo se predice en un legacy vigente ─────────────────────────────────────────────────────────────────
create or replace function public._pickem_submissions_legacy_guard()
returns trigger language plpgsql as $$
begin
  if coalesce((select legacy_mode from public.pickem_events where id = new.pickem_event_id), 'RETIRED') <> 'LEGACY_V1' then
    raise exception 'PICKEM_LEGACY_RETIRED: este Pick''em clásico ya no admite predicciones' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists pickem_submissions_legacy_guard on public.pickem_submissions;
create trigger pickem_submissions_legacy_guard before insert on public.pickem_submissions
  for each row execute function public._pickem_submissions_legacy_guard();

-- ── 4. el libro solo acepta recompensas legacy de Pick'ems LEGACY_V1 (falla cerrada) ────────────────────────
create or replace function public._ledger_pickem_legacy_guard()
returns trigger language plpgsql as $$
declare v_id text;
begin
  v_id := substring(coalesce(new.ref, '') from '^pickem:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[a-z_]+$');
  if v_id is null
     or coalesce((select legacy_mode from public.pickem_events where id = v_id::uuid), 'RETIRED') <> 'LEGACY_V1' then
    raise exception 'PICKEM_LEGACY_REWARD_RETIRED: recompensa legacy sin Pick''em LEGACY_V1 clasificable (%)', left(coalesce(new.ref, '∅'), 80) using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists credit_tx_pickem_legacy_guard on public.credit_transactions;
create trigger credit_tx_pickem_legacy_guard before insert on public.credit_transactions
  for each row when (new.reason like 'pickem\_reward:%')
  execute function public._ledger_pickem_legacy_guard();

-- ── 5 y 6. Pick'ems 2.0: una autoridad por evento + reglas v1 aprobadas exactas ─────────────────────────────
create or replace function public._pickem_event_has_legacy_authority(p_event text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pickem_events where event_id = p_event and legacy_mode = 'LEGACY_V1');
$$;

/** Espejo de `isRewardRulesV1` (domain/pickems/bracketRewards.ts): la tabla aprobada en F87.1, sin variaciones. */
create or replace function public._pickem_rules_v1_ok(p_rewards jsonb, p_slug text)
returns boolean language plpgsql immutable as $$
declare v_t jsonb; v_n int := 0; v_ratio numeric; v_pack text;
begin
  if p_rewards->>'rulesVersion' is distinct from 'pickem-rewards-v1' then return false; end if;
  if (p_rewards->>'minCompletion')::numeric is distinct from 0.8 then return false; end if;
  if jsonb_array_length(coalesce(p_rewards->'tiers', '[]'::jsonb)) <> 5 then return false; end if;
  for v_t in select * from jsonb_array_elements(p_rewards->'tiers') loop
    if coalesce((v_t->'reward'->>'credits')::numeric, 0) <> 0 then return false; end if;
    if jsonb_array_length(coalesce(v_t->'reward'->'cardIds', '[]'::jsonb)) <> 0 then return false; end if;
    if coalesce((v_t->'reward'->>'packCount')::int, 1) <> 1 then return false; end if;
    v_ratio := case when jsonb_typeof(v_t->'minRatio') = 'number' then (v_t->>'minRatio')::numeric end;
    v_pack := v_t->'reward'->>'packId';
    if not coalesce(case v_t->>'id'
              when 'PARTICIPATION' then v_pack = 'estandar' and v_ratio is null
              when 'GOOD'          then v_pack = 'premium'  and v_ratio = 0.5
              when 'GREAT'         then v_pack = 'oro'      and v_ratio = 0.7
              when 'ELITE'         then v_pack = 'masters'  and v_ratio = 0.85
              when 'PERFECT'       then v_pack = 'masters'  and v_ratio is null
              else false end, false) then
      return false;
    end if;
    if v_t->>'id' = 'PERFECT' then
      if coalesce(v_t->'reward'->'cosmetics', '[]'::jsonb) <> jsonb_build_array('insignia:pickem:' || p_slug || '-perfecto') then return false; end if;
    elsif jsonb_array_length(coalesce(v_t->'reward'->'cosmetics', '[]'::jsonb)) <> 0 then
      return false;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n = 5 and (select count(distinct t->>'id') from jsonb_array_elements(p_rewards->'tiers') t) = 5;
end; $$;

create or replace function public._pickem_brackets_rewards_guard()
returns trigger language plpgsql as $$
begin
  if new.rewards_status = 'ACTIVE' and (tg_op = 'INSERT' or old.rewards_status is distinct from 'ACTIVE' or new.rewards is distinct from old.rewards) then
    if public._pickem_event_has_legacy_authority(new.event_id) then
      raise exception 'PICKEM_LEGACY_AUTHORITY: este evento tiene un Pick''em clásico con recompensas propias; Pick''ems 2.0 no puede premiarlo' using errcode = 'P0001';
    end if;
    if not public._pickem_rules_v1_ok(new.rewards, new.slug) then
      raise exception 'PICKEM_RULES_NOT_APPROVED: solo se activan las reglas v1 aprobadas' using errcode = 'P0001';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists pickem_brackets_rewards_guard on public.pickem_brackets;
create trigger pickem_brackets_rewards_guard before insert or update on public.pickem_brackets
  for each row execute function public._pickem_brackets_rewards_guard();

create or replace function public._pickem_claims_authority_guard()
returns trigger language plpgsql as $$
begin
  if public._pickem_event_has_legacy_authority((select event_id from public.pickem_brackets where id = new.bracket_id)) then
    raise exception 'PICKEM_LEGACY_AUTHORITY: este evento se premia por el Pick''em clásico' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists pickem_claims_authority_guard on public.pickem_bracket_claims;
create trigger pickem_claims_authority_guard before insert on public.pickem_bracket_claims
  for each row execute function public._pickem_claims_authority_guard();

revoke all on function public._pickem_event_has_legacy_authority(text) from public, anon, authenticated;
revoke all on function public._pickem_rules_v1_ok(jsonb, text) from public, anon, authenticated;
grant execute on function public._pickem_event_has_legacy_authority(text) to service_role;

-- ── guardia final ──────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'pickem_events' and column_name = 'legacy_mode') not like '%RETIRED%' then
    raise exception '0072: el valor por defecto no es RETIRED';
  end if;
  if (select count(*) from pg_trigger where tgname in ('pickem_events_legacy_guard', 'pickem_submissions_legacy_guard', 'credit_tx_pickem_legacy_guard', 'pickem_brackets_rewards_guard', 'pickem_claims_authority_guard')) <> 5 then
    raise exception '0072: faltan disparadores';
  end if;
  if has_function_privilege('authenticated', 'public._pickem_event_has_legacy_authority(text)', 'EXECUTE') then
    raise exception '0072: un rol de cliente puede ejecutar la comprobación de autoridad';
  end if;
end $$;
