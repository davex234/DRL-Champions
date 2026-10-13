#!/usr/bin/env bash
# =============================================================================
# F89 · APLICAR 0063 EN PRODUCCIÓN — UNA vez, en UNA transacción, con comprobaciones antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0063> bash /tmp/f89/_f89-apply-0063.sh'
# Se PARA (exit ≠ 0) sin tocar nada si: el fichero no es el revisado, la cabeza no es 0062 por estado real, o ya hay
# rastro de 0063. Nunca reaplica 0059–0062. No imprime secretos.
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/f89/0063_profile_favorite_team.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0062 por estado real, sin rastro de 0063"
[ "$(q "select to_regclass('public.collection_sets') is not null and to_regprocedure('public.app_collection_claim(uuid, text)') is not null")" = "t" ] || stop "0062 no está"
[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='player_profile_customization' and column_name='favorite_team_id'")" = "0" ] || stop "la columna ya existe"
[ "$(q "select to_regprocedure('public.player_profile_set_favorite_team(uuid, text, integer)') is null")" = "t" ] || stop "la función ya existe"
counts() { q "select 'users='||(select count(*) from auth.users)||' ppc='||(select count(*) from public.player_profile_customization)||' ppc_md5='||(select coalesce(md5(string_agg(user_id::text||showcase_card_uids::text||featured_achievement_ids::text||featured_badge_ids::text||version, '|' order by user_id)),'-') from public.player_profile_customization)||' user_cards='||(select count(*) from public.user_cards)||' matches='||(select count(*) from public.duel_matches)||' completions='||(select count(*) from public.user_collection_completions)||' cosmetics='||(select count(*) from public.user_cosmetics)||' economy_ops='||(select count(*) from public.economy_ops)"; }
BEFORE=$(counts); echo "antes: $BEFORE"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0063.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0063.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0063.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
AFTER=$(counts); echo "después: $AFTER"
[ "$BEFORE" = "$AFTER" ] && echo "DATOS_INTACTOS" || stop "los recuentos/huellas cambiaron"
[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='player_profile_customization' and column_name='favorite_team_id'")" = "1" ] || stop "sin columna"
[ "$(q "select to_regprocedure('public.player_profile_set_favorite_team(uuid, text, integer)') is not null")" = "t" ] || stop "sin función"
echo "privilegios anon/authenticated (tabla, columna, EXECUTE): $(q "select has_table_privilege('anon','public.player_profile_customization','select')::text||','||has_table_privilege('authenticated','public.player_profile_customization','select')::text||','||has_column_privilege('authenticated','public.player_profile_customization','favorite_team_id','select')::text||','||has_function_privilege('authenticated','public.player_profile_set_favorite_team(uuid,text,int)','execute')::text||','||has_function_privilege('anon','public.player_profile_set_favorite_team(uuid,text,int)','execute')::text")"
[ "$(q "select (has_table_privilege('anon','public.player_profile_customization','select') or has_table_privilege('authenticated','public.player_profile_customization','select') or has_column_privilege('authenticated','public.player_profile_customization','favorite_team_id','select') or has_function_privilege('authenticated','public.player_profile_set_favorite_team(uuid,text,int)','execute') or has_function_privilege('anon','public.player_profile_set_favorite_team(uuid,text,int)','execute'))::text")" = "false" ] || stop "privilegios de cliente inesperados"
echo "favoritos no nulos: $(q "select count(*) from public.player_profile_customization where favorite_team_id is not null")"
echo "APPLY_OK 0063"
