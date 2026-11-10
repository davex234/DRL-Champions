#!/usr/bin/env bash
# Comprobación de invitado ampliada contra producción (SOLO LECTURA, sin sesión). Uso: ./prod-extra.sh [idiomas]
set -euo pipefail
QA=/opt/nexus/projects/valorosters-i18n-qa; G=/tmp/i18n-rc/gate
mkdir -p "$QA/out/prod-extra"
docker run --rm --name vrqa_prod_extra --memory 4g --cpus 4 --shm-size 1g -e BASE_URL=https://valorosters.com -e SMOKE_OUT=logs/prod-extra \
  -e QA_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage" -e HOME=/tmp -v "$G:/app:ro" -v "$QA/qa-scripts:/qa-scripts:ro" -v "$QA/out/prod-extra:/work/logs/prod-extra" -w /work vrqa-chrome:2 \
  bash -c "ln -sfn /app/node_modules /work/node_modules; mkdir -p /work/scripts/lib; cp /app/scripts/lib/cdp.ts /work/scripts/lib/; cp /qa-scripts/_i18n-prod-guest-extra.ts /work/scripts/; cp /app/tsconfig.json /work/; exec node node_modules/tsx/dist/cli.mjs scripts/_i18n-prod-guest-extra.ts ${1:-es,en,de,it,fr,pt-PT,pt-BR,ja}"
