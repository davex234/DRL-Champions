#!/usr/bin/env bash
# F67 · estado de backups de DRLCards en el VPS (SOLO LECTURA). Salida: líneas «CLAVE valor».
#   ssh -i ~/.ssh/id_ed25519 nexusadmin@212.95.40.144 'bash -s' < scripts/ops/backup-status.sh
# PRE-F70 · reconoce TODAS las unidades verificadas de backup-drlcards.sh (f67/, pre-0058/, verified/…; antes solo f67/)
# y el estado OFF-SITE (sin imprimir la configuración: solo si existe y si está activada).
set -uo pipefail
d=${DRL_BACKUP_ROOT:-/opt/nexus/backups/supabase-drlcards}
cfg=${DRL_OFFSITE_CONFIG:-/opt/nexus/projects/supabase-drlcards/backup/offsite.env}
now=$(date +%s)
age() { [ -n "$1" ] && echo $(( (now - $(stat -c %Y "$1")) / 3600 )) || echo 9999; }
echo "DAILY $(age "$(ls -t $d/daily/*.dump 2>/dev/null | head -1)")"
echo "STORAGE $(age "$(ls -t $d-storage/daily/*.tgz 2>/dev/null | head -1)")"
echo "DAILY_COUNT $(ls $d/daily/*.dump 2>/dev/null | wc -l)"
# Unidades verificadas: <dir>/<TS>/COMPLETE, sin SUPERSEDED, ordenadas por TS (no por directorio).
units=$(for x in $d/*/2*Z; do if [ -d "$x" ] && [ ! -L "$x" ] && [ -f "$x/COMPLETE" ] && [ ! -f "$x/SUPERSEDED" ]; then echo "$(basename "$x") $x"; fi; done 2>/dev/null | sort -r)
f=$(echo "$units" | head -1 | cut -d' ' -f2)
echo "VERIFIED $f"
echo "VERIFIED_AGE_H $(age "${f:+$f/COMPLETE}")"
echo "VERIFIED_COUNT $(echo "$units" | grep -c . || true)"
[ -n "$f" ] && (cd "$f" && sha256sum -c --quiet SHA256SUMS && echo "SUMS_OK 1")
echo "LOGFAILS $(grep -c FALLO /opt/nexus/logs/nexus-backup.log 2>/dev/null || echo 0)"
echo "LAST $(tail -1 /opt/nexus/logs/nexus-backup.log 2>/dev/null)"
echo "FREE_MB $(df -Pm /opt/nexus/backups | awk 'NR==2{print $4}')"
echo "BACKUPS_MB $(du -sm $d $d-storage 2>/dev/null | awk '{s+=$1} END {print s}')"
# Off-site: NOT_CONFIGURED | DISABLED | ENABLED. Nunca se imprime el destino ni credenciales.
if [ ! -f "$cfg" ]; then echo "OFFSITE_CONFIG NOT_CONFIGURED"
elif grep -qx 'DRL_OFFSITE_ENABLED=1' "$cfg" 2>/dev/null; then echo "OFFSITE_CONFIG ENABLED"
else echo "OFFSITE_CONFIG DISABLED"; fi
lastoff=$(echo "$units" | while read -r ts p; do [ -n "$p" ] && [ -f "$p/OFFSITE_VERIFIED" ] && { echo "$ts $p"; break; }; done)
echo "OFFSITE_VERIFIED ${lastoff:+$(echo "$lastoff" | cut -d' ' -f1) $(age "$(echo "$lastoff" | cut -d' ' -f2)/OFFSITE_VERIFIED")}"
echo "OFFSITE_LAST_RUN $(cat $d/offsite-status 2>/dev/null | head -1)"
