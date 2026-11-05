#!/usr/bin/env bash
# =============================================================================
# F67 · SIMULACRO DE RESTAURACIÓN AISLADO de un backup de `backup-drlcards.sh`. NUNCA toca producción.
# =============================================================================
#   ssh -i ~/.ssh/id_ed25519 nexusadmin@212.95.40.144 'SRC=/opt/nexus/backups/supabase-drlcards/f67/<TS> bash -s' < scripts/ops/restore-drill.sh
#
#   1. verifica SHA256SUMS del backup;
#   2. arranca un Postgres DESECHABLE con la MISMA imagen que producción, `--network none` y sin puertos publicados;
#   3. restaura el dump (pg_restore --clean --if-exists) y compara los recuentos con `table-counts.tsv`;
#   4. extrae `storage.tgz` en un contenedor efímero y compara el sha256 de cada fichero con `storage-files.sha256`;
#   5. mide el tiempo total (RTO observado de la BD) y borra el contenedor pase lo que pase (trap).
# Salida: `DRILL_OK …` / `DRILL_FAIL …` y exit 0/1.
# =============================================================================
set -euo pipefail
SRC="${SRC:?falta SRC=<directorio del backup>}"
PROD_CONTAINER="${PROD_CONTAINER:-supabase_db_DRLCards}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="drlcards-restore-drill-$TS"
fail() { echo "DRILL_FAIL $*"; exit 1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

[ -f "$SRC/COMPLETE" ] || fail "el backup no está marcado COMPLETE"
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || fail "SHA256SUMS no cuadra"
IMAGE=$(docker inspect "$PROD_CONTAINER" --format '{{.Config.Image}}')
PASS=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')   # solo vive en este contenedor aislado y efímero
T0=$(date +%s)

docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PASS" "$IMAGE" >/dev/null </dev/null || fail "no arranca el contenedor de simulacro"
# La imagen de Supabase arranca un Postgres TEMPORAL para sus scripts de init y luego lo REINICIA: la primera conexión
# que funciona no vale (medido: el restore moría con «terminating connection due to administrator command»). Se espera
# al final del init y a 3 conexiones seguidas correctas.
ok=0; streak=0
for i in $(seq 1 120); do
  if docker logs "$NAME" 2>&1 | grep -q "init process complete"      && docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select 1" </dev/null >/dev/null 2>&1; then
    streak=$((streak+1)); [ "$streak" -ge 3 ] && { ok=1; break; }
  else streak=0; fi
  sleep 2
done
[ "$ok" = 1 ] || fail "el Postgres del simulacro no quedó listo"
T_READY=$(date +%s)

# La imagen crea al iniciar una versión MÍNIMA y antigua de los esquemas `auth` y `storage` (sin las columnas que
# añadieron las migraciones de GoTrue/Storage). Si se dejan, `auth.users` no carga (medido: 18 → 0). En una base nueva
# y SIN GoTrue arrancado se eliminan para que el dump los recree exactos. Es el mismo paso del runbook de DR.
docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -Atqc "drop schema if exists auth cascade; drop schema if exists storage cascade;" </dev/null >/dev/null || fail "no se pudieron preparar los esquemas auth/storage"
# Base RECIÉN creada: sin --clean (chocaría con los disparadores de eventos que trae la imagen). Los objetos que la
# imagen ya crea (roles, esquemas y extensiones de Supabase) dan «already exists» y se cuentan aparte: no son pérdida.
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --no-owner < "$SRC/db.dump" > /tmp/$NAME.restore.log 2>&1 || true
ERRORS=$(grep -c "error:" /tmp/$NAME.restore.log || true)
EXISTS=$(grep -c "already exists" /tmp/$NAME.restore.log || true)
[ "${DEBUG:-0}" = 1 ] && { echo "--- pg_restore (primeras líneas)"; head -40 /tmp/$NAME.restore.log; echo "--- errores: $ERRORS"; } >&2
T_RESTORED=$(date +%s)

mism=0; total=0; detail=""
while IFS=$'\t' read -r table expected; do
  total=$((total+1))
  if [ "$table" = "auth.users" ]; then q="select count(*) from auth.users"; else q="select count(*) from public.$table"; fi
  got=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "$q" </dev/null 2>/dev/null || echo ERR)
  if [ "$got" != "$expected" ]; then mism=$((mism+1)); detail="$detail $table:$expected->$got"; fi
done < "$SRC/table-counts.tsv"
CARDS=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select count(*) from public.content_cards" </dev/null)
AGENTS=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select count(*) from public.agents" </dev/null)
ADMINS=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select count(*) from public.profiles where is_admin" </dev/null)
PROBE=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select app_admin_schema_probe()::text" </dev/null 2>/dev/null || echo null)
T_VALID=$(date +%s)

# Storage: se extrae en un contenedor efímero y se compara fichero a fichero.
docker run --rm --network none -v "$SRC":/b:ro alpine sh -c 'mkdir -p /r && tar xzf /b/storage.tgz -C /r && cd /r && find . -type f -exec sha256sum {} + | sort' </dev/null > /tmp/$NAME.storage.sha256 || fail "no se pudo extraer storage.tgz"
sort "$SRC/storage-files.sha256" > /tmp/$NAME.expected.sha256
if cmp -s /tmp/$NAME.storage.sha256 /tmp/$NAME.expected.sha256; then STORAGE_OK=1; else STORAGE_OK=0; fi
ST_FILES=$(wc -l < /tmp/$NAME.storage.sha256 | tr -d ' ')
T_END=$(date +%s)
rm -f /tmp/$NAME.storage.sha256 /tmp/$NAME.expected.sha256
RESTORE_ERR_SAMPLE=$(grep -A1 "error:" /tmp/$NAME.restore.log | grep -v "already exists" | grep "ERROR" | sed 's/"/'"'"'/g' | head -5 | tr '\n' '|' || true)
rm -f /tmp/$NAME.restore.log

echo "{\"drill\":\"$NAME\",\"src\":\"$SRC\",\"image\":\"$IMAGE\",\"network\":\"none\",\"secondsToPostgresReady\":$((T_READY-T0)),\"secondsRestore\":$((T_RESTORED-T_READY)),\"secondsValidate\":$((T_VALID-T_RESTORED)),\"secondsStorage\":$((T_END-T_VALID)),\"secondsTotal\":$((T_END-T0)),\"pgRestoreErrors\":$ERRORS,\"pgRestoreAlreadyExists\":$EXISTS,\"pgRestoreErrorSample\":\"$RESTORE_ERR_SAMPLE\",\"tablesCompared\":$total,\"tableMismatches\":$mism,\"mismatchDetail\":\"$detail\",\"contentCards\":$CARDS,\"agents\":$AGENTS,\"admins\":$ADMINS,\"schemaProbe\":${PROBE:-null},\"storageFiles\":$ST_FILES,\"storageChecksumsMatch\":$STORAGE_OK}"
[ "$mism" = 0 ] && [ "$STORAGE_OK" = 1 ] || fail "recuentos o checksums no cuadran ($detail)"
echo "DRILL_OK $NAME en $((T_END-T0))s"
