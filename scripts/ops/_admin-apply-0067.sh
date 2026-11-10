#!/usr/bin/env bash
# =============================================================================
# GESTIÓN DE ADMINS · APLICAR 0067 EN PRODUCCIÓN — UNA vez, en UNA transacción, con comprobaciones antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0067> bash /tmp/adm/_admin-apply-0067.sh'
# Se PARA sin tocar nada si: el fichero no es el revisado, la cabeza no es 0066 por estado real, o ya hay rastro de 0067.
# No imprime secretos ni datos de jugadores: solo recuentos, huellas e ids abreviados de los admins.
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/adm/0067_admin_management.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0066 por estado real, sin rastro de 0067"
[ "$(q "select to_regclass('public.social_blocks') is not null")" = "t" ] || stop "0066 no está"
[ "$(q "select to_regprocedure('public.app_admin_set_admin(uuid,uuid,boolean,text)') is null and not exists (select 1 from pg_trigger where tgname like 'profiles_admin_%')")" = "t" ] || stop "ya hay rastro de 0067"
ADMINS_BEFORE=$(q "select string_agg(left(id::text,8), ',' order by id) from public.profiles where is_admin")
PROFILES_BEFORE=$(q "select count(*)||':'||md5(string_agg(concat_ws(',',id,username,is_admin,credits,xp,level), '|' order by id)) from public.profiles")
AUDIT_BEFORE=$(q "select count(*) from public.content_audit_log")
echo "admins antes: $ADMINS_BEFORE · perfiles: $PROFILES_BEFORE · auditoría: $AUDIT_BEFORE"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0067.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0067.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0067.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
[ "$(q "select string_agg(left(id::text,8), ',' order by id) from public.profiles where is_admin")" = "$ADMINS_BEFORE" ] && echo "ADMINS_IGUALES" || stop "los admins cambiaron"
[ "$(q "select count(*)||':'||md5(string_agg(concat_ws(',',id,username,is_admin,credits,xp,level), '|' order by id)) from public.profiles")" = "$PROFILES_BEFORE" ] && echo "PERFILES_INTACTOS" || echo "AVISO_PERFILES_DISTINTOS (actividad real durante el aplicado: revisar)"
echo "auditoría después: $(q "select count(*) from public.content_audit_log") (antes $AUDIT_BEFORE)"
echo "disparadores: $(q "select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname like 'profiles_admin_%'")"
PRIV=$(q "select count(*) from (values ('anon'),('authenticated'),('public')) r(n) where has_function_privilege(n, 'public.app_admin_set_admin(uuid,uuid,boolean,text)', 'execute')")
COL=$(q "select has_column_privilege('authenticated','public.profiles','is_admin','SELECT')::text||has_column_privilege('authenticated','public.profiles','is_admin','UPDATE')::text||has_column_privilege('anon','public.profiles','is_admin','SELECT')::text")
echo "privilegios de cliente: execute=$PRIV is_admin(auth select,update / anon select)=$COL"
[ "$PRIV$COL" = "0falsefalsefalse" ] || stop "privilegios de cliente inesperados"
echo "APPLY_OK 0067"
