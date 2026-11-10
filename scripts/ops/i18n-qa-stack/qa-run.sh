#!/usr/bin/env bash
# ValoRosters · QA de navegador DENTRO del stack de QA aislado (cuando el PC no tiene memoria). Se ejecuta en el VPS.
#   qa-run.sh app            sirve la build de la RC (/tmp/i18n-rc/gate) como `vrqa_app`, solo en la red de QA
#   qa-run.sh run <nombre> <script.ts> [args…]   lanza un instrumento en segundo plano (Chrome sin cabeza en contenedor,
#                                                 compartiendo la red de `vrqa_app`: la app es 127.0.0.1:3027)
#   qa-run.sh status | down
# Nada de esto toca producción: red propia, base de datos propia, cuentas sintéticas.
set -euo pipefail
QA=/opt/nexus/projects/valorosters-i18n-qa
G=/tmp/i18n-rc/gate
IMG=node:24.15.0-bookworm-slim
CHROME_IMG=vrqa-chrome:2
case "${1:?app|run|status|down}" in
  app)
    docker rm -f vrqa_app >/dev/null 2>&1 || true
    set -a; . "$QA/secrets/qa.env"; set +a
    umask 077
    printf '%s\n' "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3027" "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3027" "NEXT_PUBLIC_SUPABASE_SAME_ORIGIN=1" "SUPABASE_INTERNAL_URL=http://vrqa_kong:8000" \
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=$QA_ANON_KEY" "SUPABASE_SERVICE_ROLE_KEY=$QA_SERVICE_KEY" "NEXT_PUBLIC_ADMIN=1" "ESPORTS_AUTO_SYNC_ENABLED=false" "SYNC_SECRET=rc-gate-not-production-000000000000000000" > "$QA/secrets/app-qa.env"
    docker run -d --name vrqa_app --user 1000:1000 --memory 2g --cpus 4 --init --network valorosters-i18n-qa \
      --env-file "$QA/secrets/app-qa.env" -e NODE_ENV=production -e NEXT_TELEMETRY_DISABLED=1 -e HOME=/tmp \
      -v "$G:/app:ro" -w /app $IMG node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3027 >/dev/null
    for i in $(seq 1 40); do
      [ "$(docker exec vrqa_app node -e "fetch('http://127.0.0.1:3027/api/health').then(r=>console.log(r.status)).catch(()=>console.log(0))" 2>/dev/null)" = "200" ] && { echo "APP_UP $(cat $G/.next/BUILD_ID)"; docker exec vrqa_app node -e "fetch('http://127.0.0.1:3027/api/ready').then(r=>r.json()).then(j=>console.log(j.status, j.migrationHead, j.checks.filter(c=>!c.ok).map(c=>c.id).join(',')))"; exit 0; }
      sleep 2
    done
    echo "la app no arranca"; docker logs --tail 30 vrqa_app; exit 1
    ;;
  run)
    name="${2:?nombre}"; shift 2
    if ! docker image inspect $CHROME_IMG >/dev/null 2>&1; then
      printf '%s\n' "FROM $IMG" 'RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji ca-certificates && rm -rf /var/lib/apt/lists/* && ln -s /usr/bin/chromium /usr/bin/google-chrome' | docker build -q -t $CHROME_IMG - >/dev/null
    fi
    mkdir -p "$QA/out/docs" "$QA/out/logs"
    docker rm -f "vrqa_run_$name" >/dev/null 2>&1 || true
    docker run -d --name "vrqa_run_$name" --memory 6g --cpus 6 --shm-size 1g --network container:vrqa_app \
      -e BASE_URL=http://127.0.0.1:3027 -e QA_ENV=/qa.env -e QA_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage" -e HOME=/tmp \
      $(env | grep -E '^(I18N_[A-Z]+|QA_CDP_PORT_BASE)=' | sed 's/^/-e /') \
      -v "$QA/secrets/qa.env:/qa.env:ro" -v "$G:/app:ro" -v "$QA/qa-scripts:/qa-scripts:ro" \
      -v "$QA/out/docs:/work/docs" -v "$QA/out/logs:/work/logs" -w /work $CHROME_IMG \
      bash -c 'ln -sfn /app/node_modules /work/node_modules; ln -sfn /app/scripts /work/scripts-base; mkdir -p /work/scripts/lib /work/logs/i18n/rc; cp /app/scripts/lib/cdp.ts /work/scripts/lib/; cp /qa-scripts/*.ts /work/scripts/; [ -f /qa-scripts/lib/cdp.ts ] && cp /qa-scripts/lib/cdp.ts /work/scripts/lib/; cp /app/tsconfig.json /work/ 2>/dev/null; exec node node_modules/tsx/dist/cli.mjs "$@"' _ "$@" >/dev/null
    echo "RUN vrqa_run_$name"
    ;;
  status)
    docker ps -a --format '{{.Names}}\t{{.Status}}' | grep '^vrqa_' | sort
    ;;
  down)
    for c in $(docker ps -a --format '{{.Names}}' | grep -E '^vrqa_(app|run_)' || true); do docker rm -f "$c" >/dev/null; done
    rm -f "$QA/secrets/app-qa.env"; echo "QA_APP_DOWN"
    ;;
esac
