#!/usr/bin/env bash
# =============================================================================
# F85 · APLICAR 0066 EN PRODUCCIÓN — UNA vez, en UNA transacción, con comprobaciones antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0066> bash /tmp/f85/_f85-apply-0066.sh'
# Se PARA (exit ≠ 0) sin tocar nada si: el fichero no es el revisado, la cabeza no es 0065 por estado real, o ya hay
# rastro de 0066. Nunca reaplica 0059–0065. No imprime secretos ni datos de jugadores (solo recuentos y huellas).
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/f85/0066_social_2.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0065 por estado real, sin rastro de 0066"
[ "$(q "select to_regclass('public.competitive_seasons') is not null and to_regclass('public.competitive_ladder') is not null")" = "t" ] || stop "0065 no está"
[ "$(q "select to_regclass('public.social_blocks') is null and to_regprocedure('public._social_blocked(uuid,uuid)') is null and to_regprocedure('public._social_reserved(uuid)') is null")" = "t" ] || stop "ya hay rastro de 0066"
SETTLE_BEFORE=$(q "select md5(pg_get_functiondef('public.duel_pvp_settle_match(uuid)'::regprocedure))")
ACTIVE_BEFORE=$(q "select md5(pg_get_functiondef('public._duel_pvp_has_active_match(uuid)'::regprocedure))")
echo "liquidación antes: $SETTLE_BEFORE · partida activa antes: $ACTIVE_BEFORE"
counts() { q "select 'users='||(select count(*) from auth.users)||' friendships='||(select count(*) from public.duel_friendships)||' blocked_rows='||(select count(*) from public.duel_friendships where status='BLOCKED')||' challenges='||(select count(*) from public.duel_challenges)||' pending='||(select count(*) from public.duel_challenges where status='PENDING')||' ratings_md5='||(select md5(string_agg(concat_ws(',',user_id,rating,games_played,wins,losses,draws,updated_at), '|' order by user_id)) from public.duel_pvp_ratings)||' events='||(select count(*) from public.duel_pvp_rating_events)||' matches='||(select count(*) from public.duel_matches)||' season_players='||(select count(*) from public.competitive_season_players)||' t2='||coalesce((select status from public.game_seasons where id='temporada-2'),'-')||' economy_ops='||(select count(*) from public.economy_ops)"; }
BEFORE=$(counts); echo "antes: $BEFORE"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0066.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0066.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0066.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
AFTER=$(counts); echo "después: $AFTER"
if [ "$BEFORE" = "$AFTER" ]; then echo "DATOS_INTACTOS"; else echo "AVISO_RECUENTOS_DISTINTOS (filas BLOCKED migradas o actividad real durante el aplicado)"; fi
[ "$(q "select to_regclass('public.social_blocks') is not null and to_regprocedure('public._social_reserved(uuid)') is not null and to_regclass('public.duel_challenges_pending_pair_uniq') is not null")" = "t" ] || stop "faltan objetos de 0066"
echo "liquidación después: $(q "select md5(pg_get_functiondef('public.duel_pvp_settle_match(uuid)'::regprocedure))") (debe = antes)"
echo "partida activa después: $(q "select md5(pg_get_functiondef('public._duel_pvp_has_active_match(uuid)'::regprocedure))") (debe = antes)"
FPRIV=$(q "select count(*) from (values ('anon'),('authenticated')) r(n) cross join unnest(array['public.social_friend_request(uuid,uuid)','public.social_friend_respond(uuid,uuid,boolean)','public.social_unfriend(uuid,uuid)','public.social_block(uuid,uuid)','public.social_unblock(uuid,uuid)','public.social_challenge_create(uuid,uuid,uuid,uuid,int)','public.social_challenge_respond(uuid,uuid,boolean,uuid)','public.social_challenge_expire_due(uuid)','public._social_blocked(uuid,uuid)','public._social_reserved(uuid)','public._social_in_queue(uuid)','public._social_lock_pair(uuid,uuid)','public._social_friend_count(uuid)']) f where has_function_privilege(n, f, 'execute')")
TPRIV=$(q "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.social_blocks'),('public.duel_friendships'),('public.duel_challenges')) t(s) cross join (values ('insert'),('update'),('delete')) p(k) where has_table_privilege(n, s, k)")
ASEL=$(q "select has_table_privilege('anon','public.social_blocks','select')::text")
echo "privilegios de cliente: execute=$FPRIV escritura=$TPRIV anon_lee_bloqueos=$ASEL"
[ "$FPRIV$TPRIV$ASEL" = "00false" ] || stop "privilegios de cliente inesperados"
echo "política de lectura propia de bloqueos: $(q "select count(*) from pg_policies where tablename='social_blocks' and qual like '%uid() = blocker_id%'")"
echo "F83 temporada-2: $(q "select status from public.game_seasons where id='temporada-2'")"
echo "APPLY_OK 0066"
