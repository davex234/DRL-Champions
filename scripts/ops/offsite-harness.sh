#!/usr/bin/env bash
# =============================================================================
# PRE-F70 · ARNÉS DEL OFF-SITE (fuera de CI). Se ejecuta EN EL VPS, en un directorio temporal AISLADO que borra al
# terminar. Prueba backup-offsite.sh + backup-drlcards.sh + restore-drill.sh contra un DESTINO SIMULADO (backend
# `local` de rclone montado en el contenedor) y contra destinos inalcanzables/credenciales falsas. NO es una copia
# off-site real y NO cambia production:check (que mira la configuración REAL del VPS, inexistente).
#
#   tar -C scripts/ops -cf - backup-offsite.sh backup-drlcards.sh backup-status.sh restore-drill.sh offsite-harness.sh \
#     | ssh -i ~/.ssh/id_ed25519 nexusadmin@212.95.40.144 \
#       'B=$(mktemp -d /tmp/drl-offsite-bin.XXXXXX); tar -xf - -C "$B"; BIN="$B" bash "$B/offsite-harness.sh"; rc=$?; rm -rf "$B"; exit $rc'
#
# Lee producción SOLO como lo hace el backup de siempre (pg_dump / tar del volumen, en solo lectura). Credenciales y
# claves del arnés: generadas aquí, efímeras, falsas y borradas al final. Salida: líneas «CASE <id> PASS|FAIL <dato>».
# =============================================================================
set -uo pipefail
umask 077
BIN="${BIN:?falta BIN (carpeta con los scripts)}"
T=$(mktemp -d /tmp/drl-offsite-harness.XXXXXX)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/root/verified" "$T/remote" "$T/remote-ret" "$T/cfg"
FAILS=0
case_() { local id=$1 ok=$2; shift 2; if [ "$ok" = 1 ]; then echo "CASE $id PASS $*"; else echo "CASE $id FAIL $*"; FAILS=$((FAILS+1)); fi; }
H0=$(date +%s)

# ── Material efímero de prueba (NUNCA se usa fuera del arnés) ───────────────────────────────────────────────────────
openssl req -x509 -newkey rsa:3072 -nodes -keyout "$T/cfg/key.pem" -out "$T/cfg/crt.pem" -days 1 -subj "/CN=drl-offsite-harness" >/dev/null 2>&1
chmod 600 "$T/cfg/key.pem"
IMG="rclone/rclone@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5"
FAKE_PASS="harness-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
OBSC=$(docker run --rm --network none "$IMG" obscure "$FAKE_PASS" 2>/dev/null)
FAKE_S3_KEY="HARNESSFAKEACCESS$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
FAKE_S3_SECRET="harness-fake-secret-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
timeout 10 ssh-keyscan -p 22 127.0.0.1 2>/dev/null > "$T/cfg/known_hosts"; chmod 600 "$T/cfg/known_hosts"
cat > "$T/cfg/rclone.conf" <<EOF
[harness]
type = local

[s3down]
type = s3
provider = Other
access_key_id = $FAKE_S3_KEY
secret_access_key = $FAKE_S3_SECRET
endpoint = https://10.255.255.1

[sftprefused]
type = sftp
host = 127.0.0.1
port = 1
user = drl-offsite-probe
pass = $OBSC
known_hosts_file = /config/known_hosts

[sftpwrong]
type = sftp
host = 127.0.0.1
port = 22
user = drl-offsite-probe
pass = $OBSC
known_hosts_file = /config/known_hosts

[plainhttp]
type = webdav
url = http://127.0.0.1:8080/dav

[ftpclear]
type = ftp
host = 127.0.0.1

[sftpnokh]
type = sftp
host = 127.0.0.1
user = x
EOF
chmod 600 "$T/cfg/rclone.conf"
mkcfg() {   # $1 fichero · resto: líneas extra
  local f=$1; shift
  { echo "DRL_OFFSITE_ENABLED=1"; echo "DRL_OFFSITE_REMOTE=harness:/remote"; echo "DRL_OFFSITE_RCLONE_CONFIG=$T/cfg/rclone.conf"
    echo "DRL_OFFSITE_RECIPIENT_CRT=$T/cfg/crt.pem"; echo "DRL_OFFSITE_CONTIMEOUT=3s"; echo "DRL_OFFSITE_IOTIMEOUT=20s"
    for l in "$@"; do echo "$l"; done; } > "$f"; chmod 600 "$f"
}
mkcfg "$T/cfg/offsite.env"
export DRL_OFFSITE_CONFIG="$T/cfg/offsite.env" DRL_BACKUP_ROOT="$T/root" DRL_OFFSITE_LOG="$T/offsite.log" DRL_BACKUP_LOCK="$T/root/.backup.lock"
export DRL_OFFSITE_TEST_REMOTE_DIR="$T/remote"
OFF() { bash "$BIN/backup-offsite.sh" "$@"; }

# ── 1 · FLUJO COMPLETO: datos de producción → unidad local verificada → off-site simulado → verificación ─────────────
t=$(date +%s)
out=$(DEST="$T/root/verified" OFFSITE_SCRIPT="$BIN/backup-offsite.sh" bash "$BIN/backup-drlcards.sh" 2>&1); rc=$?
U=$(echo "$out" | awk '/^BACKUP_OK/{print $2}'); TS=$(basename "${U:-x}")
[ $rc = 0 ] || echo "$out" | tail -25 | sed 's/^/DBG full-flow: /'
okrem=0; [ -f "$T/remote/$TS/REMOTE_VERIFIED" ] && [ -f "$T/remote/$TS/unit.tar.cms" ] && [ -f "$T/remote/$TS/offsite.json" ] && okrem=1
case_ full-flow "$([ $rc = 0 ] && echo "$out" | grep -q '^OFFSITE_OK' && [ -f "$U/OFFSITE_VERIFIED" ] && [ $okrem = 1 ] && echo 1 || echo 0)" \
  "exit=$rc unit=$TS secs=$(( $(date +%s) - t )) db=$(stat -c %s "$U/db.dump" 2>/dev/null) storage=$(stat -c %s "$U/storage.tgz" 2>/dev/null) cms=$(stat -c %s "$T/remote/$TS/unit.tar.cms" 2>/dev/null) unitBytes=$(du -sb "$U" 2>/dev/null | cut -f1) remoteFiles=$(ls "$T/remote/$TS" 2>/dev/null | tr '\n' ',')"
case_ remote-plaintext-free "$( ! tar -tf "$T/remote/$TS/unit.tar.cms" >/dev/null 2>&1 && ! grep -qa 'PGDMP' "$T/remote/$TS/unit.tar.cms" && echo 1 || echo 0)" "el .cms no es un tar legible ni contiene la cabecera PGDMP del dump"
case_ local-markers-private "$( [ "$(stat -c %a "$U/OFFSITE_VERIFIED")" = 600 ] && [ ! -e "$U/OFFSITE_IN_PROGRESS" ] && [ -z "$(ls -A "$T/root/.offsite-work" 2>/dev/null)" ] && echo 1 || echo 0)" "OFFSITE_VERIFIED 600, sin IN_PROGRESS, directorio de trabajo vacío"

# ── 2 · IDEMPOTENCIA: re-enviar la misma unidad no la corrompe ni la duplica ────────────────────────────────────────
h1=$(sha256sum "$T/remote/$TS/unit.tar.cms" | cut -d' ' -f1)
out=$(OFF push "$U" 2>&1); rc=$?
h2=$(sha256sum "$T/remote/$TS/unit.tar.cms" | cut -d' ' -f1)
case_ idempotency "$([ $rc = 0 ] && echo "$out" | grep -q 'already-verified' && [ "$h1" = "$h2" ] && echo 1 || echo 0)" "exit=$rc $(echo "$out" | grep OFFSITE_ | head -1) cmsUnchanged=$([ "$h1" = "$h2" ] && echo yes || echo no)"

# ── 3 · CONFIGURACIÓN: ausente / desactivada / inválida (nada se sube) ──────────────────────────────────────────────
out=$(DRL_OFFSITE_CONFIG=/nonexistent/offsite.env OFF push "$U" 2>&1); rc=$?
case_ config-missing "$([ $rc = 0 ] && echo "$out" | grep -qx OFFSITE_NOT_CONFIGURED && echo 1 || echo 0)" "exit=$rc"
mkcfg "$T/cfg/dis.env"; sed -i 's/^DRL_OFFSITE_ENABLED=1$/DRL_OFFSITE_ENABLED=0/' "$T/cfg/dis.env"
out=$(DRL_OFFSITE_CONFIG="$T/cfg/dis.env" OFF push "$U" 2>&1); rc=$?
case_ config-disabled "$([ $rc = 0 ] && echo "$out" | grep -qx OFFSITE_DISABLED && echo 1 || echo 0)" "exit=$rc"
bad() {   # $1 id · $2 fichero de configuración · $3 patrón esperado
  local o r; o=$(DRL_OFFSITE_CONFIG="$2" OFF push "$U" 2>&1); r=$?
  case_ "config-invalid-$1" "$([ $r = 2 ] && echo "$o" | grep -q "$3" && echo 1 || echo 0)" "exit=$r $(echo "$o" | grep -o 'OFFSITE_CONFIG_INVALID.*' | head -1)"
}
mkcfg "$T/cfg/b1.env"; chmod 644 "$T/cfg/b1.env";                                  bad world-readable "$T/cfg/b1.env" "permisos 644"
mkcfg "$T/cfg/b2.env" "DRL_OFFSITE_EVIL=1";                                          bad unknown-key "$T/cfg/b2.env" "clave desconocida"
mkcfg "$T/cfg/b3.env" 'DRL_OFFSITE_BWLIMIT=$(id)';                                   bad metachar "$T/cfg/b3.env" "metacaracteres"
mkcfg "$T/cfg/b4.env"; sed -i 's#^DRL_OFFSITE_REMOTE=.*#DRL_OFFSITE_REMOTE=harness:/remote/../../etc#' "$T/cfg/b4.env"; bad traversal "$T/cfg/b4.env" "no puede contener"
mkcfg "$T/cfg/b5.env" "DRL_OFFSITE_RCLONE_IMAGE=rclone/rclone:latest";              bad mutable-tag "$T/cfg/b5.env" "digest"
mkcfg "$T/cfg/b6.env"; sed -i 's#^DRL_OFFSITE_REMOTE=.*#DRL_OFFSITE_REMOTE=plainhttp:dav#' "$T/cfg/b6.env"; bad http-endpoint "$T/cfg/b6.env" "http://"
mkcfg "$T/cfg/b7.env"; sed -i 's#^DRL_OFFSITE_REMOTE=.*#DRL_OFFSITE_REMOTE=ftpclear:x#' "$T/cfg/b7.env"; bad ftp-plain "$T/cfg/b7.env" "FTP sin TLS"
mkcfg "$T/cfg/b8.env"; sed -i 's#^DRL_OFFSITE_REMOTE=.*#DRL_OFFSITE_REMOTE=sftpnokh:x#' "$T/cfg/b8.env"; bad sftp-no-known-hosts "$T/cfg/b8.env" "known_hosts"
ln -s "$T/cfg/offsite.env" "$T/cfg/link.env";                                        bad symlink-config "$T/cfg/link.env" "enlace simbólico"
mkcfg "$T/cfg/b9.env"; sed -i 's#^DRL_OFFSITE_REMOTE=.*#DRL_OFFSITE_REMOTE=nodefined:x#' "$T/cfg/b9.env"; bad undefined-remote "$T/cfg/b9.env" "no está definido"
cp "$T/cfg/crt.pem" "$T/cfg/notcert.pem"; echo garbage > "$T/cfg/notcert.pem"; mkcfg "$T/cfg/b10.env"; sed -i "s#^DRL_OFFSITE_RECIPIENT_CRT=.*#DRL_OFFSITE_RECIPIENT_CRT=$T/cfg/notcert.pem#" "$T/cfg/b10.env"; bad bad-cert "$T/cfg/b10.env" "X.509"
out=$(OFF check-config 2>&1); case_ check-config-ok "$(echo "$out" | grep -q '^OFFSITE_CONFIG_OK type=local' && echo 1 || echo 0)" "$(echo "$out" | head -1)"

# ── 4 · UNIDADES QUE NO SE SUBEN: incompleta, manipulada, con enlaces, fuera de la raíz, nombre raro ────────────────
mk_unit() { local ts=$1; mkdir -p "$T/root/verified/$ts"; cp -p "$U"/db.dump "$U"/db.toc "$U"/storage.tgz "$U"/storage-files.sha256 "$U"/storage-objects.tsv "$U"/table-counts.tsv "$U"/manifest.json "$U"/SHA256SUMS "$U"/COMPLETE "$T/root/verified/$ts/"; echo "$T/root/verified/$ts"; }
refused() { local id=$1 dir=$2 pat=$3 o r; o=$(OFF push "$dir" 2>&1); r=$?; case_ "refused-$id" "$([ $r = 2 ] && echo "$o" | grep -q "$pat" && [ ! -e "$T/remote/$(basename "$dir")" ] && echo 1 || echo 0)" "exit=$r $(echo "$o" | grep -o 'OFFSITE_REFUSED.*' | head -1)"; }
X=$(mk_unit 20260101T000001Z); rm "$X/COMPLETE";                        refused incomplete "$X" "no está COMPLETE"
X=$(mk_unit 20260101T000002Z); printf 'x' >> "$X/table-counts.tsv";     refused tampered "$X" "SHA256SUMS no cuadra"
X=$(mk_unit 20260101T000003Z); ln -s /etc/passwd "$X/extra";           refused symlink-inside "$X" "enlaces"
X=$(mk_unit 20260101T000004Z); echo hola > "$X/intruso.txt";            refused foreign-file "$X" "fichero ajeno"
mkdir -p "$T/outside/20260101T000005Z"; cp -p "$U"/* "$T/outside/20260101T000005Z/" 2>/dev/null; refused outside-root "$T/outside/20260101T000005Z" "fuera de"
refused traversal-path "$T/root/verified/../../outside/20260101T000005Z" "fuera de"
X=$(mk_unit 20260101T000006Z); mv "$X" "$T/root/verified/evil-name"; refused bad-name "$T/root/verified/evil-name" "nombre de unidad"
ln -s "$U" "$T/root/verified/20260101T000007Z";                         refused symlinked-unit "$T/root/verified/20260101T000007Z" "enlace simbólico"

# ── 5 · TRANSFERENCIA PARCIAL, ABORTO ANTES DEL MARCADOR, REINTENTO ──────────────────────────────────────────────────
P=$(mk_unit 20260102T000000Z); PT=$(basename "$P")
out=$(DRL_OFFSITE_TEST_FAULT=partial-upload OFF push "$P" 2>&1); rc=$?
case_ partial-transfer "$([ $rc = 1 ] && [ ! -f "$T/remote/$PT/REMOTE_VERIFIED" ] && [ -f "$P/OFFSITE_FAILED" ] && [ ! -f "$P/OFFSITE_VERIFIED" ] && [ ! -f "$P/OFFSITE_IN_PROGRESS" ] && echo 1 || echo 0)" "exit=$rc failedAt=$(cat "$P/OFFSITE_FAILED" 2>/dev/null) remoteMarker=$([ -f "$T/remote/$PT/REMOTE_VERIFIED" ] && echo yes || echo no)"
( cd "$P" && sha256sum -c --quiet SHA256SUMS ) >/dev/null 2>&1; lv=$?
case_ local-intact-after-failure "$([ $lv = 0 ] && [ -f "$P/COMPLETE" ] && echo 1 || echo 0)" "la unidad local sigue válida tras el fallo"
out=$(OFF verify "$PT" 2>&1); rc=$?
case_ verify-partial-fails "$([ $rc = 1 ] && echo "$out" | grep -q OFFSITE_VERIFY_FAIL && echo 1 || echo 0)" "exit=$rc"
out=$(DRL_OFFSITE_TEST_FAULT=abort-before-marker OFF push "$P" 2>&1); rc=$?
case_ abort-before-marker "$([ $rc = 1 ] && [ -f "$T/remote/$PT/unit.tar.cms" ] && [ ! -f "$T/remote/$PT/REMOTE_VERIFIED" ] && echo 1 || echo 0)" "exit=$rc (copia completa pero SIN marcador → no válida)"
out=$(OFF verify "$PT" 2>&1); rc=$?
case_ verify-no-marker-fails "$([ $rc = 1 ] && echo 1 || echo 0)" "exit=$rc"
st=$(cat "$T/root/offsite-status"); case_ status-records-failure "$(echo "$st" | grep -q "^failed $PT" && echo 1 || echo 0)" "$st"
out=$(OFF push "$P" 2>&1); rc=$?
case_ retry-success "$([ $rc = 0 ] && [ -f "$T/remote/$PT/REMOTE_VERIFIED" ] && [ -f "$P/OFFSITE_VERIFIED" ] && [ ! -f "$P/OFFSITE_FAILED" ] && echo 1 || echo 0)" "exit=$rc $(echo "$out" | grep OFFSITE_OK)"

# ── 6 · CORRUPCIÓN de la copia remota: la verificación la detecta; el siguiente envío la sustituye ───────────────────
printf '\x00' | dd of="$T/remote/$PT/unit.tar.cms" bs=1 seek=100 conv=notrunc 2>/dev/null
out=$(OFF verify "$PT" 2>&1); rc=$?
case_ corruption-detected "$([ $rc = 1 ] && grep -q "verify unit=$PT HASH_MISMATCH" "$T/offsite.log" && echo 1 || echo 0)" "exit=$rc $(grep "verify unit=$PT" "$T/offsite.log" | tail -1 | awk '{print $NF}')"
out=$(OFF push "$P" 2>&1); rc=$?
out2=$(OFF verify "$PT" 2>&1); rc2=$?
case_ corruption-healed-by-push "$([ $rc = 0 ] && [ $rc2 = 0 ] && echo 1 || echo 0)" "push=$rc verify=$rc2 (una copia remota que no verifica se vuelve a subir)"
python3 - "$T/remote/$PT/REMOTE_VERIFIED" <<'PY'
import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["cmsSha256"]="0"*64; json.dump(d,open(p,"w"))
PY
out=$(OFF verify "$PT" 2>&1); rc=$?
case_ marker-tamper-detected "$([ $rc = 1 ] && echo 1 || echo 0)" "exit=$rc $(grep "verify unit=$PT" "$T/offsite.log" | tail -1 | awk '{print $NF}')"

# ── 7 · RED Y PROVEEDOR: sin ruta (timeout), rechazado, credenciales falsas, disco lleno ─────────────────────────────
netcase() {   # $1 id · $2 remoto · $3 red
  local u o r t0 f; u=$(mk_unit "$4"); t0=$(date +%s)
  mkcfg "$T/cfg/n.env" "DRL_OFFSITE_SSH_KNOWN_HOSTS=$T/cfg/known_hosts"; sed -i "s#^DRL_OFFSITE_REMOTE=.*#DRL_OFFSITE_REMOTE=$2#" "$T/cfg/n.env"
  o=$(DRL_OFFSITE_CONFIG="$T/cfg/n.env" DRL_OFFSITE_TEST_REMOTE_DIR="" DRL_OFFSITE_TEST_NETWORK="$3" OFF push "$u" 2>&1); r=$?
  f=$(cat "$u/OFFSITE_FAILED" 2>/dev/null)
  ( cd "$u" && sha256sum -c --quiet SHA256SUMS ) >/dev/null 2>&1; local lv=$?
  case_ "$1" "$([ $r = 1 ] && [ ! -f "$u/OFFSITE_VERIFIED" ] && [ -n "$f" ] && [ $lv = 0 ] && echo 1 || echo 0)" "exit=$r secs=$(( $(date +%s) - t0 )) failed=$f localValid=$([ $lv = 0 ] && echo yes || echo no)"
}
netcase network-timeout "s3down:drl-bucket" bridge 20260103T000001Z
netcase destination-refused "sftprefused:drl" host 20260103T000002Z
netcase wrong-credentials "sftpwrong:drl" host 20260103T000003Z
D=$(mk_unit 20260103T000004Z)
out=$(DRL_OFFSITE_TEST_REMOTE_DIR="" DRL_OFFSITE_TEST_REMOTE_TMPFS=512k OFF push "$D" 2>&1); rc=$?
case_ remote-disk-full "$([ $rc = 1 ] && [ ! -f "$D/OFFSITE_VERIFIED" ] && grep -q '"stage":"upload"' "$D/OFFSITE_FAILED" && echo 1 || echo 0)" "exit=$rc failed=$(cat "$D/OFFSITE_FAILED" 2>/dev/null)"
leak=0; for s in "$FAKE_PASS" "$OBSC" "$FAKE_S3_KEY" "$FAKE_S3_SECRET" "BEGIN PRIVATE KEY"; do grep -rqF -- "$s" "$T/offsite.log" "$T/root" 2>/dev/null && leak=1; done
case_ no-credential-leak "$([ $leak = 0 ] && echo 1 || echo 0)" "log y marcadores sin claves, contraseñas (en claro u ofuscadas) ni material privado"
case_ log-has-no-destination "$( ! grep -q "10.255.255.1\|/remote\b\|drl-bucket" "$T/offsite.log" && echo 1 || echo 0)" "el registro nombra el remoto (nombre:) y el tipo, no el endpoint ni la ruta"

# ── 8 · CONCURRENCIA: con el candado cogido, ni el backup ni el envío arrancan (75) ─────────────────────────────────
( exec 8>>"$T/root/.backup.lock"; flock 8; sleep 8 ) & LP=$!; sleep 1
o1=$(OFF push "$P" 2>&1); r1=$?
o2=$(DEST="$T/root/verified" OFFSITE_SCRIPT="$BIN/backup-offsite.sh" bash "$BIN/backup-drlcards.sh" 2>&1); r2=$?
wait $LP
case_ concurrency-lock "$([ $r1 = 75 ] && [ $r2 = 75 ] && echo 1 || echo 0)" "offsite=$r1 backup=$r2"

# ── 9 · RETENCIÓN remota (destino de retención aparte, unidades sintéticas con fechas relativas) ────────────────────
mkcfg "$T/cfg/ret.env" "DRL_OFFSITE_RETENTION=script" "DRL_OFFSITE_KEEP_DAILY=3" "DRL_OFFSITE_KEEP_WEEKLY=4" "DRL_OFFSITE_KEEP_MONTHLY=2"
fake() { local ts=$1 v=$2; mkdir -p "$T/remote-ret/$ts"; echo x > "$T/remote-ret/$ts/unit.tar.cms"; [ "$v" = 1 ] && echo '{}' > "$T/remote-ret/$ts/REMOTE_VERIFIED"; return 0; }
tsd() { date -u -d "$1" +%Y%m%dT%H%M%SZ; }
day() { date -u -d "$(date -u -d "$1 days ago" +%Y-%m-%d) 05:10:00" +%Y%m%dT%H%M%SZ; }   # hora fija: nombre estable
out=$(DRL_OFFSITE_CONFIG="$T/cfg/ret.env" DRL_OFFSITE_TEST_REMOTE_DIR="$T/remote-ret" OFF retention 2>&1); rc=$?
case_ retention-empty-safe "$([ $rc = 0 ] && echo "$out" | grep -q OFFSITE_RETENTION_SKIP && echo 1 || echo 0)" "sin unidades verificadas no se borra nada"
[ $rc = 0 ] && echo "$out" | grep -q OFFSITE_RETENTION_SKIP || echo "$out" | tail -8 | sed "s/^/DBG retention-empty: /"
PREC=$(tsd '1 hour ago'); POLD=$(tsd '5 days ago'); fake "$PREC" 0; fake "$POLD" 0      # parcial reciente / parcial vieja
for n in 1 2 3 4 5 6 8 10 20 40 70 100; do fake "$(day $n)" 1; done
SUN=""; for n in $(seq 14 40); do [ "$(date -u -d "$n days ago" +%u)" = 7 ] && { SUN=$(day $n); break; }; done; fake "$SUN" 1
MON=$(date -u -d "$(date -u +%Y-%m-01) -2 months 05:10:00" +%Y%m%dT%H%M%SZ); fake "$MON" 1
OLDEST=$(day 100)
before=$(ls "$T/remote-ret" | wc -l)
out=$(DRL_OFFSITE_CONFIG="$T/cfg/ret.env" DRL_OFFSITE_TEST_REMOTE_DIR="$T/remote-ret" OFF retention 2>&1); rc=$?
after=$(ls "$T/remote-ret" | wc -l)
has() { [ -d "$T/remote-ret/$1" ] && echo 1 || echo 0; }
w7=1; for n in 1 2 3 4 5 6; do [ "$(has "$(day $n)")" = 1 ] || w7=0; done
ok=0; [ $rc = 0 ] && [ "$after" -lt "$before" ] && [ "$(has "$(day 1)")" = 1 ] && [ $w7 = 1 ] && [ "$(has "$PREC")" = 1 ] && [ "$(has "$POLD")" = 0 ] \
  && [ "$(has "$SUN")" = 1 ] && [ "$(has "$MON")" = 1 ] && [ "$(has "$OLDEST")" = 0 ] && ok=1
case_ retention-policy "$ok" "before=$before after=$after keep=$(echo "$out" | grep -c ^KEEP) delete=$(echo "$out" | grep -c ^DELETE) · latest=$(has "$(day 1)") 7d=$w7 partial<48h=$(has "$PREC") partialOld=$(has "$POLD") weekly=$(has "$SUN") monthly=$(has "$MON") day100=$(has "$OLDEST")"
echo "$out" | grep -E '^(KEEP|DELETE)' | sed 's/^/RET /'
mkcfg "$T/cfg/ret2.env"; before2=$(ls "$T/remote-ret" | wc -l)
out=$(DRL_OFFSITE_CONFIG="$T/cfg/ret2.env" DRL_OFFSITE_TEST_REMOTE_DIR="$T/remote-ret" OFF retention 2>&1)
case_ retention-provider-default "$([ "$(ls "$T/remote-ret" | wc -l)" = "$before2" ] && echo "$out" | grep -q RETENTION_PROVIDER && echo 1 || echo 0)" "por defecto el VPS no borra nada en el destino"

# ── 10 · RETENCIÓN LOCAL de backup-drlcards (LOCAL_KEEP) sobre unidades de PRUEBA ────────────────────────────────────
L="$T/root/local-ret"; mkdir -p "$L"
for n in 10 9 8 7; do x="$L/$(day $n)"; mkdir -p "$x"; touch "$x/COMPLETE"; done
off=$(day 9); touch "$L/$off/OFFSITE_VERIFIED"; inprog=$(day 10); touch "$L/$inprog/OFFSITE_IN_PROGRESS"
d8=$(day 8); d7=$(day 7); inc="$L/$(day 11)"; mkdir -p "$inc"                                # sin COMPLETE: no se toca
out=$(DEST="$L" LOCAL_KEEP=2 DRL_OFFSITE_CONFIG=/nonexistent bash "$BIN/backup-drlcards.sh" 2>&1); rc=$?
new=$(echo "$out" | awk '/^BACKUP_OK/{print $2}')
[ $rc = 0 ] || echo "$out" | tail -8 | sed "s/^/DBG local-retention: /"
kept=$(ls "$L" | tr '\n' ' ')
case_ local-retention "$([ $rc = 0 ] && [ -d "$new" ] && [ -d "$L/$d7" ] && [ -d "$L/$off" ] && [ -d "$L/$inprog" ] && [ -d "$inc" ] && [ ! -d "$L/$d8" ] && echo 1 || echo 0)" "exit=$rc quedan: $kept (borrada: $d8)"
case_ local-offsite-not-configured "$(echo "$out" | grep -qx OFFSITE_NOT_CONFIGURED && echo 1 || echo 0)" "sin configuración: backup local OK, sin intento de envío"

# ── 11 · FRESCURA (backup-status.sh sobre la raíz del arnés) ─────────────────────────────────────────────────────────
echo "STATUS_BEGIN"; bash "$BIN/backup-status.sh"; echo "STATUS_END"
touch -d '30 hours ago' "$U/OFFSITE_VERIFIED" "$P/OFFSITE_VERIFIED"
echo "STATUS_STALE_BEGIN"; bash "$BIN/backup-status.sh" | grep '^OFFSITE'; echo "STATUS_STALE_END"
echo "STATUS_NOCFG_BEGIN"; DRL_OFFSITE_CONFIG=/nonexistent bash "$BIN/backup-status.sh" | grep '^OFFSITE_CONFIG'; echo "STATUS_NOCFG_END"

# ── 12 · RESTAURACIÓN DESDE EL DESTINO: fetch → verificar → descifrar → restore-drill.sh (motor de siempre) ─────────
# La clave PRIVADA solo existe en el arnés (en producción vive fuera del VPS, en la máquina de recuperación).
printf 'DRL_OFFSITE_DECRYPT_KEY=%s\n' "$T/cfg/key.pem" >> "$T/cfg/offsite.env"
out=$(OFF fetch "$TS" "$T/restore-src" 2>&1); rc=$?
case_ fetch-decrypt "$([ $rc = 0 ] && [ -f "$T/restore-src/unit/COMPLETE" ] && echo 1 || echo 0)" "exit=$rc $(echo "$out" | grep -o 'OFFSITE_FETCH_OK [^ ]*')"
out=$(OFF fetch "$TS" "$T/restore-src" 2>&1); rc=$?
case_ fetch-refuses-existing-dest "$([ $rc = 2 ] && echo 1 || echo 0)" "exit=$rc"
out=$(SRC="$T/restore-src/unit" bash "$BIN/restore-drill.sh" 2>&1); rc=$?
echo "DRILL_JSON $(echo "$out" | grep '^{' | tail -1)"
case_ restore-drill-from-offsite "$([ $rc = 0 ] && echo "$out" | grep -q '^DRILL_OK' && echo 1 || echo 0)" "exit=$rc $(echo "$out" | grep -E '^DRILL_(OK|FAIL)')"
# Storage NO vacío por la misma cadena: unidad de prueba con 3 objetos en storage.tgz.
S=$(mk_unit 20260104T000000Z); mkdir -p "$T/st/stub/assets"; for i in 1 2 3; do head -c $((4096*i)) /dev/urandom > "$T/st/stub/assets/obj$i.bin"; done
( cd "$T/st" && tar czf "$S/storage.tgz" . && find . -type f -exec sha256sum {} + > "$S/storage-files.sha256" )
( cd "$S" && sha256sum db.dump db.toc storage.tgz storage-files.sha256 storage-objects.tsv table-counts.tsv manifest.json > SHA256SUMS )
out=$(OFF push "$S" 2>&1); rc=$?
out2=$(OFF fetch 20260104T000000Z "$T/restore-st" 2>&1); rc2=$?
out3=$(SRC="$T/restore-st/unit" bash "$BIN/restore-drill.sh" 2>&1); rc3=$?
echo "DRILL_ST_JSON $(echo "$out3" | grep '^{' | tail -1)"
case_ storage-nonempty-chain "$([ $rc = 0 ] && [ $rc2 = 0 ] && [ $rc3 = 0 ] && echo "$out3" | grep -q '"storageFiles":3' && echo 1 || echo 0)" "push=$rc fetch=$rc2 drill=$rc3"

# ── 13 · F70 · CONFIGURACIÓN DE RECUPERACIÓN (decisión B) con un stack FALSO: cifrada dentro del .cms, nunca en claro ─
FAKE_MARK="HARNESS_FAKE_JWT_$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
mkdir -p "$T/stack/kong" "$T/stack/snippets"
printf 'services:\n  auth:\n    environment:\n      GOTRUE_JWT_SECRET: %s\n' "$FAKE_MARK" > "$T/stack/compose.yml"
printf '_format_version: "2.1"\n# %s\n' "$FAKE_MARK" > "$T/stack/kong/kong.yml"
printf 'fake-key %s\n' "$FAKE_MARK" > "$T/stack/kong/localhost.key"; chmod 644 "$T/stack/compose.yml" "$T/stack/kong/"*
case_ default-no-recovery "$(grep -q '"recoveryConfigPresent":false' "$T/remote/$TS/offsite.json" && echo 1 || echo 0)" "sin DRL_OFFSITE_RECOVERY_DIR el manifiesto dice false"
mkcfg "$T/cfg/offsite-rc.env" "DRL_OFFSITE_RECOVERY_DIR=$T/stack" "DRL_OFFSITE_RECOVERY_PATHS=\"compose.yml kong snippets\"" "DRL_OFFSITE_DECRYPT_KEY=$T/cfg/key.pem"
R=$(mk_unit 20260105T000000Z)
out=$(DRL_OFFSITE_CONFIG="$T/cfg/offsite-rc.env" OFF check-config 2>&1)
case_ recovery-check-config "$(echo "$out" | grep -q 'recoveryConfig=on' && echo 1 || echo 0)" "$(echo "$out" | grep -o 'recoveryConfig=[a-z]*')"
out=$(DRL_OFFSITE_CONFIG="$T/cfg/offsite-rc.env" OFF push "$R" 2>&1); rc=$?
case_ recovery-push "$([ $rc = 0 ] && grep -q '"recoveryConfigPresent":true' "$T/remote/20260105T000000Z/offsite.json" && [ -f "$T/remote/20260105T000000Z/REMOTE_VERIFIED" ] && echo 1 || echo 0)" "exit=$rc"
leak=0; grep -rqa "$FAKE_MARK" "$T/remote/20260105T000000Z" "$T/offsite.log" "$T/root/offsite-status" "$R" && leak=1; echo "$out" | grep -q "$FAKE_MARK" && leak=1
[ -z "$(ls -A "$T/root/.offsite-work" 2>/dev/null)" ] || leak=1
case_ recovery-no-plaintext "$([ $leak = 0 ] && echo 1 || echo 0)" "el secreto falso no aparece en el destino, log, stdout, estado ni unidad local; trabajo vacío"
out=$(DRL_OFFSITE_CONFIG="$T/cfg/offsite-rc.env" OFF fetch 20260105T000000Z "$T/restore-rc" 2>&1); rc=$?
okf=0; [ $rc = 0 ] && cmp -s "$T/stack/compose.yml" "$T/restore-rc/recovery-config/compose.yml" && cmp -s "$T/stack/kong/kong.yml" "$T/restore-rc/recovery-config/kong/kong.yml" \
  && cmp -s "$T/stack/kong/localhost.key" "$T/restore-rc/recovery-config/kong/localhost.key" && [ -d "$T/restore-rc/recovery-config/snippets" ] && okf=1
perm=$(find "$T/restore-rc/recovery-config" \( -type f ! -perm 600 \) -o \( -type d ! -perm 700 \) | wc -l)
case_ recovery-fetch-restore "$([ $okf = 1 ] && [ "$perm" = 0 ] && [ ! -e "$T/restore-rc/unit/recovery-config.tar" ] && echo "$out" | grep -q 'recovery-config=' && ! echo "$out" | grep -q "$FAKE_MARK" && echo 1 || echo 0)" "exit=$rc idénticos=$okf permisosMal=$perm"
out=$(SRC="$T/restore-rc/unit" bash "$BIN/restore-drill.sh" 2>&1); rc=$?
case_ recovery-unit-still-restorable "$([ $rc = 0 ] && echo "$out" | grep -q '^DRILL_OK' && echo 1 || echo 0)" "exit=$rc $(echo "$out" | grep -E '^DRILL_(OK|FAIL)')"
ln -s /etc/passwd "$T/stack/kong/evil"
out=$(DRL_OFFSITE_CONFIG="$T/cfg/offsite-rc.env" OFF check-config 2>&1); rc=$?
case_ recovery-refuses-symlink "$([ $rc = 2 ] && echo "$out" | grep -q 'enlaces' && echo 1 || echo 0)" "exit=$rc"
rm -f "$T/stack/kong/evil"
mkcfg "$T/cfg/offsite-rc2.env" "DRL_OFFSITE_RECOVERY_DIR=$T/stack" "DRL_OFFSITE_RECOVERY_PATHS=\"../cfg\""
out=$(DRL_OFFSITE_CONFIG="$T/cfg/offsite-rc2.env" OFF check-config 2>&1); rc=$?
case_ recovery-refuses-traversal "$([ $rc = 2 ] && echo 1 || echo 0)" "exit=$rc"

echo "HARNESS_DONE fails=$FAILS secs=$(( $(date +%s) - H0 ))"
exit $(( FAILS > 0 ? 1 : 0 ))
