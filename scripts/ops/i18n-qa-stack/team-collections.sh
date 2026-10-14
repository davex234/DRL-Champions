#!/usr/bin/env bash
# =============================================================================
# COLECCIONES POR EQUIPO · QA EN EL STACK AISLADO (se ejecuta en el VPS; nunca toca producción)
# =============================================================================
#   team-collections.sh seed              crea cuatro cuentas sintéticas (coll-tc*@example.invalid) y les pone su inventario
#   team-collections.sh ui [idiomas]      API + pantallas reales en Chrome (390 y 1440 px) contra la build que sirva vrqa_app
#   team-collections.sh perm              borra las cartas de China de una cuenta y comprueba que su insignia sigue (después de `ui`)
#   team-collections.sh catalog up|down   catálogo servido desde la base (como producción) y su retirada exacta
#   team-collections.sh identities [idiomas]   0076: equipo nuevo publicado desde el panel → alta → Colecciones (API y navegador)
#   team-collections.sh identities-cleanup     borra solo lo sintético de `identities`
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

case "${1:?seed|ui|perm|catalog|identities|identities-cleanup|cleanup}" in
  seed)
    docker exec -i -e QA_ANON_KEY -e QA_SERVICE_KEY -e COLL_PW vrqa_app node --input-type=module - setup "$LABELS" < "$P/_collection-scale-qa.mjs"
    psqlq -q -f - < "$W/tc-seed.sql"
    psqlq -c "select split_part(u.email, '@', 1) || ': ' || count(c.uid) || ' copias · ' || count(distinct c.card_id) || ' cartas distintas' from auth.users u left join public.user_cards c on c.user_id = u.id where u.email like 'coll-tc%@example.invalid' group by u.email order by 1" < /dev/null
    ;;
  ui|perm)
    # ui    cuentas recién reiniciadas + temporada de QA activa → API y navegador (fase main)
    # perm  borra de la base las cartas de China de `tcchina` → la insignia y lo destacado deben seguir (fase perm)
    G=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}' vrqa_app)
    echo "build servida: $(cat "$G/.next/BUILD_ID")"
    if [ "$1" = "ui" ]; then
      PHASE=main; LANGS="${2:-es,en,de,it,fr,pt-PT,pt-BR,ja}"
      bash "$W/team-collections-0075.sh" reset; bash "$W/team-collections-0075.sh" season on
      # Las capturas las escribe el contenedor con su usuario: se limpian desde un contenedor, no desde el anfitrión.
      [ -d "$W/ui" ] && docker run --rm -v "$W:/w" vrqa-chrome:2 rm -rf /w/ui
      mkdir -p "$W/ui"; chmod 777 "$W/ui"
    else
      PHASE=perm; LANGS=es
      { cat "$W/tc-0075-vars.sql"; echo "delete from public.user_cards where user_id = (select id from auth.users where email = 'coll-tcchina@example.invalid') and card_id in (select jsonb_array_elements_text(:'china_cards'::jsonb));"; } | psqlq -q
      echo "cartas de China de tcchina tras el borrado: $({ cat "$W/tc-0075-vars.sql"; echo "select count(*) from public.user_cards where user_id = (select id from auth.users where email = 'coll-tcchina@example.invalid') and card_id in (select jsonb_array_elements_text(:'china_cards'::jsonb));"; } | psqlq -q)"
    fi
    psqlq -c "delete from public.api_rate_limits where true" < /dev/null > /dev/null 2>&1 || true
    docker run --rm --name vrqa_tc_ui --memory 4g --cpus 4 --shm-size 1g --network container:vrqa_app       -e BASE_URL=http://127.0.0.1:3027 -e QA_ANON_KEY -e COLL_PW -e QA_ADMIN_EMAIL -e QA_ADMIN_PASSWORD -e UI_OUT=logs/ui -e TC_EXPECT=/qa/tc-expect.json       -e QA_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage" -e HOME=/tmp       -v "$G:/app:ro" -v "$W/_team-collections-ui.ts:/qa/_team-collections-ui.ts:ro" -v "$W/tc-expect.json:/qa/tc-expect.json:ro" -v "$W/ui:/work/logs/ui" -w /work vrqa-chrome:2       bash -c "ln -sfn /app/node_modules /work/node_modules; mkdir -p /work/scripts/lib; cp /app/scripts/lib/cdp.ts /work/scripts/lib/; cp /qa/_team-collections-ui.ts /work/scripts/; cp /app/tsconfig.json /work/; exec node node_modules/tsx/dist/cli.mjs scripts/_team-collections-ui.ts $LANGS $PHASE" > "$W/ui-$PHASE.log" 2>&1 < /dev/null || true
    grep -E "^(FAIL|RESULTADO)" "$W/ui-$PHASE.log" || tail -5 "$W/ui-$PHASE.log"
    # Lo que quedó en la base, contado aparte del instrumento.
    psqlq -c "select 'base · ' || split_part(u.email, '@', 1) || ': ' || (select count(*) from public.user_team_completions c where c.user_id = u.id) || ' compleciones · ' || coalesce((select sum(amount) from public.season_xp_ledger l where l.user_id = u.id), 0) || ' XP · ' || (select count(*) from public.user_region_badges b where b.user_id = u.id) || ' insignias · ' || (select count(*) from public.user_cards k where k.user_id = u.id) || ' cartas' from auth.users u where u.email like 'coll-tc%@example.invalid' order by 1" < /dev/null
    ;;
  catalog)
    # El catálogo servido DESDE LA BASE, como en producción. La base de QA no tiene content_* (la app sirve el del código)
    # y content-catalog-migrate.ts no da de alta cartas nuevas (exige versión 1). `up`/`down` los genera
    # `scripts/_qa-catalog-materialize.ts` (mismas funciones del juego; no borra propiedad, mazos ni pools; `down` quita
    # exactamente lo insertado). Después hay que REINICIAR la app (app-swap): la caché no vuelve sola al catálogo del código.
    case "${2:?up|down}" in
      up) psqlq < "$W/qa-catalog-up.sql" ;;
      down) psqlq < "$W/qa-catalog-down.sql" ;;
    esac
    psqlq -c "select 'catálogo en la base: ' || count(*) filter (where lifecycle = 'PUBLISHED') || ' cartas publicadas · versión ' || (select version from public.content_catalog_version) from public.content_cards" < /dev/null
    ;;
  identities)
    # 0076 · equipo nuevo dado de alta desde el panel. Datos SINTÉTICOS (solo en esta base): dos cartas publicadas con
    # el equipo impreso «QA Nuevo Equipo» (copias de una carta existente con otra clave) y esas dos cartas en el
    # inventario de tcall. Después del instrumento se borra exactamente eso (la auditoría de 0055 es append-only y queda).
    LANGS="${2:-es,en,de,it,fr,pt-PT,pt-BR,ja}"
    G=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}' vrqa_app)
    echo "build servida: $(cat "$G/.next/BUILD_ID")"
    [ "$(psqlq -c "select count(*) from public.content_cards where lifecycle = 'PUBLISHED'" < /dev/null)" -gt 0 ] || { echo "el catálogo no está en la base: team-collections.sh catalog"; exit 1; }
    psqlq -q <<'SQL'
begin;
set local session_replication_role = replica;
insert into public.content_cards (card_id, player_id, variant_id, ordinal, ovr, stats, combat, stat_boost, rarity_rank, rarity_bucket, data_version, source, generated_at, origin, lifecycle, definition_version, published_at, checksum, created_at, updated_at, presentation, presentation_rev)
select 'qa-tid-' || s.n, c.player_id, c.variant_id, c.ordinal + 900 + s.n, c.ovr, c.stats, c.combat, c.stat_boost, c.rarity_rank, c.rarity_bucket, c.data_version, c.source, c.generated_at, 'admin', 'PUBLISHED', 1, now(), 'qa-tid', now(), now(),
       coalesce(c.presentation, '{}'::jsonb) || '{"team": "QA Nuevo Equipo"}'::jsonb, 1
from (select * from public.content_cards where lifecycle = 'PUBLISHED' and card_id not like 'qa-tid-%' order by card_id limit 1) c, (values (1), (2)) s(n)
on conflict (card_id) do nothing;
insert into public.content_card_versions (card_id, version, player_id, variant_id, ovr, combat, stats, stat_boost, rarity_rank, rarity_bucket, data_version, source, generated_at, checksum, effective_from)
select 'qa-tid-' || s.n, 1, v.player_id, v.variant_id, v.ovr, v.combat, v.stats, v.stat_boost, v.rarity_rank, v.rarity_bucket, v.data_version, v.source, v.generated_at, 'qa-tid', now()
from (select * from public.content_card_versions where card_id = (select card_id from public.content_cards where lifecycle = 'PUBLISHED' and card_id not like 'qa-tid-%' order by card_id limit 1) and version = 1) v, (values (1), (2)) s(n)
on conflict do nothing;
insert into public.user_cards (uid, user_id, card_id, origin, locked, obtained_at)
select gen_random_uuid(), u.id, 'qa-tid-' || s.n, 'pack', false, now() from auth.users u, (values (1), (2)) s(n) where u.email = 'coll-tcall@example.invalid'
  and not exists (select 1 from public.user_cards k where k.user_id = u.id and k.card_id = 'qa-tid-' || s.n);
update public.content_catalog_version set version = version + 1;
commit;
SQL
    psqlq -c "delete from public.api_rate_limits where true" < /dev/null > /dev/null 2>&1 || true
    sleep 6 # la caché del catálogo comprueba la versión cada 5 s
    mkdir -p "$W/ui-id"; chmod 777 "$W/ui-id"
    docker run --rm --name vrqa_tc_id --memory 4g --cpus 4 --shm-size 1g --network container:vrqa_app \
      -e BASE_URL=http://127.0.0.1:3027 -e QA_ANON_KEY -e COLL_PW -e QA_ADMIN_EMAIL -e QA_ADMIN_PASSWORD -e UI_OUT=logs/ui -e QA_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage" -e HOME=/tmp \
      -v "$G:/app:ro" -v "$W/_team-identities-ui.ts:/qa/_team-identities-ui.ts:ro" -v "$W/ui-id:/work/logs/ui" -w /work vrqa-chrome:2 \
      bash -c "ln -sfn /app/node_modules /work/node_modules; mkdir -p /work/scripts/lib; cp /app/scripts/lib/cdp.ts /work/scripts/lib/; cp /qa/_team-identities-ui.ts /work/scripts/; cp /app/tsconfig.json /work/; exec node node_modules/tsx/dist/cli.mjs scripts/_team-identities-ui.ts $LANGS" > "$W/ui-identities.log" 2>&1 < /dev/null || true
    grep -E "^(FAIL|RESULTADO)" "$W/ui-identities.log" || tail -5 "$W/ui-identities.log"
    ;;
  identities-cleanup)
    # Borra SOLO lo sintético de `identities`: las dos cartas qa-tid-*, sus ejemplares, la identidad «QA Nuevo Equipo»
    # y la compleción/XP de ese equipo. Nada más.
    psqlq -q <<'SQL'
begin;
set local session_replication_role = replica;
delete from public.user_cards where card_id like 'qa-tid-%';
delete from public.content_card_versions where card_id like 'qa-tid-%' and checksum = 'qa-tid';
delete from public.content_cards where card_id like 'qa-tid-%' and checksum = 'qa-tid';
delete from public.content_team_identities where printed_team = 'QA Nuevo Equipo';
delete from public.user_team_completions where team_id = 'qa-nuevo';
update public.season_progress p set xp = p.xp - l.amount
  from (select user_id, season_id, sum(amount) amount from public.season_xp_ledger where event_key = 'team-collection:qa-nuevo' group by 1, 2) l
 where p.user_id = l.user_id and p.season_id = l.season_id;
delete from public.season_xp_ledger where event_key = 'team-collection:qa-nuevo';
delete from public.season_events where event_key = 'team-collection:qa-nuevo';
update public.content_catalog_version set version = version + 1;
commit;
SQL
    psqlq -c "select 'restos: ' || (select count(*) from public.content_cards where card_id like 'qa-tid-%') + (select count(*) from public.user_cards where card_id like 'qa-tid-%') + (select count(*) from public.content_team_identities where printed_team = 'QA Nuevo Equipo') + (select count(*) from public.user_team_completions where team_id = 'qa-nuevo')" < /dev/null
    ;;
  cleanup)
    psqlq -c "delete from auth.users where email like 'coll-tc%@example.invalid'" < /dev/null
    echo "cuentas coll-tc* borradas"
    ;;
esac
