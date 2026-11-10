-- ROLLBACK de 0072_pickems_reward_cutover (F87.1). Quita las guardias del corte de autoridad de recompensas de Pick'ems.
-- ¡ATENCIÓN! Sin estas guardias, el worker esports (bundle de F24.8) vuelve a CREAR un Pick'em legacy por cada evento
-- nuevo que sincronice y a PAGAR sus escalones automáticamente: reaparece el riesgo de doble premio con Pick'ems 2.0
-- en eventos futuros. Antes de ejecutarlo: asegurarse de que NINGÚN Pick'em 2.0 tiene recompensas ACTIVAS
-- (select slug from pickem_brackets where rewards_status = 'ACTIVE'; → debe salir vacío) y decidirlo explícitamente.
-- No borra ni toca datos: la columna `legacy_mode` se conserva (solo se quitan disparadores y funciones).
begin;
drop trigger if exists pickem_claims_authority_guard on public.pickem_bracket_claims;
drop trigger if exists pickem_brackets_rewards_guard on public.pickem_brackets;
drop trigger if exists credit_tx_pickem_legacy_guard on public.credit_transactions;
drop trigger if exists pickem_submissions_legacy_guard on public.pickem_submissions;
drop trigger if exists pickem_events_legacy_guard on public.pickem_events;
drop function if exists public._pickem_claims_authority_guard();
drop function if exists public._pickem_brackets_rewards_guard();
drop function if exists public._pickem_rules_v1_ok(jsonb, text);
drop function if exists public._pickem_event_has_legacy_authority(text);
drop function if exists public._ledger_pickem_legacy_guard();
drop function if exists public._pickem_submissions_legacy_guard();
drop function if exists public._pickem_events_legacy_guard();
commit;
