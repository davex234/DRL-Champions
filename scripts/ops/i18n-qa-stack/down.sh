#!/usr/bin/env bash
# Borra ENTERO el stack de QA aislado (contenedores, red y volúmenes `vrqa_*`). No toca ningún otro proyecto.
set -euo pipefail
cd "$(dirname "$0")"
[ "$(basename "$PWD")" = "valorosters-i18n-qa" ] || { echo "ABORT: carpeta inesperada $PWD"; exit 2; }
docker compose -p valorosters-i18n-qa --profile services --profile api down -v --remove-orphans
docker ps -a --format '{{.Names}}' | grep '^vrqa_' && { echo "quedan contenedores vrqa_"; exit 1; } || echo QA_STACK_REMOVED
