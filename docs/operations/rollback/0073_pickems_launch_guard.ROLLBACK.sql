-- ============================================================================================================
-- ROLLBACK de 0073 · F87.2 (Pick'ems launch guard). Operador, una transacción: psql -1 -v ON_ERROR_STOP=1 -f …
--
-- Devuelve EXACTAMENTE las guardias de 0072 (texto copiado de 0072): se conserva todo el corte de F87.1 —sin Pick'ems
-- legacy nuevos, autoridad legacy por evento, reglas v1 exactas, libro a prueba de fallos—. NO reabre la creación de
-- legacy ni el doble premio. Lo que se pierde al deshacer: la exigencia de elegibilidad de cuenta al reclamar, la
-- política obligatoria para activar y la puerta de tiempo en la BD (queda la del servidor si la app sigue en F87.2).
--
-- ANTES: comprobar que no hay ámbitos 2.0 con recompensas ACTIVAS (si los hay, desactivarlos primero: sin la
-- elegibilidad en la BD, una cuenta nueva podría cobrar).
--   select count(*) from public.pickem_brackets where rewards_status = 'ACTIVE';   -- debe ser 0
-- La app F87.2 sigue funcionando sobre 0072 (la elegibilidad se lee con RPC: sin ella, el servidor responde «sin
-- política» y NO deja cobrar); aun así, el rollback de código recomendado es activar la release anterior.
-- ============================================================================================================
do $$ begin
  if exists (select 1 from public.pickem_brackets where rewards_status = 'ACTIVE') then
    raise exception 'ROLLBACK 0073: hay recompensas 2.0 ACTIVAS; desactívalas antes';
  end if;
end $$;

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
create or replace function public._pickem_claims_authority_guard()
returns trigger language plpgsql as $$
begin
  if public._pickem_event_has_legacy_authority((select event_id from public.pickem_brackets where id = new.bracket_id)) then
    raise exception 'PICKEM_LEGACY_AUTHORITY: este evento se premia por el Pick''em clásico' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop function if exists public.app_pickem_eligibility_summary(uuid);
drop function if exists public.app_pickem_reward_eligibility(uuid, uuid, timestamptz);
drop function if exists public._pickem_window_closed(uuid, timestamptz);
drop function if exists public._pickem_first_lock(uuid);
drop function if exists public._pickem_eligibility_policy(text);
