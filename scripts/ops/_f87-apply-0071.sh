#!/usr/bin/env bash
# =============================================================================
# F87 · PICK'EMS 2.0 · APLICAR 0071 EN PRODUCCIÓN — UNA vez, en UNA transacción, con huellas antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0071> bash /tmp/f87/_f87-apply-0071.sh'
# Se PARA sin tocar nada si: el fichero no es el revisado, la cabeza no es 0070 por estado real o ya hay rastro de 0071.
# Imprime solo recuentos y huellas. Nunca UUID completos, correos ni secretos. 0071 es ADITIVA: no escribe ninguna fila.
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/f87/0071_pickems_bracket.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0070 por estado real, sin rastro de 0071"
[ "$(q "select to_regclass('public.alpha_feedback') is not null and to_regprocedure('public.app_alpha_funnel(timestamptz, boolean)') is not null")" = "t" ] || stop "0070 no está"
[ "$(q "select to_regclass('public.pickem_brackets') is null and to_regclass('public.pickem_bracket_picks') is null and to_regprocedure('public.app_pickem_claim(uuid, uuid)') is null")" = "t" ] || stop "ya hay rastro de 0071"
TABLES="auth.users public.profiles public.user_cards public.user_packs public.credit_transactions public.user_cosmetics public.events public.stages public.matches public.teams public.standings public.pickem_events public.pickem_questions public.pickem_submissions public.pickem_answers public.pickem_scores public.sync_state public.content_audit_log public.duel_matches public.cups public.cup_matches public.alpha_feedback public.game_seasons public.account_tag_registry"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
fp > /tmp/f87/before.fp
ADMINS=$(q "select string_agg(left(id::text,8)||'#'||public_tag, ',' order by id) from public.profiles where is_admin")
ACCOUNTS=$(q "select count(*) from public.profiles")
REAL=$(q "select md5(string_agg(to_jsonb(p)::text, '|' order by p.id)) from public.profiles p")
echo "perfiles: $ACCOUNTS · admins: $ADMINS · huellas de $(wc -l < /tmp/f87/before.fp) tablas"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0071.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0071.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0071.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
fp > /tmp/f87/after.fp
# Las tablas que escribe el worker esports (cada 2 min) o la actividad real pueden cambiar durante el aplicado: se dice cuál.
if diff /tmp/f87/before.fp /tmp/f87/after.fp >/dev/null; then echo "DATOS_INTACTOS (0071 no cambió ninguna fila existente)"; else diff /tmp/f87/before.fp /tmp/f87/after.fp | head; echo "AVISO_HUELLAS_DISTINTAS (actividad real durante el aplicado: revisar qué tabla)"; fi
echo "tablas nuevas: $(q "select (select count(*) from public.pickem_brackets)||' ámbitos · '||(select count(*) from public.pickem_bracket_picks)||' picks · '||(select count(*) from public.pickem_bracket_claims)||' reclamos'")"
[ "$(q "select string_agg(left(id::text,8)||'#'||public_tag, ',' order by id) from public.profiles where is_admin")" = "$ADMINS" ] && echo "ADMINS_IGUALES" || stop "los admins cambiaron"
[ "$(q "select md5(string_agg(to_jsonb(p)::text, '|' order by p.id)) from public.profiles p")" = "$REAL" ] && echo "PERFILES_INTACTOS ($ACCOUNTS cuentas)" || echo "AVISO perfiles cambiaron (¿actividad real? last_seen_at)"
PRIV=$(q "select has_table_privilege('authenticated','public.pickem_brackets','SELECT')::text||has_table_privilege('anon','public.pickem_bracket_picks','SELECT')::text||has_table_privilege('authenticated','public.pickem_bracket_entries','INSERT')::text||has_function_privilege('authenticated','public.app_pickem_save_pick(uuid,uuid,text,text,integer,text[])','EXECUTE')::text||has_function_privilege('anon','public.app_pickem_claim(uuid,uuid)','EXECUTE')::text||has_function_privilege('authenticated','public.app_pickem_admin_settle(uuid,uuid,integer,text)','EXECUTE')::text")
echo "privilegios de cliente (auth select ámbitos, anon select picks, auth insert entradas, auth exec pick, anon exec reclamo, auth exec liquidar): $PRIV"
[ "$PRIV" = "falsefalsefalsefalsefalsefalse" ] || stop "privilegios de cliente inesperados"
echo "disparadores: $(q "select string_agg(tgname, ',' order by tgname) from pg_trigger where tgname like 'pickem_%'")"
echo "Pick'em v1 intacto: $(q "select count(*) from public.pickem_events")/$(q "select count(*) from public.pickem_questions")/$(q "select count(*) from public.pickem_answers")"
echo "APPLY_OK 0071"
