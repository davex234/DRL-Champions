#!/usr/bin/env bash
# =============================================================================
# F84 · APLICAR 0065 EN PRODUCCIÓN — UNA vez, en UNA transacción, con comprobaciones antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0065> bash /tmp/f84/_f84-apply-0065.sh'
# Se PARA (exit ≠ 0) sin tocar nada si: el fichero no es el revisado, la cabeza no es 0064 por estado real, o ya hay
# rastro de 0065. Nunca reaplica 0059–0064. No imprime secretos ni datos de jugadores (solo recuentos y huellas).
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/f84/0065_ranked_competitive.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0064 por estado real, sin rastro de 0065"
[ "$(q "select to_regclass('public.game_seasons') is not null and to_regprocedure('public.app_season_apply(uuid, text, text, text, integer, integer, jsonb, jsonb)') is not null")" = "t" ] || stop "0064 no está"
[ "$(q "select to_regclass('public.competitive_seasons') is null and to_regclass('public.competitive_season_players') is null and to_regclass('public.competitive_ladder') is null")" = "t" ] || stop "ya hay tablas/vistas de 0065"
[ "$(q "select count(*) from information_schema.columns where table_name='duel_pvp_rating_events' and column_name in ('formula_version','competitive_season_id','season_match_number','rule')")" = "0" ] || stop "ya hay columnas de 0065"
SETTLE_BEFORE=$(q "select md5(pg_get_functiondef('public.duel_pvp_settle_match(uuid)'::regprocedure))")
echo "liquidación antes: $SETTLE_BEFORE"
counts() { q "select 'users='||(select count(*) from auth.users)||' ratings='||(select count(*) from public.duel_pvp_ratings)||' ratings_md5='||(select md5(string_agg(concat_ws(',',user_id,rating,games_played,wins,losses,draws,updated_at), '|' order by user_id)) from public.duel_pvp_ratings)||' events='||(select count(*) from public.duel_pvp_rating_events)||' events_md5='||(select md5(string_agg(concat_ws(',',id,match_id,user_id,old_rating,delta,new_rating,opponent_rating,k_factor,result,created_at), '|' order by id)) from public.duel_pvp_rating_events)||' matches='||(select count(*) from public.duel_matches)||' queue_live='||(select count(*) from public.duel_pvp_queue where state in ('QUEUED','PAIRING'))||' t2='||coalesce((select status from public.game_seasons where id='temporada-2'),'-')||' economy_ops='||(select count(*) from public.economy_ops)"; }
BEFORE=$(counts); echo "antes: $BEFORE"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0065.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0065.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0065.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
AFTER=$(counts); echo "después: $AFTER"
# Durante el aplicado una partida ranked real podría liquidarse: entonces ratings/eventos cambian legítimamente.
if [ "$BEFORE" = "$AFTER" ]; then echo "DATOS_INTACTOS"; else echo "AVISO_RECUENTOS_DISTINTOS (comprobar si hubo una liquidación real durante el aplicado)"; fi
[ "$(q "select to_regclass('public.competitive_seasons') is not null and to_regclass('public.competitive_season_players') is not null and to_regclass('public.competitive_rating_adjustments') is not null and to_regclass('public.competitive_season_snapshots') is not null and to_regclass('public.competitive_ladder') is not null and to_regclass('public.competitive_rating_ledger') is not null")" = "t" ] || stop "faltan tablas/vistas"
echo "temporada competitiva: $(q "select id||' '||status||' desde '||to_char(starts_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')||' fin='||coalesce(ends_at::text,'abierta')||' '||rank_config_version||' '||formula_version||' colocación='||placement_games from public.competitive_seasons")"
echo "activa por hora de BD: $(q "select id from public.competitive_active_season()")"
echo "histórico sellado v1 sin temporada: $(q "select count(*) filter (where formula_version='ranked-rating-v1' and competitive_season_id is null and rule='STANDARD')||' de '||count(*) from public.duel_pvp_rating_events")"
echo "liquidación después: $(q "select md5(pg_get_functiondef('public.duel_pvp_settle_match(uuid)'::regprocedure))")"
PRIV=$(q "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.competitive_seasons'),('public.competitive_season_players'),('public.competitive_rating_adjustments'),('public.competitive_season_snapshots'),('public.duel_pvp_rating_events'),('public.duel_pvp_ratings')) t(s) cross join (values ('insert'),('update'),('delete')) p(k) where has_table_privilege(n, s, k)")
FPRIV=$(q "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.duel_pvp_settle_match(uuid)'),('public.competitive_season_close(text)'),('public.competitive_season_seed(text)'),('public.competitive_rating_correct(uuid,int,text,uuid,text)'),('public.competitive_active_season()')) f(s) where has_function_privilege(n, s, 'execute')")
VPRIV=$(q "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.competitive_ladder'),('public.competitive_rating_ledger')) t(s) where has_table_privilege(n, s, 'select')")
echo "privilegios de cliente: escritura=$PRIV execute=$FPRIV vistas=$VPRIV"
[ "$PRIV$FPRIV$VPRIV" = "000" ] || stop "privilegios de cliente inesperados"
echo "políticas de lectura propia: $(q "select count(*) from pg_policies where schemaname='public' and tablename in ('competitive_season_players','competitive_rating_adjustments','competitive_season_snapshots') and qual like '%uid() = user_id%'")"
echo "F83 temporada-2: $(q "select status from public.game_seasons where id='temporada-2'")"
echo "APPLY_OK 0065"
