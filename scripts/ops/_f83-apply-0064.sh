#!/usr/bin/env bash
# =============================================================================
# F83 · APLICAR 0064 EN PRODUCCIÓN — UNA vez, en UNA transacción, con comprobaciones antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0064> bash /tmp/f83/_f83-apply-0064.sh'
# Se PARA (exit ≠ 0) sin tocar nada si: el fichero no es el revisado, la cabeza no es 0063 por estado real, o ya hay
# rastro de 0064. Nunca reaplica 0059–0063. No imprime secretos.
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/f83/0064_season_track.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0063 por estado real, sin rastro de 0064"
[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='player_profile_customization' and column_name='favorite_team_id'")" = "1" ] || stop "0063 no está"
[ "$(q "select to_regclass('public.game_seasons') is null and to_regclass('public.season_xp_ledger') is null")" = "t" ] || stop "ya hay tablas de 0064"
[ "$(q "select count(*) from pg_proc where proname in ('app_season_apply','app_season_claim','_game_seasons_guard')")" = "0" ] || stop "ya hay funciones de 0064"
counts() { q "select 'users='||(select count(*) from auth.users)||' ppc='||(select count(*) from public.player_profile_customization)||' ppc_md5='||(select coalesce(md5(string_agg(user_id::text||showcase_card_uids::text||featured_achievement_ids::text||featured_badge_ids::text||version, '|' order by user_id)),'-') from public.player_profile_customization)||' user_cards='||(select count(*) from public.user_cards)||' matches='||(select count(*) from public.duel_matches)||' completions='||(select count(*) from public.user_collection_completions)||' cosmetics='||(select count(*) from public.user_cosmetics)||' economy_ops='||(select count(*) from public.economy_ops)"; }
BEFORE=$(counts); echo "antes: $BEFORE"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0064.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0064.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0064.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
AFTER=$(counts); echo "después: $AFTER"
[ "$BEFORE" = "$AFTER" ] && echo "DATOS_INTACTOS" || stop "los recuentos/huellas cambiaron"
[ "$(q "select to_regclass('public.game_seasons') is not null and to_regclass('public.season_xp_ledger') is not null and to_regclass('public.season_progress') is not null and to_regclass('public.season_challenge_progress') is not null and to_regclass('public.season_reward_claims') is not null and to_regclass('public.season_events') is not null")" = "t" ] || stop "faltan tablas"
[ "$(q "select to_regprocedure('public.app_season_apply(uuid, text, text, text, integer, integer, jsonb, jsonb)') is not null and to_regprocedure('public.app_season_claim(uuid, text, integer)') is not null")" = "t" ] || stop "faltan funciones"
echo "privilegios de cliente (EXECUTE/escritura): $(q "select count(*) from (values ('anon'),('authenticated')) r(n) where has_function_privilege(n,'public.app_season_apply(uuid,text,text,text,int,int,jsonb,jsonb)','execute') or has_function_privilege(n,'public.app_season_claim(uuid,text,int)','execute') or has_table_privilege(n,'public.season_xp_ledger','insert') or has_table_privilege(n,'public.season_progress','update') or has_table_privilege(n,'public.game_seasons','update')")"
[ "$(q "select count(*) from (values ('anon'),('authenticated')) r(n) where has_function_privilege(n,'public.app_season_apply(uuid,text,text,text,int,int,jsonb,jsonb)','execute') or has_function_privilege(n,'public.app_season_claim(uuid,text,int)','execute') or has_table_privilege(n,'public.season_xp_ledger','insert') or has_table_privilege(n,'public.season_progress','update') or has_table_privilege(n,'public.game_seasons','update')")" = "0" ] || stop "privilegios de cliente inesperados"
echo "políticas de lectura propia: $(q "select count(*) from pg_policies where schemaname='public' and tablename like 'season%' and qual like '%uid() = user_id%'")"
echo "temporadas: $(q "select count(*) from public.game_seasons")"
echo "APPLY_OK 0064"

