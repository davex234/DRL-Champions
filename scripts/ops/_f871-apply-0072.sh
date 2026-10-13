#!/usr/bin/env bash
# =============================================================================
# F87.1 · CORTE DE RECOMPENSAS DE PICK'EMS · APLICAR 0072 EN PRODUCCIÓN — UNA vez, en UNA transacción, con huellas.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0072> bash /tmp/f871/_f871-apply-0072.sh'
# Se PARA sin tocar nada si: el fichero no es el revisado, la cabeza no es 0071 por estado real o ya hay rastro de 0072.
# Imprime solo recuentos y huellas. Nunca UUID completos, correos ni secretos.
# 0072 añade `pickem_events.legacy_mode` (las filas existentes quedan LEGACY_V1) y disparadores: no borra ni recalcula
# nada. Las huellas de `pickem_events` se toman SIN la columna nueva para probar que ninguna otra cambió.
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/f871/0072_pickems_reward_cutover.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
VR_ROW="59f8d286-7b81-489b-9098-bb15ce6047a5"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0071 por estado real, sin rastro de 0072"
[ "$(q "select to_regclass('public.pickem_brackets') is not null and to_regprocedure('public.app_pickem_claim(uuid, uuid)') is not null")" = "t" ] || stop "0071 no está"
[ "$(q "select not exists (select 1 from information_schema.columns where table_schema='public' and table_name='pickem_events' and column_name='legacy_mode') and to_regprocedure('public._ledger_pickem_legacy_guard()') is null and to_regprocedure('public._pickem_rules_v1_ok(jsonb, text)') is null")" = "t" ] || stop "ya hay rastro de 0072"
[ "$(q "select count(*) from public.pickem_brackets where rewards_status = 'ACTIVE'")" = "0" ] || stop "hay recompensas 2.0 ACTIVAS: no se aplica a ciegas"
TABLES="auth.users public.profiles public.user_cards public.user_packs public.credit_transactions public.user_cosmetics public.events public.stages public.matches public.pickem_events public.pickem_questions public.pickem_submissions public.pickem_answers public.pickem_scores public.pickem_brackets public.pickem_bracket_matches public.pickem_bracket_entries public.pickem_bracket_picks public.pickem_bracket_claims public.cups public.alpha_feedback public.account_tag_registry"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg((to_jsonb(t) - 'legacy_mode')::text, '|' order by (to_jsonb(t) - 'legacy_mode')::text)),'-') from $t t")"; done; }
mkdir -p /tmp/f871
fp > /tmp/f871/before.fp
ADMINS=$(q "select string_agg(left(id::text,8)||'#'||public_tag, ',' order by id) from public.profiles where is_admin")
ACCOUNTS=$(q "select count(*) from public.profiles")
VR=$(q "select id||'|'||user_id||'|'||delta||'|'||reason||'|'||ref||'|'||coalesce(balance_after::text,'')||'|'||created_at from public.credit_transactions where id = '$VR_ROW'")
LEGACY_PAYOUTS=$(q "select count(*)||':'||coalesce(sum(delta),0) from public.credit_transactions where reason like 'pickem\_reward:%'")
NPICKEMS=$(q "select count(*) from public.pickem_events")
[ -n "$VR" ] || stop "no encuentro el asiento histórico de ValoRosters"
echo "perfiles: $ACCOUNTS · admins: $ADMINS · Pick'ems legacy: $NPICKEMS · pagos legacy (n:suma): $LEGACY_PAYOUTS · huellas de $(wc -l < /tmp/f871/before.fp) tablas"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0072.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0072.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0072.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
fp > /tmp/f871/after.fp
if diff /tmp/f871/before.fp /tmp/f871/after.fp >/dev/null; then echo "DATOS_INTACTOS (0072 no cambió ninguna fila existente fuera de legacy_mode)"; else diff /tmp/f871/before.fp /tmp/f871/after.fp | head; echo "AVISO_HUELLAS_DISTINTAS (actividad real durante el aplicado: revisar qué tabla)"; fi
CLS=$(q "select count(*) filter (where legacy_mode='LEGACY_V1')||'/'||count(*) from public.pickem_events")
echo "clasificación: $CLS LEGACY_V1"
[ "$CLS" = "$NPICKEMS/$NPICKEMS" ] || stop "no todos los Pick'ems existentes quedaron LEGACY_V1"
[ "$(q "select column_default from information_schema.columns where table_schema='public' and table_name='pickem_events' and column_name='legacy_mode'")" = "'RETIRED'::text" ] && echo "DEFAULT_RETIRED" || stop "el valor por defecto no es RETIRED"
TRG=$(q "select string_agg(tgname, ',' order by tgname) from pg_trigger where not tgisinternal and tgname in ('pickem_events_legacy_guard','pickem_submissions_legacy_guard','credit_tx_pickem_legacy_guard','pickem_brackets_rewards_guard','pickem_claims_authority_guard')")
echo "disparadores: $TRG"
[ "$(echo "$TRG" | tr ',' '\n' | grep -c .)" = "5" ] || stop "faltan disparadores"
PRIV=$(q "select has_function_privilege('authenticated','public._pickem_event_has_legacy_authority(text)','EXECUTE')::text||has_function_privilege('anon','public._pickem_rules_v1_ok(jsonb,text)','EXECUTE')::text||has_function_privilege('authenticated','public._pickem_rules_v1_ok(jsonb,text)','EXECUTE')::text")
echo "privilegios de cliente (auth autoridad, anon reglas, auth reglas): $PRIV"
[ "$PRIV" = "falsefalsefalse" ] || stop "privilegios de cliente inesperados"
[ "$(q "select string_agg(left(id::text,8)||'#'||public_tag, ',' order by id) from public.profiles where is_admin")" = "$ADMINS" ] && echo "ADMINS_IGUALES" || stop "los admins cambiaron"
[ "$(q "select count(*) from public.profiles")" = "$ACCOUNTS" ] && echo "CUENTAS_IGUALES ($ACCOUNTS)" || echo "AVISO cuentas distintas"
[ "$(q "select id||'|'||user_id||'|'||delta||'|'||reason||'|'||ref||'|'||coalesce(balance_after::text,'')||'|'||created_at from public.credit_transactions where id = '$VR_ROW'")" = "$VR" ] && echo "VALOROSTERS_500_MISMO_ASIENTO" || stop "el asiento histórico cambió"
[ "$(q "select count(*)||':'||coalesce(sum(delta),0) from public.credit_transactions where reason like 'pickem\_reward:%'")" = "$LEGACY_PAYOUTS" ] && echo "PAGOS_LEGACY_IGUALES ($LEGACY_PAYOUTS)" || echo "AVISO pagos legacy distintos"
echo "Pick'ems 2.0: $(q "select count(*)||' ámbitos · '||count(*) filter (where status='PUBLISHED')||' publicados · '||count(*) filter (where rewards_status = 'ACTIVE')||' con recompensas activas' from public.pickem_brackets")"
echo "APPLY_OK 0072"
