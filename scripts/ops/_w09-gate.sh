#!/usr/bin/env bash
# =============================================================================
# WALKOUT 0.9 · COMPUERTA PREVIA AL DESPLIEGUE (no activa nada, no toca `current` ni valorosters-app).
# =============================================================================
#   ssh nexusadmin@VPS 'bash /tmp/w09/_w09-gate.sh build <BUILD_ID>'   compila incoming/<id>.tar en /tmp/w09/gate
#                                                                      con los MISMOS parámetros que bin/deploy.sh
#   ssh nexusadmin@VPS 'bash /tmp/w09/_w09-gate.sh up'                 sirve esa build en 127.0.0.1:3016 SIN la red de
#                                                                      Supabase (ni una escritura posible) y con los
#                                                                      arneses QA visibles (NEXUS_QA_HARNESS=1)
#   ssh nexusadmin@VPS 'bash /tmp/w09/_w09-gate.sh down'               para y borra el contenedor de QA
# =============================================================================
set -euo pipefail
V=/opt/nexus/projects/valorosters
IMG=node:24.15.0-bookworm-slim
G=/tmp/w09/gate
case "${1:?build|up|down}" in
  build)
    ID="${2:?BUILD_ID}"
    rm -rf "$G"; mkdir -p "$G"
    tar -xf "$V/incoming/$ID.tar" -C "$G"
    docker run --rm --name valorosters-w09-gate --user 1000:1000 --memory 8g --cpus 6 \
      --network supabase-drlcards_interna --env-file "$V/secrets/app.env" \
      -e HOME=/tmp -e NEXT_TELEMETRY_DISABLED=1 -e NODE_OPTIONS=--max-old-space-size=6144 \
      -v "$G:/app" -w /app "$IMG" \
      bash -c 'npm ci --no-audit --no-fund && npx next build' > /tmp/w09/gate-build.log 2>&1 < /dev/null \
      || { echo "GATE BUILD FALLIDA"; tail -40 /tmp/w09/gate-build.log; exit 1; }
    GOT=$(cat "$G/.next/BUILD_ID")
    [ "$GOT" = "$ID" ] && echo "GATE_BUILD_OK $GOT" || { echo "BUILD_ID $GOT ≠ $ID"; exit 1; }
    ;;
  up)
    docker rm -f valorosters-w09-qa >/dev/null 2>&1 || true
    # SIN secrets/app.env: solo las variables PÚBLICAS (ya van en el bundle del navegador) + una clave de servicio
    # INVÁLIDA (el arranque la exige; Kong la rechaza) + Supabase interno inalcanzable + sincronización esports apagada.
    # Así este servidor no puede escribir en la BD real por ningún camino, ni lanzar el worker esports.
    umask 077; grep -E '^NEXT_PUBLIC_(SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SAME_ORIGIN|SITE_URL)=' "$V/secrets/app.env" > /tmp/w09/qa.env
    printf '%s\n' "SUPABASE_SERVICE_ROLE_KEY=w09-qa-invalid" "SUPABASE_INTERNAL_URL=http://127.0.0.1:9" "ESPORTS_AUTO_SYNC_ENABLED=false" >> /tmp/w09/qa.env
    docker run -d --name valorosters-w09-qa --user 1000:1000 --memory 2g --cpus 2 --init \
      --env-file /tmp/w09/qa.env -e NODE_ENV=production -e NEXT_TELEMETRY_DISABLED=1 -e HOME=/tmp \
      -e NEXUS_QA_HARNESS=1 -e NODE_OPTIONS=--max-old-space-size=1536 \
      -p 127.0.0.1:3016:3016 -v "$G:/app" -w /app "$IMG" \
      node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3016 >/dev/null
    for i in $(seq 1 30); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3016/api/health)" = 200 ] && { echo "QA_UP 127.0.0.1:3016"; exit 0; }
      sleep 2
    done
    echo "QA no arranca"; docker logs --tail 30 valorosters-w09-qa; exit 1
    ;;
  down)
    docker rm -f valorosters-w09-qa >/dev/null 2>&1 && echo "QA_DOWN" || echo "QA ya parado"
    rm -f /tmp/w09/qa.env
    ;;
esac
