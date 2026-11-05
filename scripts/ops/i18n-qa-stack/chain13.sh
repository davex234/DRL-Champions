#!/usr/bin/env bash
# COLECCIONES · CIERRE CON 0076 (2026-10-14) — cadena completa sobre la candidata compilada en $W/gate (se ejecuta en el VPS
# con setsid nohup). Termina en «FIN».
#   sirve la candidata → catálogo servido desde la base (como producción) → QA propia de colecciones en 8 idiomas (API,
#   recompensas, navegador, perfil) → permanencia → equipo nuevo dado de alta desde el panel (8 idiomas) y limpieza de lo
#   sintético → regresión: QA autenticada (8) → visual de pantallas tocadas y vecinas (8) → humo de invitado (8)
# Nada de esto toca producción: red, base y cuentas propias del stack de QA.
W=${RC_WORK:-/tmp/tc-rc2}
export RC_WORK=$W COLL_WORK=${COLL_WORK:-/tmp/coll-rc}
cd /opt/nexus/projects/valorosters-i18n-qa
ALL=es,en,de,it,fr,pt-PT,pt-BR,ja
TOUCHED="/coleccion/trofeos,/coleccion/trofeos/g2,/coleccion/trofeos/paper-rex,/coleccion,/cuenta,/jugador/me,/logros,/temporada,/copas"
D=out/driver13.log; : > $D
waitc() { while [ "$(docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null)" = "running" ]; do sleep 10; done; docker logs "$1" > "out/$1.log" 2>&1; echo "$(date -u +%H:%M:%S) fin $1 exit=$(docker inspect -f '{{.State.ExitCode}}' "$1") $(grep -E 'RESULTADO|PASS ·.*FAIL|^TOTAL' "out/$1.log" | tail -1)" >> $D; }
bash /tmp/i18n-rc/app-swap.sh "$W/gate" >> $D 2>&1
echo "$(date -u +%FT%TZ) inicio · app $(docker exec vrqa_app cat /app/.next/BUILD_ID)" >> $D
bash "$W/team-collections.sh" catalog > "$W/chain-catalog.out" 2>&1; echo "$(date -u +%H:%M:%S) fin catalog · $(tail -1 "$W/chain-catalog.out")" >> $D
bash "$W/team-collections.sh" ui $ALL > "$W/chain-ui.out" 2>&1; echo "$(date -u +%H:%M:%S) fin ui · $(grep RESULTADO "$W/chain-ui.out" | tail -1)" >> $D
bash "$W/team-collections.sh" perm > "$W/chain-perm.out" 2>&1; echo "$(date -u +%H:%M:%S) fin perm · $(grep RESULTADO "$W/chain-perm.out" | tail -1)" >> $D
bash "$W/team-collections.sh" identities $ALL > "$W/chain-identities.out" 2>&1; echo "$(date -u +%H:%M:%S) fin identities · $(grep RESULTADO "$W/chain-identities.out" | tail -1)" >> $D
bash "$W/team-collections.sh" identities-cleanup > "$W/chain-identities-cleanup.out" 2>&1; echo "$(date -u +%H:%M:%S) fin identities-cleanup · $(tail -1 "$W/chain-identities-cleanup.out")" >> $D
docker exec -i vrqa_db psql -U postgres -d postgres -X -Atq -c "delete from public.api_rate_limits where true" < /dev/null > /dev/null 2>&1
./qa-run.sh run auth scripts/_i18n-auth-qa.ts $ALL >> $D 2>&1; waitc vrqa_run_auth
QA_CDP_PORT_BASE=9800 I18N_LOCALES=$ALL I18N_ROUTES="$TOUCHED" I18N_SECTIONS=player I18N_TAG=player-colecciones-0076 ./qa-run.sh run visual scripts/_i18n-visual-qa.ts >> $D 2>&1; waitc vrqa_run_visual
./qa-run.sh run smoke scripts/_i18n-prod-guest-smoke.ts $ALL >> $D 2>&1; waitc vrqa_run_smoke
echo "$(date -u +%H:%M:%S) FIN" >> $D
