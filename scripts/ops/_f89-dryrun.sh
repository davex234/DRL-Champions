#!/usr/bin/env bash
# =============================================================================
# F89 · DRY-RUN de 0063 + CARRERAS REALES en Postgres + ROLLBACK — sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   (desde el PC)  scp 0063_profile_favorite_team.sql 0063_profile_favorite_team.ROLLBACK.sql _f89-dryrun.sh nexusadmin@VPS:/tmp/f89/
#                  ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0063/<TS> bash /tmp/f89/_f89-dryrun.sh'
#
# 1. Postgres DESECHABLE (misma imagen que producción, `--network none`) restaurado del backup pre-0063.
# 2. Huellas de las tablas de jugadores/economía/catálogo/F82 antes y después (0063 no toca ningún dato existente).
# 3. Contrato del RPC: SAVED / UNCHANGED / CONFLICT / BAD_TEAM / BAD_USER, null quita, la fila existente conserva vitrina,
#    logros e insignias (0049/0062) y comparte su versión.
# 4. Carreras con usuarios SINTÉTICOS (solo en la copia) y psql EN PARALELO:
#      A  10 «equipo favorito» con la MISMA versión → exactamente 1 SAVED
#      B  equipo favorito + insignias (0062) + vitrina (0049) a la vez con la misma versión → 1 SAVED, sin corrupción
#      C  20 primeras escrituras simultáneas de un usuario SIN fila → 1 fila, versión coherente
# 5. Privilegios: anon/authenticated sin EXECUTE; la columna no es legible por authenticated (RLS/0058).
# 6. Rollback operativo (fichero) → columna/RPC fuera, 0049/0062 intactas → 0063 se vuelve a aplicar limpia.
# Salida: PASS/FAIL y `DRYRUN_OK` / `DRYRUN_FAIL`. El contenedor se borra pase lo que pase.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f89-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }

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
docker cp "$DIR/0063_profile_favorite_team.sql" "$NAME:/tmp/0063.sql" >/dev/null
docker cp "$DIR/0063_profile_favorite_team.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0062: collection_sets existe" "$(P "select to_regclass('public.collection_sets') is not null")" "t"
check "copia en 0062: sin favorite_team_id" "$(P "select count(*) from information_schema.columns where table_name='player_profile_customization' and column_name='favorite_team_id'")" "0"

TABLES="auth.users public.profiles public.user_cards public.user_packs public.user_game public.economy_ops public.credit_transactions public.content_cards public.duel_matches public.duel_pvp_ratings public.user_cosmetics public.user_achievements public.collection_sets public.user_collection_completions public.user_card_favorites"
fingerprint() {
  for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done
  printf '%s %s\n' "ppc(0049+0062)" "$(P "select count(*)||':'||coalesce(md5(string_agg(user_id::text||showcase_card_uids::text||featured_achievement_ids::text||featured_badge_ids::text||version, '|' order by user_id)),'-') from public.player_profile_customization")"
}
fingerprint > /tmp/$NAME.before
echo "== huellas antes: $(wc -l < /tmp/$NAME.before) tablas"

T0=$(date +%s%N)
APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0063.sql </dev/null 2>&1); RC=$?
check "0063 aplica en UNA transacción (exit)" "$RC" "0"
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms · $(echo "$APPLY" | grep -c ERROR) errores"
fingerprint > /tmp/$NAME.after
check "0063 no cambia NINGÚN dato existente (huellas)" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || echo distintas)" "iguales"
check "usuarios existentes: favorite_team_id nulo en todas las filas" "$(P "select count(*) from public.player_profile_customization where favorite_team_id is not null")" "0"
check "privilegios: anon/authenticated sin EXECUTE" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) where has_function_privilege(n,'public.player_profile_set_favorite_team(uuid,text,int)','execute')")" "0"
# La columna hereda EXACTAMENTE los privilegios de las columnas privadas que ya tenía la fila (0049/0062): en producción
# anon/authenticated no tienen NINGÚN grant sobre la tabla (0058). La copia restaurada sin roles de Supabase puede diferir,
# así que se compara con `featured_badge_ids` (no con un valor fijo) y producción se comprueba aparte tras aplicar.
check "privilegios: la columna nueva = las privadas existentes (authenticated/anon)" "$(P "select (has_column_privilege('authenticated','public.player_profile_customization','favorite_team_id','select') = has_column_privilege('authenticated','public.player_profile_customization','featured_badge_ids','select') and has_column_privilege('anon','public.player_profile_customization','favorite_team_id','select') = has_column_privilege('anon','public.player_profile_customization','featured_badge_ids','select'))::text")" "true"
check "RLS sin políticas (ninguna fila para clientes)" "$(P "select count(*) from pg_policies where schemaname='public' and tablename='player_profile_customization'")" "0"
check "RLS sigue activa en player_profile_customization" "$(P "select relrowsecurity::text from pg_class where oid='public.player_profile_customization'::regclass")" "true"
check "CHECK de forma: URL rechazada por la BD" "$(P "insert into public.player_profile_customization (user_id, favorite_team_id) select id, 'https://x' from public.profiles limit 1" 2>&1 | grep -c ppc_favorite_team_shape)" "1"

newuser() { local u; u=$(P "select gen_random_uuid()"); P "insert into auth.users (id,email,aud,role,instance_id) values ('$u','f89dry-$u@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')" >/dev/null; echo "$u"; }
setteam() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.player_profile_set_favorite_team('$1', $2, $3)->>'code'" </dev/null 2>&1; }

# 3 · contrato
U1=$(newuser)
check "BAD_USER (uuid inexistente)" "$(setteam 00000000-0000-4000-8000-000000000000 "'g2'" null)" "BAD_USER"
check "BAD_TEAM (forma)" "$(setteam "$U1" "'Team Heretics'" null)" "BAD_TEAM"
check "BAD_TEAM (URL)" "$(setteam "$U1" "'https://evil.example/x.png'" null)" "BAD_TEAM"
check "SAVED (primera vez, sin fila previa)" "$(setteam "$U1" "'team-heretics'" null)" "SAVED"
check "UNCHANGED (mismo contenido aunque la versión sea vieja)" "$(setteam "$U1" "'team-heretics'" 0)" "UNCHANGED"
check "CONFLICT (versión vieja, contenido distinto)" "$(setteam "$U1" "'g2'" 0)" "CONFLICT"
check "null quita el favorito" "$(setteam "$U1" null 1)" "SAVED"
check "fila: versión 2 y sin equipo" "$(P "select version||':'||coalesce(favorite_team_id,'∅') from public.player_profile_customization where user_id='$U1'")" "2:∅"

# fila EXISTENTE con vitrina/logros/insignias: se conservan y la versión es compartida
EX=$(P "select user_id from public.player_profile_customization where cardinality(showcase_card_uids) > 0 or cardinality(featured_badge_ids) > 0 limit 1")
if [ -n "$EX" ]; then
  BEFORE=$(P "select showcase_card_uids::text||featured_achievement_ids::text||featured_badge_ids::text from public.player_profile_customization where user_id='$EX'")
  V=$(P "select version from public.player_profile_customization where user_id='$EX'")
  check "usuario real (copia): SAVED con su versión" "$(setteam "$EX" "'fnatic'" "$V")" "SAVED"
  check "usuario real (copia): vitrina/logros/insignias intactos" "$(P "select showcase_card_uids::text||featured_achievement_ids::text||featured_badge_ids::text from public.player_profile_customization where user_id='$EX'")" "$BEFORE"
  check "usuario real (copia): versión +1" "$(P "select version from public.player_profile_customization where user_id='$EX'")" "$((V+1))"
else
  pass "sin filas de personalización con contenido en la copia (nada que conservar)"
fi

# 4 · carreras
UA=$(newuser); P "insert into public.player_profile_customization (user_id) values ('$UA')" >/dev/null
for i in $(seq 1 10); do t=$([ $((i % 2)) = 0 ] && echo "'g2'" || echo "'fnatic'"); setteam "$UA" "$t" 0 > /tmp/$NAME.a.$i & done; wait
check "A · exactamente 1 SAVED de 10 con la misma versión" "$(cat /tmp/$NAME.a.* | grep -c '^SAVED$')" "1"
check "A · el resto CONFLICT/UNCHANGED" "$(cat /tmp/$NAME.a.* | grep -cE '^(CONFLICT|UNCHANGED)$')" "9"
check "A · versión final 1" "$(P "select version from public.player_profile_customization where user_id='$UA'")" "1"

UB=$(newuser); P "insert into public.player_profile_customization (user_id) values ('$UB')" >/dev/null
P "insert into public.user_cosmetics (user_id, cosmetic_id, source) values ('$UB', 'insignia:coleccion:team-g2', 'dryrun')" >/dev/null
( setteam "$UB" "'g2'" 0 > /tmp/$NAME.b.team ) &
( docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.player_profile_set_badges('$UB', array['insignia:coleccion:team-g2'], 0)->>'code'" </dev/null > /tmp/$NAME.b.badges 2>&1 ) &
wait
echo "   B · equipo=$(cat /tmp/$NAME.b.team) insignias=$(cat /tmp/$NAME.b.badges)"
check "B · equipo + insignias con la MISMA versión: 1 SAVED y 1 CONFLICT" "$(cat /tmp/$NAME.b.* | grep -c '^SAVED$'):$(cat /tmp/$NAME.b.* | grep -c '^CONFLICT$')" "1:1"
check "B · versión 1 y SOLO el ganador escrito (nunca los dos, nunca ninguno)" "$(P "select (version = 1 and ((favorite_team_id = 'g2') <> (cardinality(featured_badge_ids) = 1)))::text from public.player_profile_customization where user_id='$UB'")" "true"

UC=$(newuser)
for i in $(seq 1 20); do setteam "$UC" "'leviatan'" null > /tmp/$NAME.c.$i & done; wait
check "C · 20 primeras escrituras simultáneas → 1 fila" "$(P "select count(*) from public.player_profile_customization where user_id='$UC'")" "1"
check "C · 1 SAVED y 19 UNCHANGED" "$(cat /tmp/$NAME.c.* | grep -c '^SAVED$'):$(cat /tmp/$NAME.c.* | grep -c '^UNCHANGED$')" "1:19"

# 6 · rollback y re-aplicación
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/rollback.sql </dev/null 2>&1); RC=$?
check "rollback (exit)" "$RC" "0"
check "rollback: sin columna ni RPC de 0063" "$(P "select ((select count(*) from information_schema.columns where table_name='player_profile_customization' and column_name='favorite_team_id') = 0 and to_regprocedure('public.player_profile_set_favorite_team(uuid,text,int)') is null)::text")" "true"
check "rollback: 0049 intacta" "$(P "select public.player_profile_set('$UA', null, array[]::text[], null)->>'code'")" "UNCHANGED"
check "rollback: 0062 intacta (set_badges)" "$(P "select public.player_profile_set_badges('$UA', array[]::text[], null)->>'code'")" "UNCHANGED"
RA=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0063.sql </dev/null 2>&1); RC=$?
check "re-aplicar 0063 tras rollback (exit)" "$RC" "0"
RA2=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0063.sql </dev/null 2>&1); RC=$?
check "0063 es re-ejecutable (idempotente, exit)" "$RC" "0"

if [ "$FAILS" = 0 ]; then echo "DRYRUN_OK"; else echo "DRYRUN_FAIL ($FAILS)"; fi
