#!/usr/bin/env bash
# =============================================================================
# F67 · BACKUP VERIFICADO DE DRLCards (Postgres + Storage + manifiesto + checksums)
# =============================================================================
# Se ejecuta EN EL VPS (donde viven los contenedores). Desde el PC, sin copiar nada al servidor:
#
#   ssh -i ~/.ssh/id_ed25519 nexusadmin@212.95.40.144 'DEST=/opt/nexus/backups/supabase-drlcards/f67 bash -s' < scripts/ops/backup-drlcards.sh
#
# Complementa (no sustituye) al diario `/opt/nexus/scripts/nexus-backup.sh` (04:30, 14 días, dump + tgz de Storage +
# sha256), añadiendo lo que a aquel le falta para poder RESTAURAR con garantías:
#   · manifiesto JSON (tamaños, sha256, versión de Postgres, imagen, sonda de esquema, recuentos de tablas);
#   · lista sha256 de CADA objeto de Storage (no solo del tar) y el inventario `storage.objects` de la BD;
#   · SHA256SUMS de todo el directorio, verificado al final (`sha256sum -c`);
#   · falla ruidosamente (exit ≠ 0) ante cualquier paso fallido, destino sin permisos o disco insuficiente.
# No borra NADA fuera de su propio `.partial`. No lleva secretos: usa `docker exec` con los usuarios del contenedor.
# =============================================================================
set -euo pipefail
umask 077

DB_CONTAINER="${DB_CONTAINER:-supabase_db_DRLCards}"
DB_USER="${DB_USER:-supabase_admin}"
STORAGE_VOLUME="${STORAGE_VOLUME:-supabase_storage_DRLCards}"
DEST="${DEST:-/opt/nexus/backups/supabase-drlcards/f67}"
MIN_FREE_MB="${MIN_FREE_MB:-1024}"
EXPECTED_HEAD="${EXPECTED_HEAD:-0061_forge_progression}"  # F79.1 · 0061 aplicada el 2026-10-02 (0059/0060 el 2026-09-30)
# PRE-F70 · off-site y retención local: el MISMO flujo (un solo cron), sin otro sistema de backup.
#   LOCK_FILE      candado compartido con backup-offsite.sh: dos copias a la vez no se pisan (exit 75).
#   LOCAL_KEEP     0 = no se borra nada (por defecto); N = conserva las N unidades COMPLETE más recientes de DEST.
#   OFFSITE_SCRIPT / DRL_OFFSITE_CONFIG  si la configuración off-site existe, al terminar se envía la unidad.
# SALIDA: 0 ok · 1 fallo del backup local · 3 backup local OK pero off-site FALLÓ (alertable) · 75 candado ocupado.
LOCK_FILE="${DRL_BACKUP_LOCK:-/opt/nexus/backups/supabase-drlcards/.backup.lock}"
LOCAL_KEEP="${LOCAL_KEEP:-0}"
OFFSITE_SCRIPT="${OFFSITE_SCRIPT:-/opt/nexus/projects/supabase-drlcards/backup/bin/backup-offsite.sh}"
OFFSITE_CONFIG="${DRL_OFFSITE_CONFIG:-/opt/nexus/projects/supabase-drlcards/backup/offsite.env}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DEST/$TS"

die() { echo "[backup-drlcards] FALLO: $*" >&2; exit 1; }
log() { echo "[backup-drlcards] $*"; }

[[ "$LOCAL_KEEP" =~ ^[0-9]{1,3}$ ]] || die "LOCAL_KEEP debe ser un entero"
mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || die "no se puede crear el directorio del candado"
exec 9>>"$LOCK_FILE" || die "no se puede abrir el candado $LOCK_FILE"
flock -n 9 || { echo "[backup-drlcards] otra copia en curso (candado ocupado)"; exit 75; }

docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" || die "el contenedor $DB_CONTAINER no está en marcha"
docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || die "no existe el volumen $STORAGE_VOLUME"
mkdir -p "$DEST" 2>/dev/null || die "no se puede crear $DEST (permisos/destino)"
FREE_MB=$(df -Pm "$DEST" | awk 'NR==2 {print $4}')
[ "${FREE_MB:-0}" -ge "$MIN_FREE_MB" ] || die "solo ${FREE_MB} MB libres en $DEST (mínimo $MIN_FREE_MB)"
mkdir -p "$OUT" 2>/dev/null || die "no se puede crear $OUT (permisos/destino)"
touch "$OUT/.write-test" 2>/dev/null && rm -f "$OUT/.write-test" || die "destino $OUT no escribible"

# SIN -i y con </dev/null: si este script llega por `bash -s` (stdin), un `docker exec -i` se tragaría el resto del
# script y bash terminaría con exit 0 sin haber hecho nada (fallo silencioso medido en el primer intento de F67).
# Solo lectura por PGOPTIONS (no con un `SET` dentro de -c: psql imprime «SET» y rompe el manifiesto JSON — medido).
psqlq() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null; }

T0=$(date +%s)
# 1 · Postgres (formato custom, validado con pg_restore -l ANTES de darlo por bueno).
log "pg_dump…"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d postgres -Fc > "$OUT/db.dump.partial" </dev/null || die "pg_dump"
docker exec -i "$DB_CONTAINER" pg_restore -l < "$OUT/db.dump.partial" > "$OUT/db.toc" || die "pg_restore -l no puede leer el dump"
mv "$OUT/db.dump.partial" "$OUT/db.dump"
TOC_ENTRIES=$(grep -vc '^;' "$OUT/db.toc" || true)

# 2 · Recuentos EXACTOS de las tablas críticas (para validar la restauración) y estado del esquema.
TABLES="profiles user_cards user_game user_pass user_packs credit_transactions economy_ops duel_decks duel_matches duel_match_actions duel_pvp_queue duel_pvp_ratings duel_pvp_rating_events duel_friendships duel_challenges content_cards content_card_versions content_packs content_pools content_pool_entries agents user_achievements user_sanctions content_audit_log"
: > "$OUT/table-counts.tsv"
for t in $TABLES; do
  n=$(psqlq "select count(*) from public.$t;" 2>/dev/null) || n="ERR"
  printf '%s\t%s\n' "$t" "$n" >> "$OUT/table-counts.tsv"
done
AUTH_USERS=$(psqlq "select count(*) from auth.users;")
printf 'auth.users\t%s\n' "$AUTH_USERS" >> "$OUT/table-counts.tsv"
PROBE=$(psqlq "select coalesce(app_admin_schema_probe()::text,'null');" 2>/dev/null || echo 'null')
PGVER=$(psqlq "show server_version;")
DBSIZE=$(psqlq "select pg_database_size(current_database());")

# 3 · Storage: tar del volumen + sha256 de CADA fichero + inventario de storage.objects en BD.
log "storage…"
docker run --rm --network none </dev/null -v "$STORAGE_VOLUME":/src:ro -v "$OUT":/dst alpine sh -c \
  'cd /src && tar czf /dst/storage.tgz . && (find . -type f -exec sha256sum {} + > /dst/storage-files.sha256 || true) && chown -R '"$(id -u):$(id -g)"' /dst/storage.tgz /dst/storage-files.sha256' \
  || die "tar del volumen de Storage"
STORAGE_FILES=$(wc -l < "$OUT/storage-files.sha256" | tr -d ' ')
psqlq "select bucket_id, name, coalesce(metadata->>'size','?'), coalesce(metadata->>'mimetype','?') from storage.objects order by 1,2;" > "$OUT/storage-objects.tsv" || die "inventario storage.objects"
STORAGE_OBJECTS=$(wc -l < "$OUT/storage-objects.tsv" | tr -d ' ')
BUCKETS=$(psqlq "select string_agg(id||':'||public::text, ',') from storage.buckets;")

# 4 · Manifiesto + SHA256SUMS verificados.
DUMP_BYTES=$(stat -c %s "$OUT/db.dump"); DUMP_SHA=$(sha256sum "$OUT/db.dump" | cut -d' ' -f1)
ST_BYTES=$(stat -c %s "$OUT/storage.tgz"); ST_SHA=$(sha256sum "$OUT/storage.tgz" | cut -d' ' -f1)
IMAGE=$(docker inspect "$DB_CONTAINER" --format '{{.Config.Image}}')
SECONDS_TAKEN=$(( $(date +%s) - T0 ))
cat > "$OUT/manifest.json" <<JSON
{
  "kind": "drlcards-backup",
  "version": 1,
  "createdAt": "$TS",
  "host": "$(hostname)",
  "expectedMigrationHead": "$EXPECTED_HEAD",
  "postgres": { "container": "$DB_CONTAINER", "image": "$IMAGE", "serverVersion": "$PGVER", "databaseBytes": $DBSIZE, "schemaProbe": $PROBE },
  "db": { "file": "db.dump", "format": "pg_dump custom (-Fc)", "bytes": $DUMP_BYTES, "sha256": "$DUMP_SHA", "tocEntries": $TOC_ENTRIES, "authUsers": $AUTH_USERS },
  "storage": { "volume": "$STORAGE_VOLUME", "file": "storage.tgz", "bytes": $ST_BYTES, "sha256": "$ST_SHA", "files": $STORAGE_FILES, "objectsInDb": $STORAGE_OBJECTS, "buckets": "$BUCKETS" },  "tableCounts": "table-counts.tsv",
  "consistency": "NO atómico entre BD y Storage: el dump es una instantánea transaccional de Postgres; el tar de Storage se toma después (segundos). Un objeto subido en esa ventana puede faltar en uno de los dos.",
  "seconds": $SECONDS_TAKEN
}
JSON
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$OUT/manifest.json" || die "manifest.json no es JSON válido"
grep -q "SET" "$OUT/table-counts.tsv" && die "recuentos contaminados"
( cd "$OUT" && sha256sum db.dump db.toc storage.tgz storage-files.sha256 storage-objects.tsv table-counts.tsv manifest.json > SHA256SUMS && sha256sum -c --quiet SHA256SUMS ) || die "verificación SHA256SUMS"
touch "$OUT/COMPLETE"
log "ok $OUT (db ${DUMP_BYTES} B, storage ${ST_BYTES} B, ${STORAGE_FILES} ficheros, ${SECONDS_TAKEN}s)"
# Marcador final: quien lea la salida (o el directorio) sabe que el script llegó al final. Sin él, NO es un backup.
echo "BACKUP_OK $OUT"

# 5 · Retención LOCAL (solo con LOCAL_KEEP > 0; solo en DEST). Nunca borra: la unidad de hoy, la última con copia
#     off-site verificada, ni una unidad con envío en curso. Las unidades sin COMPLETE no se tocan (se investigan).
if [ "$LOCAL_KEEP" -gt 0 ]; then
  last_off=$(for u in "$DEST"/2*Z; do if [ -f "$u/OFFSITE_VERIFIED" ]; then basename "$u"; fi; done 2>/dev/null | sort -r | head -1)
  n=0
  for u in $(for x in "$DEST"/2*Z; do if [ -d "$x" ] && [ ! -L "$x" ] && [ -f "$x/COMPLETE" ]; then basename "$x"; fi; done 2>/dev/null | sort -r); do
    [[ "$u" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
    n=$((n+1))
    if [ "$n" -le "$LOCAL_KEEP" ] || [ "$u" = "$TS" ] || [ "$u" = "$last_off" ] || [ -f "$DEST/$u/OFFSITE_IN_PROGRESS" ]; then continue; fi
    rm -rf -- "${DEST:?}/$u" && log "retención local: borrada $u"
  done
fi

# 6 · Off-site (mismo flujo). Sin configuración: no se intenta nada y production:check sigue diciendo NOT_CONFIGURED.
if [ -f "$OFFSITE_CONFIG" ]; then
  if [ -f "$OFFSITE_SCRIPT" ] && [ ! -L "$OFFSITE_SCRIPT" ]; then
    set +e
    DRL_BACKUP_LOCK_HELD=1 DRL_OFFSITE_CONFIG="$OFFSITE_CONFIG" DRL_BACKUP_ROOT="$(dirname "$DEST")" bash "$OFFSITE_SCRIPT" push "$OUT"
    orc=$?
    set -e
    [ "$orc" = 0 ] || { echo "OFFSITE_FAILED exit=$orc (la copia local $OUT es VÁLIDA)"; exit 3; }
  else
    echo "OFFSITE_FAILED backup-offsite.sh no instalado en $OFFSITE_SCRIPT (la copia local $OUT es VÁLIDA)"; exit 3
  fi
else
  echo "OFFSITE_NOT_CONFIGURED"
fi
