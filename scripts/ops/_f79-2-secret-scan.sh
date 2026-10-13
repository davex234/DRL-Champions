#!/usr/bin/env bash
# F79.2 · ESCANEO DE SECRETOS DE LO SERVIDO EN PRODUCCIÓN (se ejecuta EN EL VPS; NUNCA imprime un valor).
#   ssh nexusadmin@VPS 'bash -s' < scripts/ops/_f79-2-secret-scan.sh
# 1) por VALOR: cada secreto de servidor de secrets/app.env se busca (grep -F -c) en .next/static, public/, el HTML y los
#    JS servidos por la app y en sus logs; solo se imprimen recuentos.
# 2) por PATRÓN: todos los JWT del HTML/JS servido se decodifican y se cuenta su `role`; sb_secret_, claves tipo Resend,
#    nombres de variables secretas y source maps servidos.
set -uo pipefail
V=/opt/nexus/projects/valorosters
R="$V/current"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cd "$T"
# Lo SERVIDO: HTML de varias rutas + todos los chunks JS/CSS que referencian.
for p in / /misiones/crafting /misiones/crafting/cartas /inventario /admin/crafting /coleccion /cuenta; do curl -s "http://127.0.0.1:3005$p" >> served.html; done
grep -oE '/_next/static/[^"'"'"' )]+\.(js|css)' served.html | sort -u > assets.txt
while read -r a; do curl -s "http://127.0.0.1:3005$a" >> served.js; printf '\n' >> served.js; done < assets.txt
echo "SERVED_ASSETS $(wc -l < assets.txt)"
MAPS=0; while read -r a; do c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3005$a.map"); [ "$c" = 200 ] && MAPS=$((MAPS+1)); done < <(grep '\.js$' assets.txt)
echo "SOURCE_MAPS_SERVED $MAPS"
docker logs --since 2h valorosters-app > logs.txt 2>&1 || true
# 1 · por VALOR (sin imprimir): claves de secrets/app.env que NO son públicas.
SECRET_KEYS=$(grep -E '^[A-Z0-9_]+=' "$V/secrets/app.env" | cut -d= -f1 | grep -vE '^NEXT_PUBLIC_|^NODE_ENV$|^PORT$|^HOSTNAME$|URL$|_ENABLED$|^DRL_PUBLIC_RELEASE$' )
NK=0; HITS=0
for k in $SECRET_KEYS; do
  val=$(grep -E "^$k=" "$V/secrets/app.env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
  [ ${#val} -lt 12 ] && continue
  NK=$((NK+1))
  n=$( { grep -rFc -- "$val" "$R/.next/static" "$R/public" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}'; grep -Fc -- "$val" served.html served.js logs.txt 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}'; } | awk '{s+=$1} END {print s+0}')
  [ "$n" -gt 0 ] && { HITS=$((HITS+n)); echo "VALUE_HIT $k $n"; }
  unset val
done
echo "SERVER_SECRETS_CHECKED $NK"
echo "SERVER_SECRET_VALUE_HITS $HITS"
# 2 · por PATRÓN.
python3 - <<'PY'
import re, base64, json, collections
roles = collections.Counter()
for f in ("served.html", "served.js", "logs.txt"):
    s = open(f, encoding="utf8", errors="ignore").read()
    for t in set(re.findall(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", s)):
        try:
            p = t.split(".")[1]; p += "=" * (-len(p) % 4)
            roles[(f, json.loads(base64.urlsafe_b64decode(p)).get("role", "?"))] += 1
        except Exception:
            roles[(f, "undecodable")] += 1
    print("PATTERN", f, "sb_secret", len(re.findall(r"sb_secret_[A-Za-z0-9_-]{8,}", s)),
          "resend_key", len(re.findall(r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}", s)),
          "env_names", len(re.findall(r"SUPABASE_SERVICE_ROLE_KEY|GOTRUE_SMTP_PASS|JWT_SECRET|SYNC_SECRET", s)),
          "private_key", len(re.findall(r"-----BEGIN [A-Z ]*PRIVATE KEY-----", s)))
print("JWT_ROLES", dict((f"{a}:{b}", n) for (a, b), n in roles.items()) or "none")
PY
echo SCAN_DONE
