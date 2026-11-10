#!/usr/bin/env bash
# =============================================================================
# GESTIÓN DE ADMINS · DRY-RUN de 0067 + ESCALADA + CARRERAS REALES + ROLLBACK — sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0067/<TS> bash /tmp/adm/_admin-dryrun.sh'
# (con /tmp/adm/0067_admin_management.sql y /tmp/adm/0067_admin_management.ROLLBACK.sql). Usuarios SINTÉTICOS solo en
# la copia; psql EN PARALELO para las carreras. Salida PASS/FAIL y DRYRUN_OK / DRYRUN_FAIL.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="adm-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
SETA() { P "select public.app_admin_set_admin('$1','$2',$3,'ensayo')->>'code'"; }

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
docker cp "$DIR/0067_admin_management.sql" "$NAME:/tmp/0067.sql" >/dev/null
docker cp "$DIR/0067_admin_management.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0066: social_blocks existe" "$(P "select to_regclass('public.social_blocks') is not null")" "t"
check "copia sin rastro de 0067" "$(P "select to_regprocedure('public.app_admin_set_admin(uuid,uuid,boolean,text)') is null")" "t"
ADMINS_BEFORE=$(P "select string_agg(id::text, ',' order by id) from public.profiles where is_admin")
# La copia restaurada con --no-owner trae concesiones de columna distintas a producción (trampa F84/F89): aquí se exige que
# 0067 no las cambie; en producción se comprueba aparte (authenticated/anon NO leen ni escriben is_admin desde 0058).
COLPRIV() { P "select string_agg(r||':'||k||':'||has_column_privilege(r,'public.profiles','is_admin',k)::text, ',' order by r, k) from (values ('anon'),('authenticated')) a(r) cross join (values ('SELECT'),('UPDATE'),('INSERT')) b(k)"; }
COLPRIV_BEFORE=$(COLPRIV)
PROFILES_BEFORE=$(P "select count(*)||':'||md5(string_agg(p::text, '|' order by p.id)) from public.profiles p")
AUDIT_BEFORE=$(P "select count(*) from public.content_audit_log")
echo "== admins antes: $(echo "$ADMINS_BEFORE" | tr ',' '\n' | grep -c .)"

T0=$(date +%s%N)
APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0067.sql </dev/null 2>&1); RC=$?
check "0067 aplica en UNA transacción (exit)" "$RC" "0"
[ "$RC" = 0 ] || echo "$APPLY" | tail -5
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms"
check "0067 no cambia ningún perfil (huella de profiles)" "$(P "select count(*)||':'||md5(string_agg(p::text, '|' order by p.id)) from public.profiles p")" "$PROFILES_BEFORE"
check "los administradores siguen siendo exactamente los mismos" "$(P "select string_agg(id::text, ',' order by id) from public.profiles where is_admin")" "$ADMINS_BEFORE"
check "0067 no escribe auditoría al aplicarse" "$(P "select count(*) from public.content_audit_log")" "$AUDIT_BEFORE"
check "privilegios: anon/authenticated SIN execute en app_admin_set_admin" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) where has_function_privilege(n, 'public.app_admin_set_admin(uuid,uuid,boolean,text)', 'execute')")" "0"
check "privilegios: service_role SÍ" "$(P "select has_function_privilege('service_role', 'public.app_admin_set_admin(uuid,uuid,boolean,text)', 'execute')")" "t"
check "0067 no cambia las concesiones de columna sobre is_admin" "$(COLPRIV)" "$COLPRIV_BEFORE"

newuser() { local u; u=$(P "select gen_random_uuid()"); P "insert into auth.users (id,email,aud,role,instance_id) values ('$u','adm-$u@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')" >/dev/null; echo "$u"; }
X=$(newuser); Y=$(newuser); Z=$(newuser); S=$(newuser); W=$(newuser)
check "usuarios sintéticos nacen sin admin" "$(P "select count(*) from public.profiles where id in ('$X','$Y','$Z','$S','$W') and not is_admin")" "5"

echo "== escalada directa (sin la RPC)"
check "superusuario/service_role: UPDATE suelto de is_admin → ADMIN_WRITE_FORBIDDEN" "$(P "update public.profiles set is_admin = true where id = '$Y'" | grep -c ADMIN_WRITE_FORBIDDEN)" "1"
check "… y no cambió nada" "$(P "select is_admin from public.profiles where id = '$Y'")" "f"
check "authenticated (su propio perfil, RLS «edita tu perfil»): UPDATE is_admin → rechazado" "$(P "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$Y\",\"role\":\"authenticated\"}', true); update public.profiles set is_admin = true where id = '$Y'; commit;" | grep -cE 'SEC-02|ADMIN_WRITE_FORBIDDEN|permission denied')" "1"
check "authenticated: ejecutar la RPC directamente → permiso denegado" "$(P "begin; set local role authenticated; select public.app_admin_set_admin('$Y','$Y',true,null); commit;" | grep -c 'permission denied')" "1"
check "anon: ejecutar la RPC → permiso denegado" "$(P "begin; set local role anon; select public.app_admin_set_admin('$Y','$Y',true,null); commit;" | grep -c 'permission denied')" "1"
check "INSERT de un perfil con is_admin = true → ADMIN_WRITE_FORBIDDEN" "$(P "insert into public.profiles (id, username, is_admin) values (gen_random_uuid(), 'adm_forjado', true)" | grep -c ADMIN_WRITE_FORBIDDEN)" "1"

echo "== operador (arranque de un admin de prueba, auditado a mano)"
P "begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '$X'; insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '$X', '{\"via\":\"operator\",\"purpose\":\"dryrun\"}'); commit;" >/dev/null
check "operador con la bandera: X es admin" "$(P "select is_admin from public.profiles where id = '$X'")" "t"
check "la bandera es local a la transacción: después, un UPDATE suelto vuelve a chocar" "$(P "update public.profiles set is_admin = false where id = '$X'" | grep -c ADMIN_WRITE_FORBIDDEN)" "1"

echo "== RPC"
check "un NO admin no se concede admin a sí mismo (NOT_ADMIN)" "$(SETA "$Y" "$Y" true | grep -c NOT_ADMIN)" "1"
check "un NO admin no concede admin a otro (NOT_ADMIN)" "$(SETA "$Y" "$Z" true | grep -c NOT_ADMIN)" "1"
check "actor nulo → NOT_ADMIN" "$(P "select public.app_admin_set_admin(null,'$Z',true,null)" | grep -c NOT_ADMIN)" "1"
check "usuario inexistente → USER_NOT_FOUND" "$(SETA "$X" "$(P "select gen_random_uuid()")" true | grep -c USER_NOT_FOUND)" "1"
A0=$(P "select count(*) from public.content_audit_log")
check "admin X concede a Y → GRANTED" "$(SETA "$X" "$Y" true)" "GRANTED"
check "auditoría: GRANT_ADMIN con actor X, afectado Y, hora y nombre" "$(P "select action||'|'||(actor = '$X')||'|'||entity_type||'|'||(entity_id = '$Y')||'|'||(at is not null)||'|'||(detail ? 'target_username') from public.content_audit_log order by id desc limit 1")" "GRANT_ADMIN|true|user|true|true|true"
check "repetir → ALREADY_ADMIN y SIN nueva auditoría" "$(SETA "$X" "$Y" true)|$(( $(P "select count(*) from public.content_audit_log") - A0 ))" "ALREADY_ADMIN|1"
check "motivo de > 300 caracteres → BAD_REASON" "$(P "select public.app_admin_set_admin('$X','$Z',true,repeat('x',301))" | grep -c BAD_REASON)" "1"
P "insert into public.user_sanctions (user_id, type, reason, created_by) values ('$S', 'ban', 'sanción de ensayo 0067', '$X')" >/dev/null
check "cuenta con sanción vigente → TARGET_SANCTIONED" "$(SETA "$X" "$S" true | grep -c TARGET_SANCTIONED)" "1"

echo "== concurrencia: 20 concesiones X→Z a la vez"
A1=$(P "select count(*) from public.content_audit_log")
for i in $(seq 1 20); do ( SETA "$X" "$Z" true > /tmp/$NAME.g$i ) & done; wait
G=$(cat /tmp/$NAME.g* | grep -c '^GRANTED$'); AL=$(cat /tmp/$NAME.g* | grep -c '^ALREADY_ADMIN$')
check "20 a la vez → 1 GRANTED + 19 ALREADY_ADMIN" "$G|$AL" "1|19"
check "… y UNA sola auditoría" "$(( $(P "select count(*) from public.content_audit_log") - A1 ))" "1"
check "revocar a Z → REVOKED; repetir → ALREADY_NOT_ADMIN" "$(SETA "$X" "$Z" false)|$(SETA "$X" "$Z" false)" "REVOKED|ALREADY_NOT_ADMIN"
check "auditoría REVOKE_ADMIN" "$(P "select action from public.content_audit_log order by id desc limit 1")" "REVOKE_ADMIN"
check "Z ya no es admin: no puede conceder" "$(SETA "$Z" "$W" true | grep -c NOT_ADMIN)" "1"

echo "== último administrador (en la COPIA se retiran los admins reales por operador para quedarnos con X e Y)"
P "begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where is_admin and id not in ('$X','$Y'); commit;" >/dev/null
check "copia: admins = X e Y" "$(P "select count(*) from public.profiles where is_admin")" "2"
check "X se quita a sí mismo con otro admin presente → REVOKED (autorretirada permitida si queda alguien)" "$(SETA "$X" "$X" false)" "REVOKED"
check "… y la auditoría lo marca como autorretirada" "$(P "select detail->>'self' from public.content_audit_log order by id desc limit 1")" "true"
check "Y (último) se quita a sí mismo → LAST_ADMIN" "$(SETA "$Y" "$Y" false | grep -c LAST_ADMIN)" "1"
check "… y sigue siendo admin" "$(P "select is_admin from public.profiles where id = '$Y'")" "t"
check "X (ya no admin) no puede revocar a Y → NOT_ADMIN" "$(SETA "$X" "$Y" false | grep -c NOT_ADMIN)" "1"
check "Y vuelve a conceder a X → GRANTED" "$(SETA "$Y" "$X" true)" "GRANTED"
for i in 1 2 3 4 5; do
  ( SETA "$X" "$Y" false > /tmp/$NAME.r1 ) & ( SETA "$Y" "$X" false > /tmp/$NAME.r2 ) & wait
  R1=$(cat /tmp/$NAME.r1); R2=$(cat /tmp/$NAME.r2)
  N=$(P "select count(*) from public.profiles where is_admin")
  if [ "$N" != "1" ] || ! { echo "$R1$R2" | grep -q REVOKED && echo "$R1$R2" | grep -q 'LAST_ADMIN\|NOT_ADMIN'; }; then fail "ronda $i: dos admins se revocan mutuamente a la vez → $R1 / $R2 · admins=$N"; else pass "ronda $i: revocación mutua simultánea → exactamente 1 admin queda"; fi
  LEFT=$(P "select id from public.profiles where is_admin")
  OTHER=$([ "$LEFT" = "$X" ] && echo "$Y" || echo "$X")
  SETA "$LEFT" "$OTHER" true >/dev/null
done
check "SUELO en BD: un operador que deja 0 admins (con la bandera) → LAST_ADMIN y se deshace todo" "$(P "begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where is_admin; commit;" | grep -c LAST_ADMIN)|$(P "select count(*) from public.profiles where is_admin")" "1|2"
P "begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where id = '$Y'; commit;" >/dev/null
check "SUELO en BD: borrar la cuenta del ÚLTIMO admin → LAST_ADMIN" "$(P "delete from auth.users where id = '$X'" | grep -c LAST_ADMIN)|$(P "select count(*) from public.profiles where id = '$X' and is_admin")" "1|1"
check "borrar una cuenta NO admin sigue funcionando" "$(P "delete from auth.users where id = '$W'" | grep -c ERROR)" "0"

echo "== rollback"
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/rollback.sql </dev/null 2>&1); check "rollback aplica (exit)" "$?" "0"
check "rollback → sin RPC ni disparadores de 0067" "$(P "select (to_regprocedure('public.app_admin_set_admin(uuid,uuid,boolean,text)') is null)::text||(select count(*) from pg_trigger where tgname like 'profiles_admin_%')")" "true0"
check "0067 se re-aplica tras el rollback" "$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0067.sql </dev/null >/dev/null 2>&1; echo $?)" "0"
check "0067 es re-ejecutable" "$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0067.sql </dev/null >/dev/null 2>&1; echo $?)" "0"

echo "== $FAILS fallos"
[ "$FAILS" = 0 ] && echo DRYRUN_OK || echo DRYRUN_FAIL
