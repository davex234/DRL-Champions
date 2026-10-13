#!/usr/bin/env bash
# Valorosters (F75) · estado de producción en el VPS. Solo lectura.
#   ssh nexusadmin@212.95.40.144 /opt/nexus/projects/valorosters/bin/status.sh [--logs]
set -u
V=/opt/nexus/projects/valorosters
cd "$V" || exit 1

echo "== contenedores"
for c in valorosters-app valorosters-tunnel; do
  docker inspect -f '{{.Name}}  {{.State.Status}}  health={{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}  restarts={{.RestartCount}}  desde={{.State.StartedAt}}' "$c" 2>/dev/null || echo "/$c  NO EXISTE"
done

echo "== release"
echo "current -> $(readlink current)   BUILD_ID=$(cat current/.next/BUILD_ID 2>/dev/null)"

echo "== app (loopback)"
echo "health: $(curl -s -m 5 http://127.0.0.1:3005/api/health)"
curl -s -m 10 http://127.0.0.1:3005/api/ready | grep -oE '"status":"[a-z]+"|"migrationHead":"[^"]+"' | tr '\n' ' '; echo

echo "== túnel drlcards"
docker exec valorosters-app node -e "fetch('http://valorosters-tunnel:2000/ready').then(r=>r.text()).then(t=>console.log('conector:',t)).catch(e=>console.log('conector: sin respuesta',e.message))" 2>/dev/null

echo "== público"
echo "https://valorosters.com/api/health -> $(curl -s -m 10 -o /dev/null -w '%{http_code}' https://valorosters.com/api/health)"

echo "== recursos"
docker stats --no-stream --format '{{.Name}}  cpu={{.CPUPerc}}  mem={{.MemUsage}}' valorosters-app valorosters-tunnel
free -h | awk 'NR<=2'
df -h / | awk 'NR==2 {print "disco /: usado " $3 " de " $2 " (" $5 "), libre " $4}'
du -sh releases 2>/dev/null | awk '{print "releases: " $1}'

if [ "${1:-}" = "--logs" ]; then
  echo "== últimos logs app";    docker logs --tail 30 valorosters-app 2>&1
  echo "== últimos logs túnel";  docker logs --tail 15 valorosters-tunnel 2>&1
fi
