#!/usr/bin/env bash
# COLECCIONES · CIERRE CON 0076 — SEGUNDA PASADA, con el catálogo servido DESDE LA BASE (como producción). Va después de
# chain13.sh (comparte la app de QA). Termina en «FIN».
#   guarda los registros y capturas de chain13 → catálogo a la base → QA de colecciones (es) sobre ese catálogo →
#   equipo nuevo dado de alta desde el panel (8 idiomas) → limpieza de lo sintético → catálogo fuera → reinicio de la app
#   (la caché no vuelve sola al catálogo del código) → comprobación final
# Nada de esto toca producción.
W=${RC_WORK:-/tmp/tc-rc2}
export RC_WORK=$W COLL_WORK=${COLL_WORK:-/tmp/coll-rc}
R="$W/team-collections.v2.sh"
cd /opt/nexus/projects/valorosters-i18n-qa
D=out/driver13b.log; : > $D
ALL=es,en,de,it,fr,pt-PT,pt-BR,ja
# Lo de chain13 no se pisa: `ui` vacía $W/ui y reescribe ui-main.log.
mkdir -p "$W/chain13"; cp "$W"/ui-main.log "$W"/ui-perm.log "$W"/chain-*.out "$W/chain13/" 2>/dev/null
[ -d "$W/ui" ] && docker run --rm -v "$W:/w" vrqa-chrome:2 sh -c 'rm -rf /w/chain13/ui && cp -r /w/ui /w/chain13/ui'
echo "$(date -u +%FT%TZ) inicio · app $(docker exec vrqa_app cat /app/.next/BUILD_ID)" >> $D
bash "$R" catalog up > "$W/b-catalog-up.out" 2>&1; echo "$(date -u +%H:%M:%S) catalog up · $(tail -1 "$W/b-catalog-up.out")" >> $D
sleep 6
bash "$R" ui es > "$W/b-ui.out" 2>&1; echo "$(date -u +%H:%M:%S) ui es (catálogo en la base) · $(grep RESULTADO "$W/b-ui.out" | tail -1)" >> $D
bash "$R" identities $ALL > "$W/b-identities.out" 2>&1; echo "$(date -u +%H:%M:%S) identities · $(grep RESULTADO "$W/b-identities.out" | tail -1)" >> $D
bash "$R" identities-cleanup > "$W/b-identities-cleanup.out" 2>&1; echo "$(date -u +%H:%M:%S) identities-cleanup · $(tail -1 "$W/b-identities-cleanup.out")" >> $D
bash "$R" catalog down > "$W/b-catalog-down.out" 2>&1; echo "$(date -u +%H:%M:%S) catalog down · $(tail -1 "$W/b-catalog-down.out")" >> $D
bash /tmp/i18n-rc/app-swap.sh "$W/gate" >> $D 2>&1
N=$(docker exec vrqa_db psql -U postgres -d postgres -X -At -c "select (select count(*) from public.content_cards) || ' cartas · ' || (select count(*) from public.content_card_versions) || ' versiones · ' || (select count(*) from public.content_players) || ' jugadores · ' || (select count(*) from public.content_team_identities) || ' identidades'" < /dev/null)
echo "$(date -u +%H:%M:%S) base de QA tras la pasada: $N" >> $D
echo "$(date -u +%H:%M:%S) FIN" >> $D
