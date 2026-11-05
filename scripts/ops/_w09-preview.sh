#!/usr/bin/env bash
# =============================================================================
# WALKOUT 0.9 · PREVISUALIZACIÓN AISLADA (no toca `current`, ni valorosters-app, ni la BD, ni otros proyectos).
# =============================================================================
#   ssh nexusadmin@VPS 'bash /tmp/w09/_w09-preview.sh up'    1) contenedor de QA con la build 0.9 de la compuerta
#                                                             (127.0.0.1:3016, sin BD ni secretos: `_w09-gate.sh up`)
#                                                             2) proxy de previsualización en 127.0.0.1:3017 (solo
#                                                             lectura; añade el panel de controles)
#   ssh nexusadmin@VPS 'bash /tmp/w09/_w09-preview.sh down'  para y borra los dos contenedores
# Acceso: SOLO por túnel SSH (ssh -N -L 3017:127.0.0.1:3017 nexusadmin@VPS) → http://localhost:3017/
# =============================================================================
set -euo pipefail
IMG=node:24.15.0-bookworm-slim
G=/tmp/w09/gate
P=/tmp/w09/preview
case "${1:?up|down|status}" in
  up)
    [ "$(cat $G/.next/BUILD_ID)" = "drl-0.1.1-1-e5db60b6" ] || { echo "la compuerta no es la build 0.9"; exit 1; }
    bash /tmp/w09/_w09-gate.sh up
    docker rm -f valorosters-w09-preview >/dev/null 2>&1 || true
    docker run -d --name valorosters-w09-preview --user 1000:1000 --memory 256m --cpus 1 --init --network host \
      -v "$P:/preview:ro" -v "$G:/gate:ro" -e GATE_DIR=/gate -w /preview "$IMG" node /preview/proxy.mjs >/dev/null
    for i in $(seq 1 15); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3017/__preview/info)" = 200 ] && { echo "PREVIEW_UP 127.0.0.1:3017"; curl -s http://127.0.0.1:3017/__preview/info; echo; exit 0; }
      sleep 1
    done
    echo "el proxy no arranca"; docker logs --tail 20 valorosters-w09-preview; exit 1
    ;;
  down)
    docker rm -f valorosters-w09-preview >/dev/null 2>&1 && echo "PREVIEW_DOWN" || echo "proxy ya parado"
    bash /tmp/w09/_w09-gate.sh down
    ;;
  status)
    docker ps --format '{{.Names}} {{.Status}}' | grep -E 'valorosters-w09-(qa|preview)' || echo "parada"
    ;;
esac
