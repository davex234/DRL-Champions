#!/usr/bin/env bash
# =============================================================================
# ICON (2026-10-09) · BANCO DE PRUEBAS SQL AISLADO. NUNCA toca producción.
#   ssh … 'SRC=<backup> WORK=/tmp/icon-sql bash -s' < scripts/_icon-odds/sandbox.sh
#
# 1. restaura el backup en un Postgres DESECHABLE (misma imagen que producción, `--network none`, sin puertos);
# 2. AUDITORÍA de solo lectura (audit.sql) del estado copiado de producción;
# 3. ENSAYOS (pool, receta) que terminan en ROLLBACK + prueba de que no quedó nada;
# 4. APLICACIÓN REAL en la copia (COMMIT) con sus verificaciones internas, idempotencia (repetir = error controlado),
#    y la VUELTA ATRÁS (revert) con las suyas;
# 5. borra el contenedor pase lo que pase (trap). Salida: SANDBOX_OK / SANDBOX_FAIL.
# Los .sql los deja el instrumento en $WORK (scp previo).
# =============================================================================
set -euo pipefail
SRC="${SRC:?falta SRC=<directorio del backup>}"
WORK="${WORK:?falta WORK=<directorio con los .sql>}"
PROD_CONTAINER="${PROD_CONTAINER:-supabase_db_DRLCards}"
NAME="drlcards-icon-sandbox-$(date -u +%Y%m%dT%H%M%SZ)"
fail() { echo "SANDBOX_FAIL $*"; exit 1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
[ -f "$SRC/COMPLETE" ] || fail "el backup no está marcado COMPLETE"
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || fail "SHA256SUMS no cuadra"
IMAGE=$(docker inspect "$PROD_CONTAINER" --format '{{.Config.Image}}')
PASS=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PASS" "$IMAGE" >/dev/null </dev/null || fail "no arranca el contenedor"
ok=0; streak=0
for i in $(seq 1 120); do
  if docker logs "$NAME" 2>&1 | grep -q "init process complete" && docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select 1" </dev/null >/dev/null 2>&1; then
    streak=$((streak+1)); [ "$streak" -ge 3 ] && { ok=1; break; }
  else streak=0; fi
  sleep 2
done
[ "$ok" = 1 ] || fail "Postgres no quedó listo"
docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -Atqc "drop schema if exists auth cascade; drop schema if exists storage cascade;" </dev/null >/dev/null || fail "auth/storage"
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --no-owner < "$SRC/db.dump" > /tmp/$NAME.restore.log 2>&1 || true
echo "restore: $(grep -c 'error:' /tmp/$NAME.restore.log || true) errores ($(grep -c 'already exists' /tmp/$NAME.restore.log || true) «already exists», esperables)"
rm -f /tmp/$NAME.restore.log
run() { # $1 = etiqueta, $2 = fichero; imprime la salida y devuelve el código de psql
  echo "────────── $1"
  docker exec -i "$NAME" psql -U supabase_admin -d postgres -X -q -f - < "$WORK/$2" 2>&1; }
# 2 · auditoría
run "AUDITORÍA (solo lectura)" audit.sql || fail "auditoría"
# 3 · ensayos con ROLLBACK
run "ENSAYO pool (ROLLBACK)" pool-dry.sql || fail "ensayo pool"
run "ENSAYO receta (ROLLBACK)" recipe-dry.sql || fail "ensayo receta"
st=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select (select input_qty||'/'||version from craft_recipes where id='pack-champions-icon') || ' · vínculos icon-single=' || (select count(*) from content_pack_pools where pack_id='icon-single')" </dev/null)
echo "tras los ensayos (debe ser el estado inicial): $st"
# 4 · aplicación real en la copia
run "COMMIT pool" pool-commit.sql || fail "commit pool"
run "COMMIT receta" recipe-commit.sql || fail "commit receta"
echo "────────── repetir la receta (debe FALLAR en la precondición, sin cambiar nada)"
if docker exec -i "$NAME" psql -U supabase_admin -d postgres -X -q -f - < "$WORK/recipe-commit.sql" >/tmp/$NAME.rep 2>&1; then cat /tmp/$NAME.rep; fail "la receta se aplicó dos veces"; else grep -m1 "ya aplicado\|ERROR" /tmp/$NAME.rep; fi
rm -f /tmp/$NAME.rep
st=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select (select input_qty||'/'||version||'/'||name from craft_recipes where id='pack-champions-icon') || ' · vínculos icon-single=' || (select count(*) from content_pack_pools where pack_id='icon-single' and enabled) || ' · auditoría receta=' || (select count(*) from content_audit_log where entity_id='pack-champions-icon')" </dev/null)
echo "tras aplicar: $st"
# vuelta atrás
run "REVERT receta (COMMIT)" recipe-revert-commit.sql || fail "revert receta"
run "REVERT pool (COMMIT)" pool-revert-commit.sql || fail "revert pool"
st=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select (select input_qty||'/'||version||'/'||name from craft_recipes where id='pack-champions-icon') || ' · vínculos activos icon-single=' || (select count(*) from content_pack_pools where pack_id='icon-single' and enabled) || ' · pool=' || coalesce((select lifecycle from content_pools where id='pack-icon-single'),'-')" </dev/null)
echo "tras revertir: $st"
echo "SANDBOX_OK $NAME"
