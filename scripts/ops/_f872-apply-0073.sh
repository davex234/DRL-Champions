#!/usr/bin/env bash
# =============================================================================
# F87.2 · PICK'EMS LAUNCH GUARD · APLICAR 0073 EN PRODUCCIÓN — UNA vez, en UNA transacción, con huellas.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0073> bash /tmp/f872/_f872-apply-0073.sh'
# Se PARA sin tocar nada si: el fichero no es el revisado, la cabeza no es 0072 por estado real, ya hay rastro de 0073
# o hay recompensas 2.0 ACTIVAS. Imprime solo recuentos y huellas. Nunca UUID completos, correos ni secretos.
# 0073 solo añade funciones y sustituye las dos guardias de 0072 (conservando todo): no escribe ninguna fila.
# Las cuentas reales JUEGAN: si alguna huella de sus tablas cambia durante el aplicado, se dice qué y por qué motivo.
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/f872/0073_pickems_launch_guard.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
VR_ROW="59f8d286-7b81-489b-9098-bb15ce6047a5"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0072 por estado real, sin rastro de 0073, sin recompensas activas"
[ "$(q "select count(*) from pg_trigger where not tgisinternal and tgname in ('pickem_events_legacy_guard','pickem_submissions_legacy_guard','credit_tx_pickem_legacy_guard','pickem_brackets_rewards_guard','pickem_claims_authority_guard')")" = "5" ] || stop "0072 no está completa"
[ "$(q "select to_regprocedure('public.app_pickem_reward_eligibility(uuid, uuid, timestamptz)') is null and to_regprocedure('public._pickem_window_closed(uuid, timestamptz)') is null")" = "t" ] || stop "ya hay rastro de 0073"
[ "$(q "select count(*) from public.pickem_brackets where rewards_status = 'ACTIVE'")" = "0" ] || stop "hay recompensas 2.0 ACTIVAS"
TABLES="auth.users public.profiles public.user_cards public.user_packs public.credit_transactions public.user_cosmetics public.events public.stages public.matches public.pickem_events public.pickem_questions public.pickem_submissions public.pickem_answers public.pickem_scores public.pickem_brackets public.pickem_bracket_matches public.pickem_bracket_entries public.pickem_bracket_picks public.pickem_bracket_claims public.duel_matches public.cups public.alpha_feedback public.account_tag_registry"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
mkdir -p /tmp/f872
T_BEFORE=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)
fp > /tmp/f872/before.fp
ADMINS=$(q "select string_agg(left(id::text,8)||'#'||public_tag, ',' order by id) from public.profiles where is_admin")
ACCOUNTS=$(q "select count(*) from public.profiles")
VR=$(q "select id||'|'||delta||'|'||reason||'|'||ref||'|'||coalesce(balance_after::text,'')||'|'||created_at from public.credit_transactions where id = '$VR_ROW'")
LEGACY_PAYOUTS=$(q "select count(*)||':'||coalesce(sum(delta),0) from public.credit_transactions where reason like 'pickem\_reward:%'")
LEGACY_MODES=$(q "select string_agg(legacy_mode, ',' order by created_at) from public.pickem_events")
[ -n "$VR" ] || stop "no encuentro el asiento histórico de ValoRosters"
echo "perfiles: $ACCOUNTS · admins: $ADMINS · legacy: $LEGACY_MODES · pagos legacy (n:suma): $LEGACY_PAYOUTS · huellas de $(wc -l < /tmp/f872/before.fp) tablas"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0073.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0073.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0073.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
fp > /tmp/f872/after.fp
if diff /tmp/f872/before.fp /tmp/f872/after.fp >/dev/null; then echo "DATOS_INTACTOS (0073 no cambió ninguna fila)"; else
  diff /tmp/f872/before.fp /tmp/f872/after.fp | head; echo "AVISO_HUELLAS_DISTINTAS — actividad real durante el aplicado:"
  q "select 'libro', left(user_id::text,8), reason, count(*) from public.credit_transactions where created_at >= '$T_BEFORE' group by 2,3"
fi
check_eq() { [ "$2" = "$3" ] && echo "$1" || stop "$1: esperado «$3», obtenido «$2»"; }
check_eq "FUNCIONES_0073" "$(q "select count(*) from pg_proc where proname in ('_pickem_eligibility_policy','_pickem_first_lock','_pickem_window_closed','app_pickem_reward_eligibility','app_pickem_eligibility_summary')")" "5"
check_eq "GUARDIAS_5" "$(q "select count(*) from pg_trigger where not tgisinternal and tgname in ('pickem_events_legacy_guard','pickem_submissions_legacy_guard','credit_tx_pickem_legacy_guard','pickem_brackets_rewards_guard','pickem_claims_authority_guard')")" "5"
check_eq "GUARDIA_RECLAMO_CON_ELEGIBILIDAD" "$(q "select prosrc like '%PICKEM_REWARD_INELIGIBLE%' and prosrc like '%PICKEM_LEGACY_AUTHORITY%' from pg_proc where proname='_pickem_claims_authority_guard'")" "t"
check_eq "GUARDIA_RECOMPENSAS_COMPLETA" "$(q "select prosrc like '%PICKEM_RULES_NOT_APPROVED%' and prosrc like '%PICKEM_ELIGIBILITY_POLICY_REQUIRED%' and prosrc like '%PICKEM_REWARDS_TOO_LATE%' and prosrc like '%PICKEM_LEGACY_AUTHORITY%' from pg_proc where proname='_pickem_brackets_rewards_guard'")" "t"
check_eq "PRIVILEGIOS_CLIENTE_CERRADOS" "$(q "select bool_or(has_function_privilege(r, f, 'EXECUTE')) from unnest(array['anon','authenticated']) r, unnest(array['public.app_pickem_reward_eligibility(uuid,uuid,timestamptz)','public.app_pickem_eligibility_summary(uuid)','public._pickem_window_closed(uuid,timestamptz)','public._pickem_first_lock(uuid)','public._pickem_eligibility_policy(text)','public.app_pickem_claim(uuid,uuid)'])  f")" "f"
check_eq "LEGACY_IGUAL" "$(q "select string_agg(legacy_mode, ',' order by created_at) from public.pickem_events")" "$LEGACY_MODES"
check_eq "ADMINS_IGUALES" "$(q "select string_agg(left(id::text,8)||'#'||public_tag, ',' order by id) from public.profiles where is_admin")" "$ADMINS"
check_eq "CUENTAS_IGUALES" "$(q "select count(*) from public.profiles")" "$ACCOUNTS"
check_eq "VALOROSTERS_500_MISMO_ASIENTO" "$(q "select id||'|'||delta||'|'||reason||'|'||ref||'|'||coalesce(balance_after::text,'')||'|'||created_at from public.credit_transactions where id = '$VR_ROW'")" "$VR"
check_eq "PAGOS_LEGACY_IGUALES" "$(q "select count(*)||':'||coalesce(sum(delta),0) from public.credit_transactions where reason like 'pickem\_reward:%'")" "$LEGACY_PAYOUTS"
check_eq "POLITICA_V1" "$(q "select public._pickem_eligibility_policy('reward-eligibility-v1')->>'minAccountAgeDays'||'/'||(public._pickem_eligibility_policy('reward-eligibility-v1')->>'minCompletedMatches')")" "7/3"
echo "Pick'ems 2.0: $(q "select count(*)||' ámbitos · '||count(*) filter (where status='PUBLISHED')||' publicados · '||count(*) filter (where rewards_status='ACTIVE')||' con recompensas activas' from public.pickem_brackets")"
echo "APPLY_OK 0073"
