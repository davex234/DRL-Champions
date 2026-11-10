#!/usr/bin/env bash
# =============================================================================
# F84 · DRY-RUN de 0065 + CARRERAS REALES en Postgres + ROLLBACK — sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   (desde el PC)  scp 0065_ranked_competitive.sql 0065_ranked_competitive.ROLLBACK.sql _f84-dryrun.sh nexusadmin@VPS:/tmp/f84/
#                  ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0065/<TS> bash /tmp/f84/_f84-dryrun.sh'
#
# 1. Postgres DESECHABLE (misma imagen, `--network none`) restaurado del backup pre-0065.
# 2. Huellas de las tablas de jugadores/economía/competitivo/F82/F83/F89 antes y después (0065 no cambia ningún dato).
# 3. Libro histórico: versión de fórmula, temporada NULL, regla STANDARD; ratings intactos; T2 de F83 sigue en DRAFT.
# 4. Privilegios/RLS, inmutabilidad del libro y guardia de escritura del rating (también contra service_role).
# 5. Con usuarios SINTÉTICOS (solo en la copia): liquidación ×20 en paralelo, colocación 5/5, pico, tope de pareja,
#    10 liquidaciones concurrentes de la misma pareja, privado/PvE/abandono/no-competitiva/sin culpable, cadena
#    old=new previa, récord = libro, clasificación (vista) y su plan, fin de temporada + foto idempotente, reinicio
#    suave ledgerizado, corrección auditada, guardas de la temporada, borrado de cuenta en cascada.
# 6. Rollback (fichero) → la liquidación vuelve byte a byte a la de producción (md5) → 0065 se re-aplica y es re-ejecutable.
# Salida: PASS/FAIL y `DRYRUN_OK` / `DRYRUN_FAIL`. El contenedor se borra pase lo que pase.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f84-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
SR() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "set role service_role; $1" </dev/null 2>&1; }

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
docker cp "$DIR/0065_ranked_competitive.sql" "$NAME:/tmp/0065.sql" >/dev/null
docker cp "$DIR/0065_ranked_competitive.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0064: game_seasons existe" "$(P "select to_regclass('public.game_seasons') is not null")" "t"
check "copia en 0064: sin competitive_seasons" "$(P "select to_regclass('public.competitive_seasons') is null")" "t"
SETTLE_MD5_PROD="$(P "select md5(pg_get_functiondef('public.duel_pvp_settle_match(uuid)'::regprocedure))")"
echo "   md5 de la liquidación en la copia (= producción): $SETTLE_MD5_PROD"

TABLES="auth.users public.profiles public.user_cards public.user_packs public.user_game public.user_pass public.economy_ops public.credit_transactions public.duel_matches public.duel_pvp_ratings public.duel_pvp_queue public.duel_decks public.user_cosmetics public.collection_sets public.user_collection_completions public.player_profile_customization public.game_seasons public.season_xp_ledger public.season_progress public.mission_events"
fingerprint() {
  for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done
  # El libro gana columnas: su huella se mide sobre las columnas ORIGINALES.
  printf 'rating_events %s\n' "$(P "select count(*)||':'||md5(string_agg(concat_ws(',',id,match_id,user_id,old_rating,delta,new_rating,opponent_rating,k_factor,result,created_at), '|' order by id)) from public.duel_pvp_rating_events")"
}
fingerprint > /tmp/$NAME.before
PRIV_BEFORE=$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.duel_pvp_rating_events'),('public.duel_pvp_ratings')) t(s) cross join (values ('insert'),('update'),('delete')) p(k) where has_table_privilege(n, s, k)")
HIST_EVENTS=$(P "select count(*) from public.duel_pvp_rating_events")
echo "== huellas antes: $(wc -l < /tmp/$NAME.before) tablas · asientos históricos: $HIST_EVENTS"
T0=$(date +%s%N)
APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0065.sql </dev/null 2>&1); RC=$?
check "0065 aplica en UNA transacción (exit)" "$RC" "0"
[ "$RC" = 0 ] || echo "$APPLY" | tail -5
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms · $(echo "$APPLY" | grep -c ERROR) errores"
fingerprint > /tmp/$NAME.after
check "0065 no cambia NINGÚN dato existente (huellas, libro por columnas originales)" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || echo distintas)" "iguales"
check "histórico: todos los asientos con formula_version=ranked-rating-v1, sin temporada, STANDARD" "$(P "select count(*) from public.duel_pvp_rating_events where formula_version='ranked-rating-v1' and competitive_season_id is null and season_match_number is null and rule='STANDARD'")" "$HIST_EVENTS"
check "Temporada competitiva 1 publicada, abierta, rank-v1, 5 de colocación" "$(P "select status||'|'||(ends_at is null)||'|'||rank_config_version||'|'||placement_games||'|'||(starts_at <= now()) from public.competitive_seasons where id='competitiva-1'")" "PUBLISHED|true|rank-v1|5|true"
check "temporada activa por hora de BD" "$(P "select id from public.competitive_active_season()")" "competitiva-1"
check "F83: temporada-2 sigue en DRAFT y no se enlaza" "$(P "select coalesce((select status from public.game_seasons where id='temporada-2'),'—')||'|'||(select count(*) from public.competitive_seasons where game_season_id is not null)")" "DRAFT|0"
check "sin récord de temporada ni ajustes al nacer (no se inventa historia)" "$(P "select (select count(*) from public.competitive_season_players)+(select count(*) from public.competitive_rating_adjustments)+(select count(*) from public.competitive_season_snapshots)")" "0"

# ── privilegios / RLS ──
check "privilegios: anon/authenticated sin EXECUTE en settle/close/seed/correct/active" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.duel_pvp_settle_match(uuid)'),('public.competitive_season_close(text)'),('public.competitive_season_seed(text)'),('public.competitive_rating_correct(uuid,int,text,uuid,text)'),('public.competitive_active_season()')) f(s) where has_function_privilege(n, s, 'execute')")" "0"
check "privilegios: anon/authenticated sin escritura en las tablas NUEVAS" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.competitive_seasons'),('public.competitive_season_players'),('public.competitive_rating_adjustments'),('public.competitive_season_snapshots')) t(s) cross join (values ('insert'),('update'),('delete')) p(k) where has_table_privilege(n, s, k)")" "0"
# La copia restaurada con --no-owner trae concesiones distintas a producción en tablas EXISTENTES (trampa F89): aquí solo se
# exige que 0065 no las AMPLÍE; en producción se comprueba que siguen en 0 (apply script).
check "privilegios: 0065 no amplía concesiones en el libro/ratings existentes" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.duel_pvp_rating_events'),('public.duel_pvp_ratings')) t(s) cross join (values ('insert'),('update'),('delete')) p(k) where has_table_privilege(n, s, k)")" "$PRIV_BEFORE"
check "privilegios: vistas de clasificación y libro solo para el servidor" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join (values ('public.competitive_ladder'),('public.competitive_rating_ledger')) t(s) where has_table_privilege(n, s, 'select')")" "0"
check "privilegios: la función interna del récord no es invocable ni por service_role" "$(P "select has_function_privilege('service_role','public._competitive_season_record(public.competitive_seasons,uuid,int,int,text,int)','execute')::text")" "false"
check "RLS: lectura propia en récord/ajustes/foto + temporadas publicadas" "$(P "select count(*) from pg_policies where schemaname='public' and ((tablename in ('competitive_season_players','competitive_rating_adjustments','competitive_season_snapshots') and qual like '%uid() = user_id%') or (tablename='competitive_seasons' and qual like '%PUBLISHED%'))")" "4"
check "RLS: el libro y los ratings siguen SIN políticas (solo servidor)" "$(P "select count(*) from pg_policies where schemaname='public' and tablename in ('duel_pvp_rating_events','duel_pvp_ratings')")" "0"

# ── inmutabilidad y guardia ──
ANY_EV=$(P "select id from public.duel_pvp_rating_events order by id limit 1")
check "libro inmutable: UPDATE rechazado" "$(P "update public.duel_pvp_rating_events set delta=delta where id=$ANY_EV" | grep -c RATING_LEDGER_IMMUTABLE)" "1"
check "libro inmutable: DELETE directo rechazado" "$(P "delete from public.duel_pvp_rating_events where id=$ANY_EV" | grep -c RATING_LEDGER_IMMUTABLE)" "1"
ANY_R=$(P "select user_id from public.duel_pvp_ratings where games_played > 0 order by user_id limit 1")
check "guardia: UPDATE suelto del rating rechazado (superusuario)" "$(P "update public.duel_pvp_ratings set rating=rating+1 where user_id='$ANY_R'" | grep -c RATING_WRITE_GUARD)" "1"
check "guardia: UPDATE suelto del rating rechazado (service_role)" "$(SR "update public.duel_pvp_ratings set wins=wins+1 where user_id='$ANY_R'" | grep -c RATING_WRITE_GUARD)" "1"
check "guardia: ficha nueva solo en 1000/0" "$(P "insert into public.duel_pvp_ratings (user_id, rating) values ('$ANY_R', 2000)" | grep -c RATING_WRITE_GUARD)" "1"

# ── usuarios sintéticos y partidas ──
newuser() { local u; u=$(P "select gen_random_uuid()"); P "insert into auth.users (id,email,aud,role,instance_id) values ('$u','f84dry-$u@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')" >/dev/null; echo "$u"; }
DECK=$(P "select id from public.duel_decks order by id limit 1")
mkm() { # a b mode status winner closed_reason closed_by
  local cr="null" cb="null" ca="null" w="null"
  [ "$5" != "-" ] && w="'$5'"
  [ "$6" != "-" ] && { cr="'$6'"; cb="'$7'"; ca="now()"; }
  P "insert into public.duel_matches (user_id, player_b_id, deck_id, deck_b_id, difficulty, status, state, rng, rules_version, winner, mode, closed_reason, closed_by, closed_at)
     values ('$1', $( [ "$2" = "-" ] && echo null || echo "'$2'" ), '$DECK', $( [ "$2" = "-" ] && echo null || echo "'$DECK'" ), 'NORMAL', '$4', '{}', '{}', 'f84', $w, '$3', $cr, $cb, $ca) returning id" | head -1
}
settle() { P "select public.duel_pvp_settle_match('$1')->>'code'"; }
UA=$(newuser); UB=$(newuser); UC=$(newuser); UD=$(newuser); UE=$(newuser)
echo "== sintéticos: A B C D E creados (solo en la copia)"

# A · 20 liquidaciones de la MISMA partida en paralelo
M1=$(mkm "$UA" "$UB" PVP COMPLETED A - -)
for i in $(seq 1 20); do settle "$M1" > /tmp/$NAME.a.$i & done; wait
check "A: 20 liquidaciones a la vez → 1 SETTLED" "$(cat /tmp/$NAME.a.* | grep -c '^SETTLED$')" "1"
check "A: … y 19 ALREADY_SETTLED" "$(cat /tmp/$NAME.a.* | grep -c '^ALREADY_SETTLED$')" "19"
check "A: 2 asientos, temporada sellada, número 1" "$(P "select count(*)||'|'||min(competitive_season_id)||'|'||max(season_match_number)||'|'||min(formula_version) from public.duel_pvp_rating_events where match_id='$M1'")" "2|competitiva-1|1|ranked-rating-v1"
check "A: récord de temporada = 1 partida por jugador" "$(P "select string_agg(matches::text, ',' order by user_id) from public.competitive_season_players where user_id in ('$UA','$UB')")" "1,1"
check "A: delta = Elo de 0035 (K40, 1000 vs 1000 → ±20)" "$(P "select string_agg(delta::text, ',' order by delta) from public.duel_pvp_rating_events where match_id='$M1'")" "-20,20"

# B · colocación completa (5) y pico
for w in A B A A; do M=$(mkm "$UA" "$UB" PVP COMPLETED $w - -); settle "$M" >/dev/null; done
check "B: A con 5 partidas de temporada y colocación completa" "$(P "select matches||'|'||(placement_completed_at is not null)||'|'||(peak_ranked_rating = (select new_rating from public.duel_pvp_rating_events where user_id='$UA' and season_match_number=5)) from public.competitive_season_players where user_id='$UA'")" "5|true|true"
check "B: pico de temporada = máximo new_rating de sus asientos" "$(P "select (peak_rating = (select max(new_rating) from public.duel_pvp_rating_events where user_id='$UA' and competitive_season_id='competitiva-1'))::text from public.competitive_season_players where user_id='$UA'")" "true"

# C · tope de pareja: la 6.ª partida A-B en 24 h no intercambia rating (pero cuenta como partida)
RA_BEFORE=$(P "select rating||'|'||games_played from public.duel_pvp_ratings where user_id='$UA'")
M6=$(mkm "$UA" "$UB" PVP COMPLETED A - -)
check "C: 6.ª partida de la pareja → SETTLED" "$(settle "$M6")" "SETTLED"
check "C: regla PAIR_CAP, K 0, delta 0 en los dos asientos" "$(P "select string_agg(rule||':'||k_factor||':'||delta, ',') from public.duel_pvp_rating_events where match_id='$M6'")" "PAIR_CAP:0:0,PAIR_CAP:0:0"
check "C: rating igual, partida contada" "$(P "select rating||'|'||(games_played-1) from public.duel_pvp_ratings where user_id='$UA'")" "${RA_BEFORE%|*}|${RA_BEFORE#*|}"
check "C: otra pareja (A-C) sí intercambia" "$(M=$(mkm "$UC" "$UA" PVP COMPLETED A - -); settle "$M" >/dev/null; P "select rule from public.duel_pvp_rating_events where user_id='$UC' order by id desc limit 1")" "STANDARD"

# D · 10 partidas distintas de la MISMA pareja (D-E) liquidadas a la vez → exactamente 5 STANDARD + 5 PAIR_CAP
for i in $(seq 1 10); do mkm "$UD" "$UE" PVP COMPLETED A - - > /tmp/$NAME.dm.$i; done
for i in $(seq 1 10); do settle "$(cat /tmp/$NAME.dm.$i)" > /tmp/$NAME.d.$i & done; wait
check "D: 10 liquidaciones concurrentes → 10 SETTLED" "$(cat /tmp/$NAME.d.* | grep -c '^SETTLED$')" "10"
check "D: exactamente 5 STANDARD y 5 PAIR_CAP (D)" "$(P "select count(*) filter (where rule='STANDARD')||'|'||count(*) filter (where rule='PAIR_CAP') from public.duel_pvp_rating_events where user_id='$UD'")" "5|5"
check "D: números de partida contiguos 1..10 y récord = 10" "$(P "select string_agg(season_match_number::text, ',' order by season_match_number)||'|'||(select matches from public.competitive_season_players where user_id='$UD') from public.duel_pvp_rating_events where user_id='$UD'")" "1,2,3,4,5,6,7,8,9,10|10"

# E · lo que NO puntúa
MP=$(mkm "$UA" "$UC" PVP_PRIVATE COMPLETED A - -)
check "E: duelo privado → NOT_PVP, sin asientos" "$(settle "$MP")|$(P "select count(*) from public.duel_pvp_rating_events where match_id='$MP'")" "NOT_PVP|0"
MV=$(mkm "$UA" - PVE COMPLETED A - -)
check "E: PvE → NOT_PVP, sin asientos" "$(settle "$MV")|$(P "select count(*) from public.duel_pvp_rating_events where match_id='$MV'")" "NOT_PVP|0"
check "E: contra uno mismo imposible en BD (duel_matches_mode_shape)" "$(P "insert into public.duel_matches (user_id, player_b_id, deck_id, deck_b_id, difficulty, status, state, rng, rules_version, mode) values ('$UA','$UA','$DECK','$DECK','NORMAL','COMPLETED','{}','{}','f84','PVP')" | grep -c duel_matches_mode_shape)" "1"
check "E: partida a medias → NOT_FINISHED" "$(settle "$(mkm "$UB" "$UC" PVP IN_PROGRESS - - -)")" "NOT_FINISHED"
MAB=$(mkm "$UB" "$UC" PVP IN_PROGRESS - ABANDONED "$UC")
check "E: abandono en juego → SETTLED y pierde quien se fue" "$(settle "$MAB")|$(P "select result from public.duel_pvp_rating_events where match_id='$MAB' and user_id='$UC'")" "SETTLED|LOSS"
check "E: abandono antes de empezar → NOT_COMPETITIVE" "$(settle "$(mkm "$UB" "$UC" PVP WAITING - ABANDONED "$UB")")" "NOT_COMPETITIVE"
check "E: cierre sin culpable conocido → NO_ABANDONER" "$(settle "$(mkm "$UB" "$UC" PVP IN_PROGRESS - EXPIRED "$UA")")" "NO_ABANDONER"
check "E: partida inexistente → NO_MATCH" "$(settle "$(P "select gen_random_uuid()")")" "NO_MATCH"

# F · invariantes
check "F: cadena old = new anterior para TODOS los jugadores (histórico + F84)" "$(P "with e as (select user_id, old_rating, lag(new_rating) over (partition by user_id order by created_at, seq) prev from public.competitive_rating_ledger) select count(*) from e where prev is not null and prev <> old_rating")" "0"
check "F: ficha = último asiento para todos" "$(P "with l as (select distinct on (user_id) user_id, new_rating from public.competitive_rating_ledger order by user_id, created_at desc, seq desc) select count(*) from l join public.duel_pvp_ratings r using (user_id) where r.rating <> l.new_rating")" "0"
check "F: récord de temporada = agregado del libro" "$(P "with a as (select user_id, count(*) n, count(*) filter (where result='WIN') w, count(*) filter (where result='LOSS') l, max(new_rating) pk from public.duel_pvp_rating_events where competitive_season_id='competitiva-1' group by 1) select count(*) from a join public.competitive_season_players p on p.user_id=a.user_id and p.season_id='competitiva-1' where p.matches<>a.n or p.wins<>a.w or p.losses<>a.l or p.peak_rating<>a.pk")" "0"
check "F: deltas reproducibles con K/rival/resultado" "$(P "select count(*) from public.duel_pvp_rating_events e where e.delta <> (least(5000, greatest(0, e.old_rating + round(e.k_factor * ((case e.result when 'WIN' then 1.0 when 'LOSS' then 0.0 else 0.5 end) - 1.0/(1.0+power(10.0,(e.opponent_rating - e.old_rating)/400.0))))::int)) - e.old_rating)")" "0"

# G · clasificación (vista)
check "G: A en la clasificación (colocación + ≥5 + actividad); C fuera" "$(P "select (select count(*) from public.competitive_ladder where user_id='$UA')||'|'||(select count(*) from public.competitive_ladder where user_id='$UC')")" "1|0"
check "G: históricos sin partidas de temporada NO aparecen (no se inventa colocación)" "$(P "select count(*) from public.competitive_ladder l where not exists (select 1 from auth.users u where u.id=l.user_id and u.email like 'f84dry-%')")" "0"
echo "   plan de la clasificación:"; P "explain analyze select user_id, rating from public.competitive_ladder where season_id='competitiva-1' order by rating desc, updated_at asc, user_id asc limit 25" | sed 's/^/     /' | head -14

# H · guardas de la temporada publicada
check "H: publicada inmutable (config)" "$(P "update public.competitive_seasons set config = config || '{\"x\":1}' where id='competitiva-1'" | grep -c COMPETITIVE_SEASON_IMMUTABLE)" "1"
check "H: final en el pasado rechazado" "$(P "update public.competitive_seasons set ends_at = now() - interval '1 day' where id='competitiva-1'" | grep -c COMPETITIVE_SEASON_TRANSITION)" "1"
check "H: no se cancela una empezada" "$(P "update public.competitive_seasons set status='CANCELLED', cancelled_at=now() where id='competitiva-1'" | grep -c COMPETITIVE_SEASON_TRANSITION)" "1"
check "H: no se borra una publicada" "$(P "delete from public.competitive_seasons where id='competitiva-1'" | grep -c COMPETITIVE_SEASON_IMMUTABLE)" "1"
check "H: nace DRAFT" "$(P "insert into public.competitive_seasons (id, number, name, status, starts_at, rank_config_version, formula_version, placement_games, config) values ('x-pub', 9, 'Ensayo', 'PUBLISHED', now() + interval '400 days', 'rank-v1', 'ranked-rating-v1', 5, '{\"top\":{\"size\":500,\"minSeasonMatches\":5,\"activeDays\":14},\"pairCap\":{\"matches\":5,\"hours\":24},\"reset\":null}')" | grep -c COMPETITIVE_SEASON_TRANSITION)" "1"
check "H: cerrar antes del final rechazado" "$(P "select public.competitive_season_close('competitiva-1')->>'code'")" "NOT_ENDED"

# I · corrección auditada
check "I: corrección sin motivo → REASON_REQUIRED" "$(P "select public.competitive_rating_correct('$UB', 10, 'corto', null, 'ensayo-1')->>'code'")" "REASON_REQUIRED"
RB0=$(P "select rating from public.duel_pvp_ratings where user_id='$UB'")
check "I: corrección válida → CORRECTED (+10) y asiento" "$(P "select public.competitive_rating_correct('$UB', 10, 'Ensayo de corrección auditada F84', null, 'ensayo-1')->>'code'")|$(P "select rating - $RB0 from public.duel_pvp_ratings where user_id='$UB'")|$(P "select count(*) from public.competitive_rating_adjustments where ref='correct:ensayo-1'")" "CORRECTED|10|1"
check "I: repetir la misma referencia → ALREADY_APPLIED (sin doble)" "$(P "select public.competitive_rating_correct('$UB', 10, 'Ensayo de corrección auditada F84', null, 'ensayo-1')->>'code'")|$(P "select rating - $RB0 from public.duel_pvp_ratings where user_id='$UB'")" "ALREADY_APPLIED|10"
check "I: ajuste inmutable" "$(P "update public.competitive_rating_adjustments set delta = 0 where ref='correct:ensayo-1'" | grep -c RATING_LEDGER_IMMUTABLE)" "1"

# J · fin de temporada, foto, temporada siguiente con reinicio suave
P "update public.competitive_seasons set ends_at = now() + interval '3 seconds' where id='competitiva-1'" >/dev/null
check "J: el final se fija UNA vez" "$(P "update public.competitive_seasons set ends_at = now() + interval '9 days' where id='competitiva-1'" | grep -c COMPETITIVE_SEASON_IMMUTABLE)" "1"
sleep 4
check "J: sin temporada activa tras el final" "$(P "select count(*) from public.competitive_active_season() where id is not null")" "0"
MX=$(mkm "$UA" "$UC" PVP COMPLETED A - -)
check "J: partida tras el final → asiento sin temporada (y sin récord nuevo)" "$(settle "$MX")|$(P "select count(*) from public.duel_pvp_rating_events where match_id='$MX' and competitive_season_id is null")" "SETTLED|2"
for i in 1 2 3; do P "select public.competitive_season_close('competitiva-1')->>'snapshots'" > /tmp/$NAME.close.$i & done; wait
check "J: 3 cierres a la vez → fotos exactamente una vez" "$(P "select count(*) from public.competitive_season_snapshots where season_id='competitiva-1'")|$(P "select count(*) from public.competitive_season_players where season_id='competitiva-1'")" "$(P "select count(*) from public.competitive_season_players where season_id='competitiva-1'")|$(P "select count(*) from public.competitive_season_players where season_id='competitiva-1'")"
check "J: foto de A = rating de su última partida de temporada" "$(P "select (final_rating = (select new_rating from public.duel_pvp_rating_events where user_id='$UA' and competitive_season_id='competitiva-1' order by season_match_number desc limit 1))::text from public.competitive_season_snapshots where user_id='$UA'")" "true"
check "J: closed_at fijado y la foto es inmutable" "$(P "select (closed_at is not null)::text from public.competitive_seasons where id='competitiva-1'")|$(P "update public.competitive_season_snapshots set final_rating=0 where user_id='$UA'" | grep -c RATING_LEDGER_IMMUTABLE)" "true|1"
P "insert into public.competitive_seasons (id, number, name, status, starts_at, rank_config_version, formula_version, placement_games, config) values ('competitiva-2', 2, 'Ensayo 2', 'DRAFT', now(), 'rank-v1', 'ranked-rating-v1', 5, '{\"top\":{\"size\":500,\"minSeasonMatches\":5,\"activeDays\":14},\"pairCap\":{\"matches\":5,\"hours\":24},\"reset\":{\"baseline\":1000,\"factor\":0.5}}')" >/dev/null
P "update public.competitive_seasons set status='PUBLISHED', published_at=now() where id='competitiva-2'" >/dev/null
check "J: temporada 2 activa" "$(P "select id from public.competitive_active_season()")" "competitiva-2"
RATED=$(P "select count(*) from public.duel_pvp_ratings where games_played > 0")
EXP_A=$(P "select least(5000, greatest(0, round(1000 + 0.5 * (rating - 1000))))::int from public.duel_pvp_ratings where user_id='$UA'")
for i in 1 2; do P "select public.competitive_season_seed('competitiva-2')->>'players'" > /tmp/$NAME.seed.$i & done; wait
check "J: reinicio suave ×2 a la vez → un asiento por jugador con partidas" "$(P "select count(*) from public.competitive_rating_adjustments where season_id='competitiva-2' and reason='SEASON_SEED'")" "$RATED"
check "J: semilla = 1000 + 0,5 × (rating − 1000)" "$(P "select rating from public.duel_pvp_ratings where user_id='$UA'")" "$EXP_A"
check "J: cadena intacta con semillas (old = new previo, incluidos ajustes)" "$(P "with e as (select user_id, old_rating, lag(new_rating) over (partition by user_id order by created_at, seq) prev from public.competitive_rating_ledger) select count(*) from e where prev is not null and prev <> old_rating")" "0"
check "J: la temporada 2 empieza la colocación de cero" "$(settle "$(mkm "$UA" "$UC" PVP COMPLETED A - -)")|$(P "select season_match_number from public.duel_pvp_rating_events where user_id='$UA' and competitive_season_id='competitiva-2'")" "SETTLED|1"

# K · borrado de cuenta en cascada (el libro deja borrar SOLO así)
check "K: borrar una cuenta sintética arrastra sus asientos en cascada" "$(P "delete from auth.users where id='$UE'" >/dev/null; P "select count(*) from public.duel_pvp_rating_events where user_id='$UE'")" "0"

# L · rollback y re-aplicación
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/rollback.sql </dev/null 2>&1); RC=$?
check "L: rollback aplica (exit)" "$RC" "0"
[ "$RC" = 0 ] || echo "$RB" | tail -5
check "L: rollback → sin tablas/vistas/columnas de 0065" "$(P "select (to_regclass('public.competitive_seasons') is null and to_regclass('public.competitive_ladder') is null and to_regclass('public.competitive_season_players') is null)::text||'|'||(select count(*) from information_schema.columns where table_name='duel_pvp_rating_events' and column_name in ('formula_version','competitive_season_id','season_match_number','rule'))")" "true|0"
check "L: rollback → la liquidación es BYTE A BYTE la de producción (md5)" "$(P "select md5(pg_get_functiondef('public.duel_pvp_settle_match(uuid)'::regprocedure))")" "$SETTLE_MD5_PROD"
check "L: rollback → 0064 intacta (temporada-2 DRAFT)" "$(P "select status from public.game_seasons where id='temporada-2'")" "DRAFT"
docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0065.sql </dev/null >/dev/null 2>&1; RC=$?
check "L: 0065 se re-aplica tras el rollback" "$RC" "0"
docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0065.sql </dev/null >/dev/null 2>&1; RC=$?
check "L: 0065 es re-ejecutable (segunda vez, sin efectos)" "$RC|$(P "select count(*) from public.competitive_seasons")" "0|1"

echo "== $FAILS fallos"
[ "$FAILS" = 0 ] && echo "DRYRUN_OK" || echo "DRYRUN_FAIL"
