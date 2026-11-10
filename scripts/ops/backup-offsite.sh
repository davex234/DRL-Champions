#!/usr/bin/env bash
# =============================================================================
# PRE-F70 · COPIA OFF-SITE VERIFICADA de las unidades de `backup-drlcards.sh` (F67). NO es otro sistema de backup:
# no crea copias, envía FUERA DEL VPS la unidad canónica ya verificada (manifest.json + SHA256SUMS + COMPLETE) y la da
# por buena solo tras LEERLA DE VUELTA del destino.
# =============================================================================
#   backup-offsite.sh push <unidad>        cifra, sube, verifica leyendo de vuelta, marca REMOTE_VERIFIED
#   backup-offsite.sh verify <TS>          re-verifica una unidad remota (descarga y compara hashes)
#   backup-offsite.sh fetch <TS> <dir>     recuperación: descarga, verifica y (con clave privada) descifra y comprueba
#   backup-offsite.sh retention            poda remota (solo con DRL_OFFSITE_RETENTION=script)
#   backup-offsite.sh check-config         valida la configuración sin tocar la red
#   backup-offsite.sh status               estado local (última copia off-site verificada / último fallo)
#
# TRANSPORTE: rclone (imagen de contenedor fijada por digest; nada instalado en el host). Un solo adaptador para
# S3-compatibles, SFTP/SSH, B2, WebDAV, rutas montadas… El proveedor y sus credenciales viven en un rclone.conf 600
# FUERA del repositorio; este script solo conoce el NOMBRE del remoto.
#
# CONFIGURACIÓN (fichero KEY=VALUE, 600, sin código ejecutable; ruta: DRL_OFFSITE_CONFIG):
#   DRL_OFFSITE_ENABLED=1                        0/ausente = desactivado (el backup local sigue igual)
#   DRL_OFFSITE_REMOTE=drloffsite:<bucket>/drlcards
#   DRL_OFFSITE_RCLONE_CONFIG=/ruta/rclone.conf  (600; credenciales del proveedor)
#   DRL_OFFSITE_RECIPIENT_CRT=/ruta/backup-recipient.crt  (certificado PÚBLICO; la clave privada NO vive en el VPS)
#   DRL_OFFSITE_RCLONE_IMAGE=rclone/rclone@sha256:…       (opcional; por defecto el digest validado)
#   DRL_OFFSITE_RETENTION=provider|script        (por defecto provider: el VPS nunca borra en el destino)
#   DRL_OFFSITE_KEEP_DAILY/WEEKLY/MONTHLY=14/8/6 (solo con retention=script)
#   DRL_OFFSITE_SSH_KNOWN_HOSTS=/ruta/known_hosts  (obligatorio con sftp; en rclone.conf: known_hosts_file = /config/known_hosts)
#   DRL_OFFSITE_CONTIMEOUT=15s  DRL_OFFSITE_IOTIMEOUT=120s  DRL_OFFSITE_BWLIMIT=  (opcionales)
#   DRL_OFFSITE_RECOVERY_DIR=/opt/nexus/projects/supabase-drlcards   (F70 · decisión B, opcional) configuración del
#   DRL_OFFSITE_RECOVERY_PATHS="compose.yml kong snippets"            stack que NO está en el repo (JWT secret, claves):
#     viaja SOLO dentro del .cms cifrado, nunca en claro, en el log ni en offsite.json (que solo dice
#     recoveryConfigPresent). `fetch` con clave privada la restaura en <dir>/recovery-config con 700/600.
#
# GARANTÍAS
#   · Solo sube unidades COMPLETE cuyo SHA256SUMS cuadra, sin enlaces simbólicos ni ficheros ajenos, dentro de la raíz.
#   · Lo que sale del VPS va CIFRADO (CMS AES-256-GCM) para un certificado cuya clave privada no está aquí.
#   · Atomicidad: sube a <TS>/ SIN marcador → descarga y compara → escribe REMOTE_VERIFIED el último. Sin marcador (o
#     con un marcador cuyo hash no cuadra) una unidad remota NO es válida. Reintentar es seguro (idempotente).
#   · Estado local por unidad: OFFSITE_IN_PROGRESS → OFFSITE_VERIFIED | OFFSITE_FAILED; resumen en offsite-status.
#   · No imprime credenciales ni la ruta del destino; registra id de unidad, etapa, resultado, duración y bytes.
#
# SALIDA: 0 ok/desactivado · 1 fallo de transferencia o verificación · 2 configuración no válida · 75 candado ocupado.
# =============================================================================
set -Eeuo pipefail
umask 077

CONFIG="${DRL_OFFSITE_CONFIG:-/opt/nexus/projects/supabase-drlcards/backup/offsite.env}"
BACKUP_ROOT="${DRL_BACKUP_ROOT:-/opt/nexus/backups/supabase-drlcards}"
LOG_FILE="${DRL_OFFSITE_LOG:-/opt/nexus/logs/drlcards-offsite.log}"
LOCK_FILE="${DRL_BACKUP_LOCK:-$BACKUP_ROOT/.backup.lock}"
DEFAULT_IMAGE="rclone/rclone@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5"   # v1.75.1
# Ganchos SOLO de prueba (arnés offsite-harness.sh): destino local montado en el contenedor y fallos inyectados.
TEST_REMOTE_DIR="${DRL_OFFSITE_TEST_REMOTE_DIR:-}"
TEST_REMOTE_TMPFS="${DRL_OFFSITE_TEST_REMOTE_TMPFS:-}"
TEST_FAULT="${DRL_OFFSITE_TEST_FAULT:-}"
TEST_NETWORK="${DRL_OFFSITE_TEST_NETWORK:-}"

MODE="${1:-}"
T0=$(date +%s)
WORK=""
UNIT_DIR=""
STAGE="init"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
log() { local l; l="$(date -u +%Y-%m-%dT%H:%M:%SZ) offsite $*"; echo "$l"; echo "$l" >> "$LOG_FILE" 2>/dev/null || true; }
cfg_fail() { log "CONFIG_INVALID $*"; echo "OFFSITE_CONFIG_INVALID $*"; exit 2; }

cleanup() {
  local rc=$?
  [ -n "$WORK" ] && [ -d "$WORK" ] && rm -rf "$WORK"
  # Red de seguridad: una salida anómala que se salte on_error (p. ej. set -u) deja igualmente rastro del fallo.
  if [ "$rc" -ne 0 ] && [ "$MODE" = push ] && [ -n "$UNIT_DIR" ] && [ -f "$UNIT_DIR/OFFSITE_IN_PROGRESS" ]; then
    printf '{"stage":"%s","at":"%s","exit":%s,"abnormal":true}\n' "$STAGE" "$(date -u +%FT%TZ)" "$rc" > "$UNIT_DIR/OFFSITE_FAILED" 2>/dev/null || true
    rm -f "$UNIT_DIR/OFFSITE_IN_PROGRESS" 2>/dev/null || true
    echo "failed $(basename "$UNIT_DIR") $(date -u +%FT%TZ) $STAGE" > "$BACKUP_ROOT/offsite-status" 2>/dev/null || true
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) offsite FAIL unit=$(basename "$UNIT_DIR") stage=$STAGE exit=$rc abnormal" >> "$LOG_FILE" 2>/dev/null || true
  fi
  return 0
}
on_error() {
  local rc=$?
  # Con `set -E` la trampa se HEREDA en $(…) y <(…): ahí no se escribe nada (su salida acabaría leída como datos,
  # medido en el arnés); el subshell sale con error y quien lo llamó decide.
  [ "$BASHPID" = "$$" ] || exit 1
  [ "$MODE" = "push" ] && [ -n "$UNIT_DIR" ] && {
    printf '{"stage":"%s","at":"%s","exit":%s}\n' "$STAGE" "$(date -u +%FT%TZ)" "$rc" > "$UNIT_DIR/OFFSITE_FAILED" 2>/dev/null || true
    rm -f "$UNIT_DIR/OFFSITE_IN_PROGRESS" 2>/dev/null || true
    echo "failed $(basename "$UNIT_DIR") $(date -u +%FT%TZ) $STAGE" > "$BACKUP_ROOT/offsite-status" 2>/dev/null || true
  }
  log "FAIL unit=${UNIT_DIR:+$(basename "$UNIT_DIR")} stage=$STAGE exit=$rc seconds=$(( $(date +%s) - T0 ))"
  echo "OFFSITE_FAILED stage=$STAGE"
  cleanup
  exit 1
}
trap on_error ERR
trap cleanup EXIT

# ── Configuración: se PARSEA (nunca `source`): solo claves conocidas, valores validados ────────────────────────────────
ALLOWED=" DRL_OFFSITE_ENABLED DRL_OFFSITE_REMOTE DRL_OFFSITE_RCLONE_CONFIG DRL_OFFSITE_RECIPIENT_CRT DRL_OFFSITE_RCLONE_IMAGE DRL_OFFSITE_RETENTION DRL_OFFSITE_KEEP_DAILY DRL_OFFSITE_KEEP_WEEKLY DRL_OFFSITE_KEEP_MONTHLY DRL_OFFSITE_CONTIMEOUT DRL_OFFSITE_IOTIMEOUT DRL_OFFSITE_BWLIMIT DRL_OFFSITE_DECRYPT_KEY DRL_OFFSITE_SSH_KNOWN_HOSTS DRL_OFFSITE_RECOVERY_DIR DRL_OFFSITE_RECOVERY_PATHS "
DRL_OFFSITE_RECOVERY_DIR=""; DRL_OFFSITE_RECOVERY_PATHS="compose.yml kong"; RC_MAX_BYTES=$((10*1024*1024))
DRL_OFFSITE_ENABLED=0; DRL_OFFSITE_REMOTE=""; DRL_OFFSITE_RCLONE_CONFIG=""; DRL_OFFSITE_RECIPIENT_CRT=""
DRL_OFFSITE_RCLONE_IMAGE="$DEFAULT_IMAGE"; DRL_OFFSITE_RETENTION="provider"
DRL_OFFSITE_KEEP_DAILY=14; DRL_OFFSITE_KEEP_WEEKLY=8; DRL_OFFSITE_KEEP_MONTHLY=6
DRL_OFFSITE_CONTIMEOUT=15s; DRL_OFFSITE_IOTIMEOUT=120s; DRL_OFFSITE_BWLIMIT=""; DRL_OFFSITE_DECRYPT_KEY=""; DRL_OFFSITE_SSH_KNOWN_HOSTS=""

mode_of() { stat -c %a "$1" 2>/dev/null || echo "?"; }
private_file() {   # fichero regular, NO enlace, sin permisos para grupo/otros
  local f=$1 what=$2
  [ -n "$f" ] || cfg_fail "falta $what"
  case "$f" in /*) ;; *) cfg_fail "$what debe ser una ruta absoluta" ;; esac
  case "$f" in *..*) cfg_fail "$what no puede contener .." ;; esac
  [ -L "$f" ] && cfg_fail "$what es un enlace simbólico"
  [ -f "$f" ] || cfg_fail "$what no existe"
  case "$(mode_of "$f")" in 600|400) ;; *) cfg_fail "$what con permisos $(mode_of "$f") (se exige 600 o 400)" ;; esac
}

load_config() {
  if [ ! -f "$CONFIG" ]; then return 1; fi
  [ -L "$CONFIG" ] && cfg_fail "el fichero de configuración es un enlace simbólico"
  case "$(mode_of "$CONFIG")" in 600|400) ;; *) cfg_fail "configuración con permisos $(mode_of "$CONFIG") (se exige 600 o 400)" ;; esac
  local line k v n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n+1)); line=${line%$'\r'}
    case "$line" in ''|'#'*) continue ;; esac
    [[ "$line" =~ ^(DRL_OFFSITE_[A-Z_]+)=(.*)$ ]] || cfg_fail "línea $n no es KEY=VALUE"
    k=${BASH_REMATCH[1]}; v=${BASH_REMATCH[2]}
    [[ "$v" =~ ^\"(.*)\"$ ]] && v=${BASH_REMATCH[1]}
    [[ "$ALLOWED" == *" $k "* ]] || cfg_fail "clave desconocida en la línea $n"
    [[ "$v" =~ [\`\$\;\|\&\<\>] ]] && cfg_fail "valor con metacaracteres en la línea $n"
    printf -v "$k" '%s' "$v"
  done < "$CONFIG"
  return 0
}

validate_config() {
  [[ "$DRL_OFFSITE_ENABLED" =~ ^[01]$ ]] || cfg_fail "DRL_OFFSITE_ENABLED debe ser 0 o 1"
  [ "$DRL_OFFSITE_ENABLED" = 1 ] || return 0
  # remoto rclone: nombre:ruta, sin «..», sin espacios, sin empezar por guion (no es una opción inyectada)
  [[ "$DRL_OFFSITE_REMOTE" =~ ^[A-Za-z0-9_][A-Za-z0-9_-]*:[A-Za-z0-9._/-]*$ ]] || cfg_fail "DRL_OFFSITE_REMOTE no válido (nombre:ruta)"
  [[ "$DRL_OFFSITE_REMOTE" == *..* ]] && cfg_fail "DRL_OFFSITE_REMOTE no puede contener .."
  private_file "$DRL_OFFSITE_RCLONE_CONFIG" "DRL_OFFSITE_RCLONE_CONFIG"
  local name=${DRL_OFFSITE_REMOTE%%:*}
  grep -q "^\[$name\]" "$DRL_OFFSITE_RCLONE_CONFIG" || cfg_fail "el remoto «$name» no está definido en el rclone.conf"
  # Transporte cifrado obligatorio: sin FTP en claro, sin HTTP, sin endpoints http://
  local section; section=$(awk -v s="[$name]" '$0==s{f=1;next} /^\[/{f=0} f' "$DRL_OFFSITE_RCLONE_CONFIG")
  REMOTE_TYPE=$(printf '%s\n' "$section" | awk -F' *= *' '$1=="type"{print $2}' | head -1)
  [ -n "$REMOTE_TYPE" ] || cfg_fail "el remoto «$name» no declara type"
  case "$REMOTE_TYPE" in
    http) cfg_fail "type=http no admite subida segura" ;;
    ftp) printf '%s\n' "$section" | grep -Eq '^(tls|explicit_tls) *= *true' || cfg_fail "FTP sin TLS no está permitido" ;;
  esac
  printf '%s\n' "$section" | grep -Eiq '= *http://' && cfg_fail "endpoint en claro (http://) no permitido"
  if [ "$REMOTE_TYPE" = alias ]; then printf '%s\n' "$section" | grep -Eq '^remote *= */' && cfg_fail "un alias a una ruta local no es off-site"; fi
  if [ "$REMOTE_TYPE" = sftp ]; then   # sin known_hosts rclone aceptaría CUALQUIER clave de host (MITM)
    printf '%s\n' "$section" | grep -Eq '^known_hosts_file *= */config/known_hosts$' || cfg_fail "sftp exige known_hosts_file = /config/known_hosts"
    [ -n "$DRL_OFFSITE_SSH_KNOWN_HOSTS" ] || cfg_fail "sftp exige DRL_OFFSITE_SSH_KNOWN_HOSTS"
    [ -L "$DRL_OFFSITE_SSH_KNOWN_HOSTS" ] && cfg_fail "DRL_OFFSITE_SSH_KNOWN_HOSTS es un enlace simbólico"
    [ -s "$DRL_OFFSITE_SSH_KNOWN_HOSTS" ] || cfg_fail "DRL_OFFSITE_SSH_KNOWN_HOSTS vacío o inexistente"
  fi
  [ -n "$TEST_REMOTE_DIR$TEST_REMOTE_TMPFS" ] || [ "$REMOTE_TYPE" != "local" ] || cfg_fail "type=local no es off-site (usa un remoto real; las rutas montadas van como alias de un remoto montado explícitamente)"
  private_or_public_crt "$DRL_OFFSITE_RECIPIENT_CRT"
  [[ "$DRL_OFFSITE_RCLONE_IMAGE" =~ ^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$ ]] || cfg_fail "DRL_OFFSITE_RCLONE_IMAGE debe ir fijada por digest (@sha256:…)"
  [[ "$DRL_OFFSITE_RETENTION" =~ ^(provider|script)$ ]] || cfg_fail "DRL_OFFSITE_RETENTION debe ser provider o script"
  local x; for x in DRL_OFFSITE_KEEP_DAILY DRL_OFFSITE_KEEP_WEEKLY DRL_OFFSITE_KEEP_MONTHLY; do
    [[ "${!x}" =~ ^[0-9]{1,3}$ ]] && [ "${!x}" -le 365 ] || cfg_fail "$x debe ser un entero 0–365"
  done
  [ "$DRL_OFFSITE_KEEP_DAILY" -ge 1 ] || cfg_fail "DRL_OFFSITE_KEEP_DAILY debe ser ≥ 1"
  [[ "$DRL_OFFSITE_CONTIMEOUT" =~ ^[0-9]{1,4}[smh]$ ]] && [[ "$DRL_OFFSITE_IOTIMEOUT" =~ ^[0-9]{1,4}[smh]$ ]] || cfg_fail "timeouts: formato 15s / 2m"
  [ -z "$DRL_OFFSITE_BWLIMIT" ] || [[ "$DRL_OFFSITE_BWLIMIT" =~ ^[0-9]{1,6}[KMG]?$ ]] || cfg_fail "DRL_OFFSITE_BWLIMIT no válido"
  validate_recovery
}

# ── F70 · configuración de recuperación del stack (decisión B): rutas RELATIVAS a un directorio, sin enlaces ────────
validate_recovery() {
  [ -n "$DRL_OFFSITE_RECOVERY_DIR" ] || return 0
  local d=$DRL_OFFSITE_RECOVERY_DIR p bytes=0
  case "$d" in /*) ;; *) cfg_fail "DRL_OFFSITE_RECOVERY_DIR debe ser una ruta absoluta" ;; esac
  case "$d" in *..*) cfg_fail "DRL_OFFSITE_RECOVERY_DIR no puede contener .." ;; esac
  [ -L "$d" ] && cfg_fail "DRL_OFFSITE_RECOVERY_DIR es un enlace simbólico"
  [ -d "$d" ] || cfg_fail "DRL_OFFSITE_RECOVERY_DIR no existe"
  [ -n "$DRL_OFFSITE_RECOVERY_PATHS" ] || cfg_fail "DRL_OFFSITE_RECOVERY_PATHS vacío"
  for p in $DRL_OFFSITE_RECOVERY_PATHS; do
    [[ "$p" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*(/[A-Za-z0-9_][A-Za-z0-9._-]*)*$ ]] || cfg_fail "DRL_OFFSITE_RECOVERY_PATHS: ruta no válida"
    [[ "$p" == *..* ]] && cfg_fail "DRL_OFFSITE_RECOVERY_PATHS no puede contener .."
    [ -e "$d/$p" ] || cfg_fail "DRL_OFFSITE_RECOVERY_PATHS: no existe una de las rutas"
    if find "$d/$p" \( -type l -o ! \( -type f -o -type d \) \) | grep -q .; then cfg_fail "DRL_OFFSITE_RECOVERY_PATHS contiene enlaces o ficheros especiales"; fi
    bytes=$(( bytes + $(du -sb "$d/$p" | cut -f1) ))
  done
  [ "$bytes" -le "$RC_MAX_BYTES" ] || cfg_fail "configuración de recuperación demasiado grande (> 10 MB)"
}
private_or_public_crt() {   # el certificado es PÚBLICO: basta con que no sea un enlace y sea un X.509 vigente
  local f=$1
  [ -n "$f" ] || cfg_fail "falta DRL_OFFSITE_RECIPIENT_CRT"
  case "$f" in /*) ;; *) cfg_fail "DRL_OFFSITE_RECIPIENT_CRT debe ser absoluta" ;; esac
  [ -L "$f" ] && cfg_fail "DRL_OFFSITE_RECIPIENT_CRT es un enlace simbólico"
  [ -f "$f" ] || cfg_fail "DRL_OFFSITE_RECIPIENT_CRT no existe"
  openssl x509 -in "$f" -noout -checkend 0 >/dev/null 2>&1 || cfg_fail "DRL_OFFSITE_RECIPIENT_CRT no es un certificado X.509 vigente"
}

# ── rclone en contenedor efímero. Argumentos como array (sin interpolar en una shell), sin credenciales en la línea ──
rc() {
  local mounts=(-v "$DRL_OFFSITE_RCLONE_CONFIG:/config/rclone.conf:ro")
  [ -n "$WORK" ] && mounts+=(-v "$WORK:/work")
  [ -n "$DRL_OFFSITE_SSH_KNOWN_HOSTS" ] && mounts+=(-v "$DRL_OFFSITE_SSH_KNOWN_HOSTS:/config/known_hosts:ro")
  [ -n "$TEST_REMOTE_DIR" ] && mounts+=(-v "$TEST_REMOTE_DIR:/remote")
  [ -n "$TEST_REMOTE_TMPFS" ] && mounts+=(--tmpfs "/remote:size=$TEST_REMOTE_TMPFS,uid=$(id -u),gid=$(id -g),mode=0700")
  local net=(--network "${TEST_NETWORK:-bridge}")
  local extra=(--contimeout "$DRL_OFFSITE_CONTIMEOUT" --timeout "$DRL_OFFSITE_IOTIMEOUT" --retries 2 --low-level-retries 3)
  [ -n "$DRL_OFFSITE_BWLIMIT" ] && extra+=(--bwlimit "$DRL_OFFSITE_BWLIMIT")
  docker run --rm "${net[@]}" --user "$(id -u):$(id -g)" -e HOME=/tmp -e RCLONE_CONFIG=/config/rclone.conf \
    "${mounts[@]}" "$DRL_OFFSITE_RCLONE_IMAGE" "$@" "${extra[@]}" </dev/null
}
remote_path() { printf '%s/%s' "${DRL_OFFSITE_REMOTE%/}" "$1"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
json_get() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }

valid_ts() { [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; }

# ── Validación de la unidad local (la misma que exige restore-drill.sh, más raíz/enlaces/ficheros ajenos) ────────────
validate_unit() {
  local src=$1 root real
  [ -n "$src" ] || { echo "OFFSITE_REFUSED falta la unidad"; exit 2; }
  [ -L "$src" ] && { echo "OFFSITE_REFUSED la unidad es un enlace simbólico"; exit 2; }
  [ -d "$src" ] || { echo "OFFSITE_REFUSED la unidad no existe"; exit 2; }
  root=$(realpath -e "$BACKUP_ROOT"); real=$(realpath -e "$src")
  case "$real/" in "$root"/*/*/) ;; *) echo "OFFSITE_REFUSED la unidad está fuera de $BACKUP_ROOT"; exit 2 ;; esac
  valid_ts "$(basename "$real")" || { echo "OFFSITE_REFUSED nombre de unidad no válido"; exit 2; }
  [ -f "$real/COMPLETE" ] || { echo "OFFSITE_REFUSED la unidad no está COMPLETE"; exit 2; }
  [ -f "$real/SHA256SUMS" ] || { echo "OFFSITE_REFUSED falta SHA256SUMS"; exit 2; }
  if find "$real" -mindepth 1 ! -type f | grep -q .; then echo "OFFSITE_REFUSED la unidad contiene enlaces o directorios"; exit 2; fi
  local f listed
  listed=$(awk '{print $2}' "$real/SHA256SUMS" | sed 's/^\*//')
  for f in $(cd "$real" && ls -A); do
    case "$f" in SHA256SUMS|COMPLETE|SUPERSEDED|OFFSITE_IN_PROGRESS|OFFSITE_VERIFIED|OFFSITE_FAILED) continue ;; esac
    printf '%s\n' "$listed" | grep -qx "$f" || { echo "OFFSITE_REFUSED fichero ajeno a SHA256SUMS: $f"; exit 2; }
  done
  ( cd "$real" && sha256sum -c --quiet SHA256SUMS ) >/dev/null 2>&1 || { echo "OFFSITE_REFUSED SHA256SUMS no cuadra"; exit 2; }
  UNIT_DIR=$real
}

fault() { [ -n "$TEST_REMOTE_DIR$TEST_REMOTE_TMPFS" ] && [ "$TEST_FAULT" = "$1" ]; }

# ── Verificación remota: se DESCARGA y se compara. Sin marcador o con hash distinto → no válida ─────────────────────
verify_remote() {   # $1 TS · $2 hash esperado del .cms (vacío = el del marcador) · $3 exigir marcador (1/0)
  local ts=$1 expect=$2 need_marker=$3
  local d="$WORK/verify-$ts"   # en otra línea: en un mismo `local`, $ts aún no existe (set -u mataría el script en silencio)
  rm -rf "$d"; mkdir -p "$d"
  rc copy "$(remote_path "$ts")" "/work/verify-$ts" >/dev/null 2>&1 || { log "verify unit=$ts NO_REMOTE"; return 1; }
  [ -f "$d/unit.tar.cms" ] && [ -f "$d/unit.tar.cms.sha256" ] && [ -f "$d/offsite.json" ] || { log "verify unit=$ts INCOMPLETE"; return 1; }
  local got; got=$(sha "$d/unit.tar.cms")
  [ "$got" = "$(cut -d' ' -f1 < "$d/unit.tar.cms.sha256")" ] || { log "verify unit=$ts HASH_MISMATCH"; return 1; }
  [ "$got" = "$(json_get "$d/offsite.json" cmsSha256)" ] || { log "verify unit=$ts MANIFEST_MISMATCH"; return 1; }
  [ "$(stat -c %s "$d/unit.tar.cms")" = "$(json_get "$d/offsite.json" cmsBytes)" ] || { log "verify unit=$ts SIZE_MISMATCH"; return 1; }
  [ -z "$expect" ] || [ "$got" = "$expect" ] || { log "verify unit=$ts NOT_OURS"; return 1; }
  if [ "$need_marker" = 1 ]; then
    [ -f "$d/REMOTE_VERIFIED" ] || { log "verify unit=$ts NO_MARKER"; return 1; }
    [ "$(json_get "$d/REMOTE_VERIFIED" cmsSha256)" = "$got" ] || { log "verify unit=$ts MARKER_MISMATCH"; return 1; }
  fi
  VERIFIED_SHA=$got; VERIFIED_INNER=$(json_get "$d/offsite.json" innerSumsSha256); VERIFIED_BYTES=$(stat -c %s "$d/unit.tar.cms")
  return 0
}

take_lock() {
  [ "${DRL_BACKUP_LOCK_HELD:-0}" = 1 ] && return 0   # llamado desde backup-drlcards.sh, que ya tiene el candado
  exec 9>>"$LOCK_FILE" || cfg_fail "no se puede abrir el candado"
  flock -n 9 || { log "LOCKED otra copia en curso"; echo "OFFSITE_LOCKED"; exit 75; }
}

new_work() { mkdir -p "$BACKUP_ROOT/.offsite-work"; WORK=$(mktemp -d "$BACKUP_ROOT/.offsite-work/XXXXXX"); chmod 700 "$WORK"; }

# ── Poda remota (solo retention=script). Protege: la última verificada, 7 días, las parciales de < 48 h. ────────────
do_retention() {
  [ "$DRL_OFFSITE_RETENTION" = script ] || { echo "OFFSITE_RETENTION_PROVIDER (el VPS no borra en el destino)"; return 0; }
  local s day epoch now d w m seen_w seen_m latest wk dow deleted
  STAGE="retention"
  # Unidades remotas: SOLO nombres de unidad válidos. Una unidad sin REMOTE_VERIFIED es «parcial».
  rc lsf --dirs-only "${DRL_OFFSITE_REMOTE%/}" > "$WORK/dirs"
  local -a all; mapfile -t all < <(sed 's:/$::' "$WORK/dirs" | { grep -E '^[0-9]{8}T[0-9]{6}Z$' || true; } | sort -r)
  local -A verified=() keep=()
  for s in "${all[@]}"; do rc lsf "$(remote_path "$s")" 2>/dev/null | grep -qx REMOTE_VERIFIED && verified[$s]=1 || true; done
  now=$(date -u +%s); d=0; w=0; m=0; seen_w=" "; seen_m=" "; latest=""
  for s in "${all[@]}"; do
    day=${s:0:8}; epoch=$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2} ${s:9:2}:${s:11:2}:${s:13:2}" +%s)
    if [ -z "${verified[$s]:-}" ]; then
      # parcial / en curso: se conserva 48 h (puede ser la subida de ahora mismo o un reintento pendiente)
      [ $(( now - epoch )) -lt 172800 ] && keep[$s]=partial-recent
      continue
    fi
    [ -z "$latest" ] && { latest=$s; keep[$s]=latest; }
    [ $(( now - epoch )) -lt $(( 7 * 86400 )) ] && keep[$s]=${keep[$s]:-window-7d}
    if [ $d -lt "$DRL_OFFSITE_KEEP_DAILY" ]; then keep[$s]=${keep[$s]:-daily}; d=$((d+1)); fi
    wk=$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2}" +%G%V); dow=$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2}" +%u)
    if [ "$dow" = 7 ] && [ $w -lt "$DRL_OFFSITE_KEEP_WEEKLY" ] && [[ "$seen_w" != *" $wk "* ]]; then keep[$s]=${keep[$s]:-weekly}; w=$((w+1)); seen_w="$seen_w$wk "; fi
    if [ "${day:6:2}" = 01 ] && [ $m -lt "$DRL_OFFSITE_KEEP_MONTHLY" ] && [[ "$seen_m" != *" ${day:0:6} "* ]]; then keep[$s]=${keep[$s]:-monthly}; m=$((m+1)); seen_m="$seen_m${day:0:6} "; fi
  done
  [ -n "$latest" ] || { log "RETENTION_SKIP sin ninguna unidad verificada: no se borra nada"; echo "OFFSITE_RETENTION_SKIP"; return 0; }
  deleted=0
  for s in "${all[@]}"; do
    if [ -n "${keep[$s]:-}" ]; then echo "KEEP $s ${keep[$s]}"; else rc purge "$(remote_path "$s")" >/dev/null; echo "DELETE $s"; deleted=$((deleted+1)); fi
  done
  log "RETENTION_OK kept=$(( ${#all[@]} - deleted )) deleted=$deleted"
  echo "OFFSITE_RETENTION_OK deleted=$deleted"
}

# ───────────────────────────────────────────────── modos ──────────────────────────────────────────────────────────
case "$MODE" in
  check-config)
    load_config || { echo "OFFSITE_NOT_CONFIGURED"; exit 0; }
    validate_config
    [ "$DRL_OFFSITE_ENABLED" = 1 ] && echo "OFFSITE_CONFIG_OK type=$REMOTE_TYPE remote=${DRL_OFFSITE_REMOTE%%:*}: retention=$DRL_OFFSITE_RETENTION recoveryConfig=$([ -n "$DRL_OFFSITE_RECOVERY_DIR" ] && echo on || echo off)" || echo "OFFSITE_DISABLED"
    ;;

  status)
    line=$(cat "$BACKUP_ROOT/offsite-status" 2>/dev/null || true)
    last=$(for u in "$BACKUP_ROOT"/*/2*Z; do if [ -f "$u/OFFSITE_VERIFIED" ]; then echo "$(basename "$u") $u"; fi; done 2>/dev/null | sort -r | head -1 | cut -d' ' -f2)
    echo "OFFSITE_LAST_VERIFIED ${last:+$(basename "$last") $(( ( $(date +%s) - $(stat -c %Y "$last/OFFSITE_VERIFIED") ) / 3600 ))}"
    echo "OFFSITE_LAST_RUN ${line}"
    ;;

  push)
    load_config || { log "DISABLED sin configuración"; echo "OFFSITE_NOT_CONFIGURED"; exit 0; }
    validate_config
    [ "$DRL_OFFSITE_ENABLED" = 1 ] || { log "DISABLED"; echo "OFFSITE_DISABLED"; exit 0; }
    validate_unit "${2:-}"
    TS=$(basename "$UNIT_DIR")
    take_lock
    new_work
    STAGE="in-progress"; date -u +%FT%TZ > "$UNIT_DIR/OFFSITE_IN_PROGRESS"
    log "START unit=$TS type=$REMOTE_TYPE remote=${DRL_OFFSITE_REMOTE%%:*}:"
    INNER=$(sha "$UNIT_DIR/SHA256SUMS")

    # Idempotencia: si ya hay una copia remota VERIFICADA de ESTA unidad (mismo SHA256SUMS), se re-verifica y se sale.
    STAGE="probe-remote"
    if verify_remote "$TS" "" 1 2>/dev/null && [ "$VERIFIED_INNER" = "$INNER" ]; then
      STAGE="already-verified"
      printf '{"unit":"%s","cmsSha256":"%s","innerSumsSha256":"%s","verifiedAt":"%s","remoteType":"%s","reverified":true}\n' "$TS" "$VERIFIED_SHA" "$INNER" "$(date -u +%FT%TZ)" "$REMOTE_TYPE" > "$UNIT_DIR/OFFSITE_VERIFIED"
      rm -f "$UNIT_DIR/OFFSITE_IN_PROGRESS" "$UNIT_DIR/OFFSITE_FAILED"
      echo "verified $TS $(date -u +%FT%TZ) already" > "$BACKUP_ROOT/offsite-status"
      log "OK unit=$TS already-verified bytes=$VERIFIED_BYTES seconds=$(( $(date +%s) - T0 ))"
      echo "OFFSITE_OK $TS already-verified"; exit 0
    fi

    # Empaquetado: SOLO los ficheros listados en SHA256SUMS + SHA256SUMS + COMPLETE (nada de marcadores ni ajenos).
    STAGE="package"
    mkdir -p "$WORK/out"
    mapfile -t files < <(awk '{print $2}' "$UNIT_DIR/SHA256SUMS" | sed 's/^\*//')
    tar -C "$UNIT_DIR" --no-recursion -cf "$WORK/unit.tar" -- "${files[@]}" SHA256SUMS COMPLETE
    RC_PRESENT=false
    if [ -n "$DRL_OFFSITE_RECOVERY_DIR" ]; then
      # Dentro del MISMO tar que se cifra: nunca toca el disco fuera de $WORK (700) ni sale en claro.
      STAGE="package-recovery"
      read -r -a rc_paths <<< "$DRL_OFFSITE_RECOVERY_PATHS"
      tar -C "$DRL_OFFSITE_RECOVERY_DIR" --numeric-owner -cf "$WORK/recovery-config.tar" -- "${rc_paths[@]}"
      ( cd "$WORK" && sha256sum recovery-config.tar > recovery-config.sha256 )
      tar -C "$WORK" --no-recursion -rf "$WORK/unit.tar" -- recovery-config.tar recovery-config.sha256
      rm -f "$WORK/recovery-config.tar" "$WORK/recovery-config.sha256"
      RC_PRESENT=true
    fi
    STAGE="encrypt"
    openssl cms -encrypt -binary -stream -aes-256-gcm -outform DER -in "$WORK/unit.tar" -out "$WORK/out/unit.tar.cms" "$DRL_OFFSITE_RECIPIENT_CRT"
    rm -f "$WORK/unit.tar"
    CMS_SHA=$(sha "$WORK/out/unit.tar.cms"); CMS_BYTES=$(stat -c %s "$WORK/out/unit.tar.cms")
    echo "$CMS_SHA  unit.tar.cms" > "$WORK/out/unit.tar.cms.sha256"
    HEAD=$(json_get "$UNIT_DIR/manifest.json" expectedMigrationHead 2>/dev/null || echo "?")
    FPR=$(openssl x509 -in "$DRL_OFFSITE_RECIPIENT_CRT" -noout -fingerprint -sha256 | cut -d= -f2)
    printf '{"kind":"drlcards-offsite","version":1,"unit":"%s","expectedMigrationHead":"%s","cmsBytes":%s,"cmsSha256":"%s","innerSumsSha256":"%s","encryption":"CMS AES-256-GCM","recipientSha256":"%s","recoveryConfigPresent":%s,"createdAt":"%s"}\n' \
      "$TS" "$HEAD" "$CMS_BYTES" "$CMS_SHA" "$INNER" "$FPR" "$RC_PRESENT" "$(date -u +%FT%TZ)" > "$WORK/out/offsite.json"

    # Una copia remota a medias (sin marcador) de esta unidad no vale nada: se borra antes de volver a subir.
    STAGE="clear-partial"
    rc purge "$(remote_path "$TS")" >/dev/null 2>&1 || true
    STAGE="upload"
    rc copy /work/out "$(remote_path "$TS")"
    fault partial-upload && truncate -s $(( CMS_BYTES / 2 )) "$TEST_REMOTE_DIR/$TS/unit.tar.cms"
    STAGE="verify"
    verify_remote "$TS" "$CMS_SHA" 0
    fault abort-before-marker && { log "TEST abort-before-marker"; false; }
    STAGE="marker"
    printf '{"unit":"%s","cmsSha256":"%s","innerSumsSha256":"%s","verifiedAt":"%s"}\n' "$TS" "$CMS_SHA" "$INNER" "$(date -u +%FT%TZ)" > "$WORK/REMOTE_VERIFIED"
    rc copyto /work/REMOTE_VERIFIED "$(remote_path "$TS")/REMOTE_VERIFIED"
    STAGE="verify-marker"
    verify_remote "$TS" "$CMS_SHA" 1
    STAGE="record"
    printf '{"unit":"%s","cmsSha256":"%s","innerSumsSha256":"%s","verifiedAt":"%s","remoteType":"%s","bytes":%s}\n' "$TS" "$CMS_SHA" "$INNER" "$(date -u +%FT%TZ)" "$REMOTE_TYPE" "$CMS_BYTES" > "$UNIT_DIR/OFFSITE_VERIFIED"
    rm -f "$UNIT_DIR/OFFSITE_IN_PROGRESS" "$UNIT_DIR/OFFSITE_FAILED"
    echo "verified $TS $(date -u +%FT%TZ)" > "$BACKUP_ROOT/offsite-status"
    log "OK unit=$TS bytes=$CMS_BYTES seconds=$(( $(date +%s) - T0 ))"
    echo "OFFSITE_OK $TS bytes=$CMS_BYTES"
    if [ "$DRL_OFFSITE_RETENTION" = script ]; then do_retention || log "WARN retention falló (la copia de hoy es válida)"; fi
    ;;

  verify)
    load_config || { echo "OFFSITE_NOT_CONFIGURED"; exit 2; }
    validate_config; [ "$DRL_OFFSITE_ENABLED" = 1 ] || { echo "OFFSITE_DISABLED"; exit 2; }
    valid_ts "${2:-}" || { echo "OFFSITE_REFUSED id de unidad no válido"; exit 2; }
    new_work; STAGE="verify"
    if verify_remote "$2" "" 1; then log "VERIFY_OK unit=$2 bytes=$VERIFIED_BYTES"; echo "OFFSITE_VERIFY_OK $2"; else log "VERIFY_FAIL unit=$2"; echo "OFFSITE_VERIFY_FAIL $2"; exit 1; fi
    ;;

  fetch)
    load_config || { echo "OFFSITE_NOT_CONFIGURED"; exit 2; }
    validate_config; [ "$DRL_OFFSITE_ENABLED" = 1 ] || { echo "OFFSITE_DISABLED"; exit 2; }
    valid_ts "${2:-}" || { echo "OFFSITE_REFUSED id de unidad no válido"; exit 2; }
    DEST=${3:-}; case "$DEST" in /*) ;; *) echo "OFFSITE_REFUSED destino absoluto requerido"; exit 2 ;; esac
    [ -e "$DEST" ] && { echo "OFFSITE_REFUSED el destino ya existe"; exit 2; }
    new_work; STAGE="fetch-verify"
    verify_remote "$2" "" 1 || { echo "OFFSITE_FETCH_FAIL $2 (sin copia verificada)"; exit 1; }
    mkdir -p "$DEST"; chmod 700 "$DEST"
    cp "$WORK/verify-$2/unit.tar.cms" "$WORK/verify-$2/unit.tar.cms.sha256" "$WORK/verify-$2/offsite.json" "$WORK/verify-$2/REMOTE_VERIFIED" "$DEST/"
    if [ -n "$DRL_OFFSITE_DECRYPT_KEY" ]; then
      STAGE="decrypt"
      private_file "$DRL_OFFSITE_DECRYPT_KEY" "DRL_OFFSITE_DECRYPT_KEY"
      mkdir -p "$DEST/unit"
      openssl cms -decrypt -binary -inform DER -in "$DEST/unit.tar.cms" -inkey "$DRL_OFFSITE_DECRYPT_KEY" -recip "$DRL_OFFSITE_RECIPIENT_CRT" -out "$WORK/unit.tar"
      tar -C "$DEST/unit" --no-same-owner --no-overwrite-dir -xf "$WORK/unit.tar"
      if find "$DEST/unit" -mindepth 1 ! -type f | grep -q .; then echo "OFFSITE_FETCH_FAIL la unidad descifrada contiene enlaces o directorios"; exit 1; fi
      [ "$(sha "$DEST/unit/SHA256SUMS")" = "$VERIFIED_INNER" ] || { echo "OFFSITE_FETCH_FAIL SHA256SUMS distinto del registrado"; exit 1; }
      ( cd "$DEST/unit" && sha256sum -c --quiet SHA256SUMS ) || { echo "OFFSITE_FETCH_FAIL SHA256SUMS de la unidad no cuadra"; exit 1; }
      [ -f "$DEST/unit/COMPLETE" ] || { echo "OFFSITE_FETCH_FAIL unidad sin COMPLETE"; exit 1; }
      RC_NOTE="recovery-config=absent"
      if [ -f "$DEST/unit/recovery-config.tar" ]; then
        # F70 · decisión B: se comprueba, se restaura aparte (700/600) y se saca de la unidad (restore-drill la ve igual).
        STAGE="recovery-config"
        ( cd "$DEST/unit" && sha256sum -c --quiet recovery-config.sha256 ) || { echo "OFFSITE_FETCH_FAIL recovery-config no cuadra"; exit 1; }
        if tar -tvf "$DEST/unit/recovery-config.tar" | grep -q '^[^d-]'; then echo "OFFSITE_FETCH_FAIL recovery-config con enlaces o ficheros especiales"; exit 1; fi
        if tar -tf "$DEST/unit/recovery-config.tar" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then echo "OFFSITE_FETCH_FAIL recovery-config con rutas no seguras"; exit 1; fi
        mkdir -m 700 "$DEST/recovery-config"
        tar -C "$DEST/recovery-config" --no-same-owner --no-same-permissions -xf "$DEST/unit/recovery-config.tar"
        find "$DEST/recovery-config" -type d -exec chmod 700 {} + ; find "$DEST/recovery-config" -type f -exec chmod 600 {} +
        rm -f "$DEST/unit/recovery-config.tar" "$DEST/unit/recovery-config.sha256"
        RC_NOTE="recovery-config=$DEST/recovery-config"
      fi
      log "FETCH_OK unit=$2 decrypted ${RC_NOTE%%=*}=$([ "$RC_NOTE" = recovery-config=absent ] && echo absent || echo present)"
      echo "OFFSITE_FETCH_OK $2 $DEST/unit (lista para restore-drill.sh / restauración) $RC_NOTE"
    else
      log "FETCH_OK unit=$2 encrypted"
      echo "OFFSITE_FETCH_OK $2 $DEST (cifrada: descifrar en la máquina con la clave privada)"
    fi
    ;;

  retention)
    load_config || { echo "OFFSITE_NOT_CONFIGURED"; exit 0; }
    validate_config; [ "$DRL_OFFSITE_ENABLED" = 1 ] || { echo "OFFSITE_DISABLED"; exit 0; }
    new_work
    do_retention
    ;;

  *)
    echo "uso: backup-offsite.sh push <unidad> | verify <TS> | fetch <TS> <dir> | retention | check-config | status"; exit 2 ;;
esac
