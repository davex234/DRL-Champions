#!/usr/bin/env bash
# DRY RUN de _account-cleanup.sql sobre una COPIA AISLADA (instrumento de operador, fuera de la release).
# Restaura el backup en un Postgres desechable con la MISMA imagen que producción, --network none, aplica la limpieza
# CON COMMIT dentro de la copia y comprueba el resultado. Producción no se toca. El contenedor se borra siempre.
#   ssh … 'SRC=<backup> bash -s' < _account-cleanup-dryrun.sh   (con /tmp/acct/_account-cleanup.sql subido antes)
set -euo pipefail
SRC="${SRC:?falta SRC}"
NAME="drlcards-cleanup-dryrun-$(date -u +%Y%m%dT%H%M%SZ)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || { echo "DRYRUN_FAIL backup"; exit 1; }
IMAGE=$(docker inspect supabase_db_DRLCards --format '{{.Config.Image}}')
PASS=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PASS" "$IMAGE" >/dev/null </dev/null
ok=0; streak=0
for i in $(seq 1 120); do
  if docker logs "$NAME" 2>&1 | grep -q "init process complete" && docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select 1" </dev/null >/dev/null 2>&1; then streak=$((streak+1)); [ "$streak" -ge 3 ] && { ok=1; break; }; else streak=0; fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "DRYRUN_FAIL postgres"; exit 1; }
docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -Atqc "drop schema if exists auth cascade; drop schema if exists storage cascade;" </dev/null >/dev/null
# Roles que la imagen desnuda no trae (trampa medida en F78): sin ellos fallan 2 GRANT, no datos.
docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "do \$\$ begin if not exists (select 1 from pg_roles where rolname='supabase_realtime_admin') then create role supabase_realtime_admin; end if; if not exists (select 1 from pg_roles where rolname='supabase_functions_admin') then create role supabase_functions_admin; end if; end \$\$;" </dev/null >/dev/null
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --no-owner < "$SRC/db.dump" > /tmp/$NAME.log 2>&1 || true
echo "pg_restore errores reales: $(grep "error:" /tmp/$NAME.log | grep -vc "already exists" || true)"
rm -f /tmp/$NAME.log
q() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "$1" </dev/null; }
echo "ANTES usuarios=$(q 'select count(*) from auth.users') admins=$(q 'select count(*) from public.profiles where is_admin') tags=$(q 'select count(*) from public.account_tag_registry')"
docker cp /tmp/acct/_account-cleanup.sql "$NAME":/tmp/c.sql
docker exec "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v commit_or_rollback=COMMIT -f /tmp/c.sql </dev/null 2>&1 | grep -E "RESUMEN|ERROR|GUARD|POST" || true
echo "DESPUÉS usuarios=$(q 'select count(*) from auth.users') admins=$(q "select string_agg(username||' #'||public_tag, ', ') from public.profiles where is_admin") tags=$(q 'select count(*) from public.account_tag_registry') 9KZAWPC_reservado=$(q "select count(*) from public.account_tag_registry where tag='9KZAWPC'")"
echo "auditoría admin: $(q "select string_agg(action||':'||(detail->>'target_username'), ', ' order by at) from public.content_audit_log where action in ('GRANT_ADMIN','REVOKE_ADMIN') and at > now() - interval '10 minutes'")"
echo "copas legibles (instantáneas): $(q "select count(*)||' inscripciones con nombre de instantánea' from public.cup_registrations where username_snapshot is not null")"
echo "Open1=$(q "select status from public.cups where slug='valorosters-open-1'") AlphaCup=$(q "select status||'/'||visibility from public.cups where slug='valorosters-closed-alpha-cup'") T2=$(q "select status from public.game_seasons where id='temporada-2'")"
echo "embudo (cuentas de prueba incluidas, desde siempre): $(q "select (app_alpha_funnel(now() - interval '400 days', true)->>'accounts')")"
U=$(q 'select count(*) from auth.users'); A=$(q 'select count(*) from public.profiles where is_admin')
[ "$U" = 2 ] && [ "$A" = 2 ] && echo "DRYRUN_OK" || echo "DRYRUN_FAIL usuarios=$U admins=$A"
