#!/usr/bin/env bash
# ValoRosters · QA de MOTORES (Firefox + WebKit/Safari + Chromium de referencia) dentro del stack de QA aislado. En el VPS:
#   engines-run.sh <nombre> [ENGINES] [I18N_LOCALES] [I18N_WIDTHS]     → contenedor `vrqa_run_<nombre>`, salida en out/engines-<nombre>/
# Comparte la red de `vrqa_app` (la app es 127.0.0.1:3027). Cuentas sintéticas; nada toca producción.
set -euo pipefail
QA=/opt/nexus/projects/valorosters-i18n-qa
PW_IMG=mcr.microsoft.com/playwright:v1.62.1-noble
name="${1:?nombre}"; engines="${2:-firefox,webkit,chromium}"; locales="${3:-ja}"; widths="${4:-390,768,1440}"
mkdir -p "$QA/out/engines-$name" "$QA/pw-node"
if [ ! -d "$QA/pw-node/node_modules/playwright" ]; then
  docker run --rm -v "$QA/pw-node:/pw" -w /pw -e HOME=/tmp $PW_IMG bash -c 'npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.62.1 >/dev/null && chmod -R a+rX /pw'
fi
docker rm -f "vrqa_run_$name" >/dev/null 2>&1 || true
docker run -d --name "vrqa_run_$name" --memory 6g --cpus 6 --shm-size 1g --ipc host --network container:vrqa_app \
  -e BASE_URL=http://127.0.0.1:3027 -e QA_ENV=/qa.env -e HOME=/tmp -e PW_REQUIRE_FROM=/pw/package.json -e OUT_DIR=/out \
  -e ENGINES="$engines" -e I18N_LOCALES="$locales" -e I18N_WIDTHS="$widths" \
  -v "$QA/secrets/qa.env:/qa.env:ro" -v "$QA/pw-node:/pw:ro" -v "$QA/qa-scripts:/qa-scripts:ro" -v "$QA/out/engines-$name:/out" \
  -w /out $PW_IMG node /qa-scripts/_i18n-engines-qa.mjs >/dev/null
echo "RUN vrqa_run_$name"
