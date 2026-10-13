#!/usr/bin/env bash
# =============================================================================
# COLECCIONES POR EQUIPO · QA EN EL STACK AISLADO (se ejecuta en el VPS; nunca toca producción)
# =============================================================================
#   team-collections.sh seed              crea cuatro cuentas sintéticas (coll-tc*@example.invalid) y les pone su inventario
#   team-collections.sh ui [idiomas]      API + pantallas reales en Chrome (390 y 1440 px) contra la build que sirva vrqa_app
#   team-collections.sh cleanup           borra esas cuatro cuentas
#
# Usa los contenedores vrqa_* y sus secretos propios. Necesita en $W: _team-collections-ui.ts, tc-seed.sql y
# tc-expect.json (los genera `scripts/_team-collections-qa-prep.ts`), y en $P la sonda y la contraseña de las cuentas
# sintéticas de la QA de colecciones grandes (`_collection-scale-qa.mjs`, `coll.pw`), que se reutilizan.
# =============================================================================
set -euo pipefail
QA=/opt/nexus/projects/valorosters-i18n-qa
W=${RC_WORK:-/tmp/tc-rc}
P=${COLL_WORK:-/tmp/coll-rc}
set -a; . "$QA/secrets/qa.env"; set +a
[ -s "$P/coll.pw" ] || { umask 077; openssl rand -hex 16 > "$P/coll.pw"; }
export COLL_PW; COLL_PW=$(cat "$P/coll.pw")
psqlq() { docker exec -i vrqa_db psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 "$@"; }
LABELS="tcempty,tcfive,tcchina,tcall"

case "${1:?seed|ui|cleanup}" in
  seed)
    docker exec -i -e QA_ANON_KEY -e QA_SERVICE_KEY -e COLL_PW vrqa_app node --input-type=module - setup "$LABELS" < "$P/_collection-scale-qa.mjs"
    psqlq -q -f - < "$W/tc-seed.sql"
    psqlq -c "select split_part(u.email, '@', 1) || ': ' || count(c.uid) || ' copias · ' || count(distinct c.card_id) || ' cartas distintas' from auth.users u left join public.user_cards c on c.user_id = u.id where u.email like 'coll-tc%@example.invalid' group by u.email order by 1" < /dev/null
    ;;
  ui)
    G=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}' vrqa_app)
    echo "build servida: $(cat "$G/.next/BUILD_ID")"
    psqlq -c "delete from public.api_rate_limits where true" < /dev/null > /dev/null 2>&1 || true
    # Las capturas las escribe el contenedor con su usuario: se limpian desde un contenedor, no desde el anfitrión.
    [ -d "$W/ui" ] && docker run --rm -v "$W:/w" vrqa-chrome:2 rm -rf /w/ui
    mkdir -p "$W/ui"; chmod 777 "$W/ui"
    docker run --rm --name vrqa_tc_ui --memory 4g --cpus 4 --shm-size 1g --network container:vrqa_app \
      -e BASE_URL=http://127.0.0.1:3027 -e QA_ANON_KEY -e COLL_PW -e QA_ADMIN_EMAIL -e QA_ADMIN_PASSWORD -e UI_OUT=logs/ui -e TC_EXPECT=/qa/tc-expect.json \
      -e QA_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage" -e HOME=/tmp \
      -v "$G:/app:ro" -v "$W/_team-collections-ui.ts:/qa/_team-collections-ui.ts:ro" -v "$W/tc-expect.json:/qa/tc-expect.json:ro" -v "$W/ui:/work/logs/ui" -w /work vrqa-chrome:2 \
      bash -c "ln -sfn /app/node_modules /work/node_modules; mkdir -p /work/scripts/lib; cp /app/scripts/lib/cdp.ts /work/scripts/lib/; cp /qa/_team-collections-ui.ts /work/scripts/; cp /app/tsconfig.json /work/; exec node node_modules/tsx/dist/cli.mjs scripts/_team-collections-ui.ts ${2:-es,en,de,it,fr,pt-PT,pt-BR,ja}" > "$W/ui.log" 2>&1 < /dev/null || true
    grep -E "^(FAIL|RESULTADO)" "$W/ui.log" || tail -5 "$W/ui.log"
    ;;
  cleanup)
    psqlq -c "delete from auth.users where email like 'coll-tc%@example.invalid'" < /dev/null
    echo "cuentas coll-tc* borradas"
    ;;
esac
