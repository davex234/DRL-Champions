#!/usr/bin/env bash
# =============================================================================
# F86 · TORNEOS · APLICAR 0069 EN PRODUCCIÓN — UNA vez, en UNA transacción, con huellas antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0069> bash /tmp/cups/_cups-apply-0069.sh'
# Se PARA sin tocar nada si: el fichero no es el revisado, la cabeza no es 0068 por estado real o ya hay rastro de 0069.
# Imprime solo recuentos y huellas. Nunca UUID completos, correos ni secretos. 0069 es ADITIVA: no escribe ninguna fila.
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/cups/0069_player_cups.sql
PERSONAL=2f86cbe8
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0068 por estado real, sin rastro de 0069"
[ "$(q "select exists (select 1 from information_schema.columns where table_name='profiles' and column_name='public_tag') and to_regclass('public.account_tag_registry') is not null")" = "t" ] || stop "0068 no está"
[ "$(q "select to_regclass('public.cups') is null and to_regclass('public.cup_matches') is null and to_regclass('public.cup_registrations') is null")" = "t" ] || stop "ya hay rastro de 0069"
TABLES="auth.users public.profiles public.user_cards public.user_game public.game_state public.user_packs public.credit_transactions public.duel_pvp_ratings public.duel_pvp_rating_events public.competitive_season_players public.duel_friendships public.social_blocks public.duel_challenges public.duel_matches public.content_audit_log public.player_profile_customization public.user_cosmetics public.user_collection_completions public.game_seasons public.season_xp_ledger public.mission_events public.user_mission_progress public.account_tag_registry public.tournaments"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
fp > /tmp/cups/before.fp
PERSONAL_BEFORE=$(q "select md5(to_jsonb(p)::text) from public.profiles p where left(id::text,8)='$PERSONAL'")
ADMINS=$(q "select string_agg(left(id::text,8), ',' order by id) from public.profiles where is_admin")
echo "perfiles: $(q "select count(*) from public.profiles") · admins: $ADMINS · huellas de $(wc -l < /tmp/cups/before.fp) tablas · temporada-2: $(q "select status from public.game_seasons where id='temporada-2'")"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0069.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0069.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0069.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
fp > /tmp/cups/after.fp
if diff /tmp/cups/before.fp /tmp/cups/after.fp >/dev/null; then echo "DATOS_INTACTOS (0069 no cambió ninguna fila existente)"; else diff /tmp/cups/before.fp /tmp/cups/after.fp | head; echo "AVISO_HUELLAS_DISTINTAS (actividad real durante el aplicado: revisar qué tabla)"; fi
echo "tablas nuevas: $(q "select (select count(*) from public.cups)||' copas · '||(select count(*) from public.cup_registrations)||' inscripciones · '||(select count(*) from public.cup_matches)||' cruces'")"
[ "$(q "select string_agg(left(id::text,8), ',' order by id) from public.profiles where is_admin")" = "$ADMINS" ] && echo "ADMINS_IGUALES" || stop "los admins cambiaron"
[ "$(q "select md5(to_jsonb(p)::text) from public.profiles p where left(id::text,8)='$PERSONAL'")" = "$PERSONAL_BEFORE" ] && echo "CUENTA_PERSONAL_INTACTA (tag #$(q "select public_tag from public.profiles where left(id::text,8)='$PERSONAL'"))" || stop "la cuenta personal cambió"
PRIV=$(q "select has_table_privilege('authenticated','public.cups','SELECT')::text||has_table_privilege('anon','public.cup_matches','SELECT')::text||has_table_privilege('authenticated','public.cup_registrations','INSERT')::text||has_function_privilege('authenticated','public.cup_settle_game(uuid)','EXECUTE')::text||has_function_privilege('anon','public.cup_register(uuid,uuid)','EXECUTE')::text")
echo "privilegios de cliente (auth select cups, anon select cruces, auth insert inscripción, auth exec liquidar, anon exec inscribir): $PRIV"
[ "$PRIV" = "falsefalsefalsefalsefalse" ] || stop "privilegios de cliente inesperados"
echo "disparadores: $(q "select string_agg(tgname, ',' order by tgname) from pg_trigger where tgname in ('cups_guard','cup_registrations_guard','cup_matches_guard')")"
echo "trofeo único: $(q "select count(*) from pg_indexes where indexname='user_cosmetics_cup_trophy_once'")"
echo "F83 temporada-2: $(q "select status from public.game_seasons where id='temporada-2'")"
echo "APPLY_OK 0069"
