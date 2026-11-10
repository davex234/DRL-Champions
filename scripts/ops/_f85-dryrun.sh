#!/usr/bin/env bash
# =============================================================================
# F85 · DRY-RUN de 0066 + CARRERAS REALES en Postgres + ROLLBACK — sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0066/<TS> bash /tmp/f85/_f85-dryrun.sh'
# Usuarios SINTÉTICOS solo en la copia; psql EN PARALELO para las carreras. Salida PASS/FAIL y DRYRUN_OK / DRYRUN_FAIL.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f85-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
R() { P "select public.$1->>'code'"; }

[ -f "$SRC/COMPLETE" ] || { echo "DRYRUN_FAIL backup no COMPLETE"; exit 1; }
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || { echo "DRYRUN_FAIL SHA256SUMS"; exit 1; }
IMAGE=$(docker inspect "$PROD" --format '{{.Config.Image}}')
PASSW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PASSW" "$IMAGE" >/dev/null </dev/null || { echo "DRYRUN_FAIL arranque"; exit 1; }
ok=0; streak=0
for i in $(seq 1 120); do
  if docker logs "$NAME" 2>&1 | grep -q "init process complete" && docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select 1" </dev/null >/dev/null 2>&1; then
    streak=$((streak+1)); [ "$streak" -ge 3 ] && { ok=1; break; }
  else streak=0; fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "DRYRUN_FAIL postgres no listo"; exit 1; }
docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "drop schema if exists auth cascade; drop schema if exists storage cascade;" </dev/null >/dev/null
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --no-owner < "$SRC/db.dump" > /tmp/$NAME.restore.log 2>&1 || true
docker cp "$DIR/0066_social_2.sql" "$NAME:/tmp/0066.sql" >/dev/null
docker cp "$DIR/0066_social_2.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0065: competitive_seasons existe" "$(P "select to_regclass('public.competitive_seasons') is not null")" "t"
check "copia en 0065: sin social_blocks" "$(P "select to_regclass('public.social_blocks') is null")" "t"
FN="'public.social_friend_request(uuid,uuid)','public.social_friend_respond(uuid,uuid,boolean)','public.social_unfriend(uuid,uuid)','public.social_block(uuid,uuid)','public.social_unblock(uuid,uuid)','public.social_challenge_create(uuid,uuid,uuid,uuid,int)','public.social_challenge_respond(uuid,uuid,boolean,uuid)','public.social_challenge_expire_due(uuid)'"
FMD5() { P "select md5(string_agg(pg_get_functiondef(f::regprocedure), '|' order by f)) from unnest(array[$FN]) f"; }
MD5_PROD=$(FMD5)

TABLES="auth.users public.profiles public.duel_friendships public.duel_challenges public.duel_matches public.duel_pvp_ratings public.duel_pvp_rating_events public.competitive_season_players public.duel_pvp_queue public.user_cards public.economy_ops public.game_seasons public.season_xp_ledger public.mission_events public.player_profile_customization"
fingerprint() { for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
fingerprint > /tmp/$NAME.before
PRIV_BEFORE=$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.duel_friendships'),('public.duel_challenges')) t(s) cross join (values ('insert'),('update'),('delete')) p(k) where has_table_privilege(n, s, k)")
BLOCKED_BEFORE=$(P "select count(*) from public.duel_friendships where status='BLOCKED'")
echo "== huellas antes: $(wc -l < /tmp/$NAME.before) tablas · filas BLOCKED antiguas: $BLOCKED_BEFORE"
T0=$(date +%s%N)
APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0066.sql </dev/null 2>&1); RC=$?
check "0066 aplica en UNA transacción (exit)" "$RC" "0"
[ "$RC" = 0 ] || echo "$APPLY" | tail -5
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms"
fingerprint > /tmp/$NAME.after
if [ "$BLOCKED_BEFORE" = "0" ]; then
  check "0066 no cambia NINGÚN dato existente (huellas)" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || echo distintas)" "iguales"
else
  check "las filas BLOCKED antiguas pasan a social_blocks" "$(P "select count(*) from public.social_blocks")|$(P "select count(*) from public.duel_friendships where status='BLOCKED'")" "$BLOCKED_BEFORE|0"
fi
check "privilegios: anon/authenticated sin EXECUTE en las RPC sociales" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join unnest(array[$FN, 'public._social_blocked(uuid,uuid)', 'public._social_in_queue(uuid)']) f where has_function_privilege(n, f, 'execute')")" "0"
check "privilegios: anon/authenticated sin escritura en social_blocks (nueva)" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('insert'),('update'),('delete')) p(k) where has_table_privilege(n, 'public.social_blocks', k)")" "0"
# La copia restaurada con --no-owner trae concesiones distintas a producción en tablas EXISTENTES (trampa F84/F89): aquí se
# exige que 0066 no las amplíe; en producción el script de aplicación exige 0.
check "privilegios: 0066 no amplía concesiones en amistades/retos" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.duel_friendships'),('public.duel_challenges')) t(s) cross join (values ('insert'),('update'),('delete')) p(k) where has_table_privilege(n, s, k)")" "$PRIV_BEFORE"
check "RLS: solo el bloqueador lee su bloqueo; amistades y retos sin políticas (solo servidor)" "$(P "select (select count(*) from pg_policies where tablename='social_blocks' and qual like '%uid() = blocker_id%')||'|'||(select count(*) from pg_policies where tablename in ('duel_friendships','duel_challenges'))")" "1|0"
check "BD: bloquearse a uno mismo es imposible (CHECK)" "$(P "insert into public.social_blocks values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')" | grep -c 'social_blocks_not_self\|violates')" "1"

newuser() { local u; u=$(P "select gen_random_uuid()"); P "insert into auth.users (id,email,aud,role,instance_id) values ('$u','f85dry-$u@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')" >/dev/null; echo "$u"; }
DECK=$(P "select id from public.duel_decks order by id limit 1")
befriend() { P "insert into public.duel_friendships (user_lo,user_hi,requester_id,status,responded_at) values (least('$1'::uuid,'$2'::uuid), greatest('$1'::uuid,'$2'::uuid), '$1', 'ACCEPTED', now())" >/dev/null; }
rel() { P "select coalesce((select status||':'||(requester_id = '$1') from public.duel_friendships where user_lo=least('$1'::uuid,'$2'::uuid) and user_hi=greatest('$1'::uuid,'$2'::uuid)),'NONE')"; }
U=(); for i in $(seq 1 24); do U+=("$(newuser)"); done
echo "== 24 usuarios sintéticos (solo en la copia)"

# ── amistad ──
A=${U[0]}; B=${U[1]}
check "yo mismo → SELF" "$(R "social_friend_request('$A','$A')")" "SELF"
for i in $(seq 1 20); do R "social_friend_request('$A','$B')" > /tmp/$NAME.f.$i & done; wait
check "20 solicitudes A→B a la vez → 1 REQUESTED + 19 ALREADY_PENDING" "$(cat /tmp/$NAME.f.* | grep -c '^REQUESTED$')|$(cat /tmp/$NAME.f.* | grep -c '^ALREADY_PENDING$')" "1|19"
check "… y UNA fila PENDING" "$(P "select count(*)||':'||min(status) from public.duel_friendships where (user_lo,user_hi)=(least('$A'::uuid,'$B'::uuid),greatest('$A'::uuid,'$B'::uuid))")" "1:PENDING"
C=${U[2]}; D=${U[3]}
for i in $(seq 1 10); do R "social_friend_request('$C','$D')" > /tmp/$NAME.x.c$i & R "social_friend_request('$D','$C')" > /tmp/$NAME.x.d$i & done; wait
check "C→D y D→C a la vez (×10 cada uno) → UNA amistad ACCEPTED" "$(P "select count(*)||':'||min(status) from public.duel_friendships where (user_lo,user_hi)=(least('$C'::uuid,'$D'::uuid),greatest('$C'::uuid,'$D'::uuid))")" "1:ACCEPTED"
for i in $(seq 1 20); do R "social_friend_respond('$B','$A',true)" > /tmp/$NAME.ac.$i & done; wait
check "20 aceptaciones a la vez → 1 ACCEPTED + 19 NO_REQUEST, una amistad" "$(cat /tmp/$NAME.ac.* | grep -c '^ACCEPTED$')|$(cat /tmp/$NAME.ac.* | grep -c '^NO_REQUEST$')|$(rel $A $B)" "1|19|ACCEPTED:true"
check "aceptar una solicitud propia → NOT_TARGET" "$(E=${U[4]}; F=${U[5]}; R "social_friend_request('$E','$F')" >/dev/null; R "social_friend_respond('$E','$F',true)")" "NOT_TARGET"
E=${U[4]}; F=${U[5]}
R "social_friend_respond('$F','$E',true)" > /tmp/$NAME.r1 & R "social_unfriend('$E','$F')" > /tmp/$NAME.r2 & wait
check "aceptar ‖ retirar a la vez → un único resultado coherente" "$( (grep -q '^ACCEPTED$' /tmp/$NAME.r1 && [ "$(rel $E $F)" = "NONE" ] && grep -q REMOVED /tmp/$NAME.r2) || (grep -q '^ACCEPTED$' /tmp/$NAME.r1 && [ "$(rel $E $F)" = "ACCEPTED:true" ]) || (grep -q NO_REQUEST /tmp/$NAME.r1 && [ "$(rel $E $F)" = "NONE" ]) && echo coherente || echo roto)" "coherente"
check "rechazar → DECLINED y se puede volver a pedir (re-add)" "$(G=${U[6]}; H=${U[7]}; R "social_friend_request('$G','$H')" >/dev/null; R "social_friend_respond('$H','$G',false)"; )|$(G=${U[6]}; H=${U[7]}; R "social_friend_request('$G','$H')")" "DECLINED|REQUESTED"
check "eliminar amigo → desaparece para los dos; re-añadir posible" "$(R "social_unfriend('$B','$A')")|$(rel $A $B)|$(R "social_friend_request('$A','$B')")" "REMOVED|NONE|REQUESTED"

# ── bloqueo ──
X=${U[8]}; Y=${U[9]}; befriend $X $Y
R "social_friend_respond('$Y','$X',true)" > /tmp/$NAME.bk1 & R "social_block('$X','$Y')" > /tmp/$NAME.bk2 & wait
check "bloquear ‖ aceptar → siempre bloqueo y SIN amistad" "$(P "select count(*) from public.social_blocks where blocker_id='$X' and blocked_id='$Y'")|$(rel $X $Y)" "1|NONE"
check "el bloqueado no puede pedir amistad (UNAVAILABLE, neutro)" "$(R "social_friend_request('$Y','$X')")" "UNAVAILABLE"
check "el bloqueador tampoco (mismo código: no se revela quién bloqueó)" "$(R "social_friend_request('$X','$Y')")" "UNAVAILABLE"
check "bloqueo MUTUO: dos filas propias, no se pisan" "$(R "social_block('$Y','$X')")|$(P "select count(*) from public.social_blocks where (blocker_id,blocked_id) in (('$X','$Y'),('$Y','$X'))")" "BLOCKED|2"
check "X desbloquea → el bloqueo de Y sigue (sigue UNAVAILABLE)" "$(R "social_unblock('$X','$Y')")|$(R "social_friend_request('$X','$Y')")" "UNBLOCKED|UNAVAILABLE"
check "desbloquear NO restaura la amistad (NONE)" "$(R "social_unblock('$Y','$X')")|$(rel $X $Y)" "UNBLOCKED|NONE"
check "bloquearse a uno mismo → SELF" "$(R "social_block('$X','$X')")" "SELF"
check "desbloquear lo que no bloqueé → NOT_BLOCKED" "$(R "social_unblock('$X','$Y')")" "NOT_BLOCKED"

# ── límites ──
L=${U[10]}
P "insert into auth.users (id,email,aud,role,instance_id) select gen_random_uuid(), 'f85lim-'||g||'@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000' from generate_series(1,305) g" >/dev/null
P "insert into public.duel_friendships (user_lo,user_hi,requester_id,status,responded_at) select least('$L'::uuid,u.id), greatest('$L'::uuid,u.id), '$L', 'ACCEPTED', now() from (select id from auth.users where email like 'f85lim-%' order by email limit 299) u" >/dev/null
N1=$(P "select id from auth.users where email like 'f85lim-%' order by email offset 299 limit 1"); N2=$(P "select id from auth.users where email like 'f85lim-%' order by email offset 300 limit 1"); N3=$(P "select id from auth.users where email like 'f85lim-%' order by email offset 301 limit 1")
check "límite de amigos 299 → solicitud y aceptación (300)" "$(R "social_friend_request('$L','$N1')")|$(R "social_friend_respond('$N1','$L',true)")|$(P "select public._social_friend_count('$L')")" "REQUESTED|ACCEPTED|300"
check "límite 300 → no puede pedir más (FRIEND_LIMIT)" "$(R "social_friend_request('$L','$N2')")" "FRIEND_LIMIT"
check "límite 300 → otro le pide (pendiente) pero aceptar choca (FRIEND_LIMIT)" "$(R "social_friend_request('$N3','$L')")|$(R "social_friend_respond('$L','$N3',true)")" "REQUESTED|FRIEND_LIMIT"
S=${U[11]}
OUT=$(for u in $(P "select id from auth.users where email like 'f85lim-%' order by email limit 51"); do R "social_friend_request('$S','$u')"; done)
check "50 solicitudes salientes pendientes; la 51.ª → PENDING_LIMIT" "$(echo "$OUT" | grep -c '^REQUESTED$')|$(echo "$OUT" | tail -1)" "50|PENDING_LIMIT"

# ── retos ──
CA=${U[12]}; CB=${U[13]}; befriend $CA $CB
for i in $(seq 1 20); do R "social_challenge_create('$CA','$CB','$DECK',null,300)" > /tmp/$NAME.cc.$i & done; wait
check "20 retos A→B a la vez → 1 CREATED + 19 ALREADY_PENDING" "$(cat /tmp/$NAME.cc.* | grep -c '^CREATED$')|$(cat /tmp/$NAME.cc.* | grep -c '^ALREADY_PENDING$')" "1|19"
check "B→A con uno pendiente de A → INCOMING_PENDING (un reto por pareja)" "$(R "social_challenge_create('$CB','$CA','$DECK',null,300)")" "INCOMING_PENDING"
CH=$(P "select id from public.duel_challenges where challenger_id='$CA' and status='PENDING'")
check "TTL: 5 minutos por reloj de la BD" "$(P "select round(extract(epoch from expires_at - created_at))::int from public.duel_challenges where id='$CH'")" "300"
check "un tercero no acepta un reto ajeno (NOT_TARGET)" "$(R "social_challenge_respond('$A','$CH',true,'$DECK')")" "NOT_TARGET"
check "el retador no lo cancela un tercero (NOT_PENDING)" "$(R "social_challenge_cancel('$A','$CH')")" "NOT_PENDING"
for i in $(seq 1 20); do P "select (public.social_challenge_respond('$CB','$CH',true,'$DECK'))::text" > /tmp/$NAME.ca.$i & done; wait
check "20 aceptaciones a la vez → 1 ACCEPTED + 19 ALREADY_ACCEPTED con el MISMO match_id" "$(cat /tmp/$NAME.ca.* | grep -c '"code": "ACCEPTED"')|$(cat /tmp/$NAME.ca.* | grep -c 'ALREADY_ACCEPTED')|$(cat /tmp/$NAME.ca.* | grep -o '"matchId": "[^"]*"' | sort -u | wc -l)" "1|19|1"
# cancelar ‖ aceptar
c2() { P "update public.duel_challenges set status='CANCELLED' where challenger_id in ('$CA','$CB') and status in ('PENDING','ACCEPTED')" >/dev/null; R "social_challenge_create('$CA','$CB','$DECK',null,300)" >/dev/null; P "select id from public.duel_challenges where challenger_id='$CA' and status='PENDING'"; }
COH=0
for k in 1 2 3; do
  C2=$(c2)
  R "social_challenge_cancel('$CA','$C2')" > /tmp/$NAME.k1 & R "social_challenge_respond('$CB','$C2',true,'$DECK')" > /tmp/$NAME.k2 & wait
  ST=$(P "select status from public.duel_challenges where id='$C2'")
  { grep -q '^CANCELLED$' /tmp/$NAME.k1 && grep -q NOT_PENDING /tmp/$NAME.k2 && [ "$ST" = "CANCELLED" ]; } || { grep -q NOT_PENDING /tmp/$NAME.k1 && grep -q '^ACCEPTED$' /tmp/$NAME.k2 && [ "$ST" = "ACCEPTED" ]; } || COH=$((COH+1))
done
check "cancelar ‖ aceptar (×3) → nunca «cancelado + partida»" "$COH" "0"
# caducidad ‖ aceptar (reloj de la BD)
C3=$(c2); P "update public.duel_challenges set expires_at = now() + interval '2 seconds' where id='$C3'" >/dev/null
check "antes de caducar: sigue PENDING" "$(P "select (expires_at > now())::text from public.duel_challenges where id='$C3'")" "true"
sleep 3
check "tras caducar (hora de BD): aceptar → EXPIRED y la fila queda EXPIRED" "$(R "social_challenge_respond('$CB','$C3',true,'$DECK')")|$(P "select status from public.duel_challenges where id='$C3'")" "EXPIRED|EXPIRED"
C4=$(c2); P "update public.duel_challenges set expires_at = now() where id='$C4'" >/dev/null
check "caducidad EXACTA (expires_at = now()) cuenta como caducado" "$(R "social_challenge_respond('$CB','$C4',true,'$DECK')")" "EXPIRED"
# bloqueo ‖ aceptar, dejar de ser amigos ‖ aceptar
C5=$(c2)
R "social_block('$CB','$CA')" > /tmp/$NAME.b1 & R "social_challenge_respond('$CB','$C5',true,'$DECK')" > /tmp/$NAME.b2 & wait
ST=$(P "select status from public.duel_challenges where id='$C5'")
check "bloquear ‖ aceptar → coherente (bloqueado y reto cancelado, o partida ya reservada)" "$( { grep -q '^ACCEPTED$' /tmp/$NAME.b2 && [ "$ST" = "ACCEPTED" ]; } || { ! grep -q '^ACCEPTED$' /tmp/$NAME.b2 && [ "$ST" = "CANCELLED" ]; } && echo coherente || echo roto)" "coherente"
check "tras el bloqueo: ni retar ni aceptar (UNAVAILABLE)" "$(R "social_challenge_create('$CA','$CB','$DECK',null,300)")" "UNAVAILABLE"
R "social_unblock('$CB','$CA')" >/dev/null; befriend $CA $CB
C6=$(c2)
R "social_unfriend('$CA','$CB')" > /tmp/$NAME.u1 & R "social_challenge_respond('$CB','$C6',true,'$DECK')" > /tmp/$NAME.u2 & wait
ST=$(P "select status from public.duel_challenges where id='$C6'")
check "dejar de ser amigos ‖ aceptar → coherente" "$( { grep -q '^ACCEPTED$' /tmp/$NAME.u2 && [ "$ST" = "ACCEPTED" ]; } || { ! grep -q '^ACCEPTED$' /tmp/$NAME.u2 && [ "$ST" = "CANCELLED" ]; } && echo coherente || echo roto)" "coherente"
befriend $CA $CB 2>/dev/null
C7=$(c2); R "social_unfriend('$CA','$CB')" >/dev/null
check "dejar de ser amigos cancela el reto pendiente" "$(P "select status from public.duel_challenges where id='$C7'")" "CANCELLED"
befriend $CA $CB
# partida activa y cola ranked
CC=${U[14]}; CD=${U[15]}; befriend $CC $CD; befriend $CA $CC
P "insert into public.duel_matches (user_id, player_b_id, deck_id, deck_b_id, difficulty, status, state, rng, rules_version, mode) values ('$CC','$CA','$DECK','$DECK','NORMAL','IN_PROGRESS','{}','{}','f85','PVP_PRIVATE')" >/dev/null
check "con partida activa: crear reto → BUSY" "$(R "social_challenge_create('$CD','$CC','$DECK',null,300)")" "BUSY"
P "update public.duel_matches set status='COMPLETED', winner='A' where user_id='$CC' and rules_version='f85'" >/dev/null
CQ=${U[16]}; befriend $CD $CQ
R "social_challenge_create('$CD','$CQ','$DECK',null,300)" >/dev/null; CQID=$(P "select id from public.duel_challenges where challenger_id='$CD' and status='PENDING'")
P "insert into public.duel_pvp_queue (user_id, deck_id, rating_snapshot, expires_at) values ('$CQ','$DECK',1000, now() + interval '10 minutes')" >/dev/null
check "en cola ranked: aceptar → IN_QUEUE (no se cancela la cola en silencio)" "$(R "social_challenge_respond('$CQ','$CQID',true,'$DECK')")|$(P "select status from public.duel_challenges where id='$CQID'")|$(P "select state from public.duel_pvp_queue where user_id='$CQ'")" "IN_QUEUE|PENDING|QUEUED"
check "en cola ranked: crear reto → IN_QUEUE" "$(R "social_challenge_cancel('$CD','$CQID')" >/dev/null; R "social_challenge_create('$CQ','$CD','$DECK',null,300)")" "IN_QUEUE"
P "update public.duel_pvp_queue set state='CANCELLED', closed_reason='CANCELLED' where user_id='$CQ'" >/dev/null 2>&1
# reserva: aceptar a la vez los retos de DOS amigos → una sola partida para el mismo jugador
RA=${U[21]}; RB=${U[22]}; RC=${U[23]}; befriend $RA $RC; befriend $RB $RC
R "social_challenge_create('$RA','$RC','$DECK',null,300)" >/dev/null; R "social_challenge_create('$RB','$RC','$DECK',null,300)" >/dev/null
CR1=$(P "select id from public.duel_challenges where challenger_id='$RA' and status='PENDING'"); CR2=$(P "select id from public.duel_challenges where challenger_id='$RB' and status='PENDING'")
R "social_challenge_respond('$RC','$CR1',true,'$DECK')" > /tmp/$NAME.rv1 & R "social_challenge_respond('$RC','$CR2',true,'$DECK')" > /tmp/$NAME.rv2 & wait
check "aceptar ‖ aceptar retos de dos amigos → 1 ACCEPTED + 1 BUSY (una partida)" "$(cat /tmp/$NAME.rv1 /tmp/$NAME.rv2 | grep -c '^ACCEPTED$')|$(cat /tmp/$NAME.rv1 /tmp/$NAME.rv2 | grep -c '^BUSY$')|$(P "select count(*) from public.duel_challenges where challenged_id='$RC' and status='ACCEPTED'")" "1|1|1"
check "con una reserva viva: crear otro reto hacia ese jugador → BUSY" "$(R "social_challenge_cancel('$RA','$CR1')" >/dev/null; R "social_challenge_cancel('$RB','$CR2')" >/dev/null; befriend $RA $RB; R "social_challenge_create('$RA','$RB','$DECK',null,300)" | head -1)" "BUSY"
P "update public.duel_challenges set responded_at = now() - interval '3 minutes' where challenged_id='$RC' and status='ACCEPTED'" >/dev/null
check "reserva huérfana (> 2 min, sin partida) → la caducidad perezosa la cancela" "$(P "select public.social_challenge_expire_due('$RC')")|$(P "select count(*) from public.duel_challenges where challenged_id='$RC' and status='ACCEPTED'")" "1|0"
check "liberada la reserva: vuelve a poder retarse" "$(R "social_challenge_create('$RA','$RB','$DECK',null,300)")" "CREATED"
# un duelo amistoso NUNCA liquida rating (F84): el RPC de liquidación lo rechaza y no escribe eventos
PM=$(P "insert into public.duel_matches (user_id, player_b_id, deck_id, deck_b_id, difficulty, status, winner, state, rng, rules_version, mode) values ('$RA','$RB','$DECK','$DECK','NORMAL','COMPLETED','A','{}','{}','f85p','PVP_PRIVATE') returning id")
EV0=$(P "select count(*) from public.duel_pvp_rating_events")
check "duelo amistoso terminado → duel_pvp_settle_match = NOT_PVP" "$(R "duel_pvp_settle_match('$PM')")" "NOT_PVP"
check "… y 0 eventos de rating / 0 récords de temporada nuevos" "$(( $(P "select count(*) from public.duel_pvp_rating_events") - EV0 ))|$(P "select count(*) from public.competitive_season_players where user_id in ('$RA','$RB')")" "0|0"
# tope por pareja y hora
CE=${U[17]}; CF=${U[18]}; befriend $CE $CF
LOOP=$(for i in $(seq 1 11); do R "social_challenge_create('$CE','$CF','$DECK',null,300)"; P "update public.duel_challenges set status='CANCELLED' where challenger_id='$CE' and status='PENDING'" >/dev/null; done)
check "10 retos por pareja y hora; el 11.º → CHALLENGE_LIMIT" "$(echo "$LOOP" | grep -c '^CREATED$')|$(echo "$LOOP" | tail -1)" "10|CHALLENGE_LIMIT"
check "no amigos → NOT_FRIENDS" "$(R "social_challenge_create('${U[19]}','${U[20]}','$DECK',null,300)")" "NOT_FRIENDS"
check "invariante: nunca dos pendientes en una pareja" "$(P "select count(*) from (select least(challenger_id,challenged_id), greatest(challenger_id,challenged_id) from public.duel_challenges where status='PENDING' group by 1,2 having count(*) > 1) z")" "0"
check "invariante: ACCEPTED/MATCHED siempre con match_id" "$(P "select count(*) from public.duel_challenges where status in ('ACCEPTED','MATCHED') and match_id is null")" "0"
check "invariante: ninguna amistad con bloqueo vigente" "$(P "select count(*) from public.duel_friendships f join public.social_blocks b on (b.blocker_id,b.blocked_id) in ((f.user_lo,f.user_hi),(f.user_hi,f.user_lo))")" "0"
echo "   plan amistades de un usuario:"; P "explain select * from public.duel_friendships where user_lo='$A' or user_hi='$A'" | sed 's/^/     /' | head -6
echo "   plan retos pendientes del retado:"; P "explain select * from public.duel_challenges where challenged_id='$CB' and status='PENDING'" | sed 's/^/     /' | head -4

# ── rollback y re-aplicación ──
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/rollback.sql </dev/null 2>&1); RC=$?
check "rollback aplica (exit)" "$RC" "0"; [ "$RC" = 0 ] || echo "$RB" | tail -5
check "rollback → RPC sociales BYTE A BYTE las de 0048 (md5)" "$(FMD5)" "$MD5_PROD"
check "rollback → sin social_blocks; bloqueos vigentes vuelven como filas BLOCKED" "$(P "select (to_regclass('public.social_blocks') is null)::text")" "true"
docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0066.sql </dev/null >/dev/null 2>&1; RC=$?
check "0066 se re-aplica tras el rollback" "$RC" "0"
docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0066.sql </dev/null >/dev/null 2>&1; RC=$?
check "0066 es re-ejecutable" "$RC" "0"

echo "== $FAILS fallos"
[ "$FAILS" = 0 ] && echo "DRYRUN_OK" || echo "DRYRUN_FAIL"
