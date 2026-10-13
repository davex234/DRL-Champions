#!/usr/bin/env bash
# Valorosters (F75) · compila y activa una release en el VPS.
#
#   1. En el PC: tar del working tree (git ls-files -co --exclude-standard, sin .env*, docs, capturas)
#      → scp a /opt/nexus/projects/valorosters/incoming/<release>.tar
#   2. En el VPS: bin/deploy.sh <release>      (release = el BUILD_ID esperado, p. ej. drl-0.1.1-1-08943cb7)
#
# Compila en un contenedor desechable (8 GB / 6 CPU, uid 1000) con secrets/app.env, comprueba que el
# BUILD_ID coincide con el nombre de la release (huella del contenido = mismo código que en el PC),
# mueve `current` y recrea SOLO valorosters-app. Rollback: bin/deploy.sh --activate <release-anterior>.
set -euo pipefail
V=/opt/nexus/projects/valorosters
IMG=node:24.15.0-bookworm-slim
cd "$V"

activate() {
  local rel="$1"
  [ -f "releases/$rel/.next/BUILD_ID" ] || { echo "release $rel sin build"; exit 1; }
  echo "anterior: $(readlink current 2>/dev/null || echo ninguna)"
  ln -sfn "releases/$rel" current
  docker compose up -d --force-recreate --no-deps valorosters-app
  for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3005/api/health)" = 200 ] && { echo "ACTIVA $rel"; curl -s http://127.0.0.1:3005/api/ready; echo; return 0; }
    sleep 2
  done
  echo "la app no responde tras activar $rel: revisa docker logs valorosters-app y haz rollback"; exit 1
}

if [ "${1:-}" = "--activate" ]; then activate "${2:?release}"; exit 0; fi

REL="${1:?uso: deploy.sh <release> | --activate <release>}"
TAR="incoming/$REL.tar"
[ -f "$TAR" ] || { echo "falta $TAR"; exit 1; }
[ -e "releases/$REL" ] && { echo "releases/$REL ya existe (usa --activate)"; exit 1; }
mkdir -p "releases/$REL" logs
tar -xf "$TAR" -C "releases/$REL"
docker run --rm --name valorosters-build --user 1000:1000 --memory 8g --cpus 6 \
  --network supabase-drlcards_interna --env-file secrets/app.env \
  -e HOME=/tmp -e NEXT_TELEMETRY_DISABLED=1 -e NODE_OPTIONS=--max-old-space-size=6144 \
  -v "$V/releases/$REL:/app" -w /app "$IMG" \
  bash -c 'npm ci --no-audit --no-fund && npx next build' > "logs/build-$REL.log" 2>&1 < /dev/null \
  || { echo "BUILD FALLIDA: logs/build-$REL.log"; exit 1; }
GOT=$(cat "releases/$REL/.next/BUILD_ID")
[ "$GOT" = "$REL" ] || { echo "BUILD_ID $GOT ≠ $REL: el código no es el esperado. No se activa."; exit 1; }
activate "$REL"
