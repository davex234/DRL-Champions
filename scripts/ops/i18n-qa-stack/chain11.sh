#!/usr/bin/env bash
# COLECCIONES POR EQUIPO · regresión de navegador sobre la candidata que YA sirve `vrqa_app` (se ejecuta en el VPS con
# setsid nohup). Termina en «FIN». No reconstruye ni cambia la app: usa la que esté levantada.
#   QA autenticada (8 idiomas: sobres, crafteo, equipos, tienda…) → visual de las pantallas tocadas y vecinas
#   (8 idiomas) → humo de invitado (8)
cd /opt/nexus/projects/valorosters-i18n-qa
ALL=es,en,de,it,fr,pt-PT,pt-BR,ja
TOUCHED="/coleccion/trofeos,/coleccion/trofeos/g2,/coleccion/trofeos/paper-rex,/coleccion,/cuenta,/jugador/me,/logros,/temporada"
D=out/driver.log; : > $D
waitc() { while [ "$(docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null)" = "running" ]; do sleep 10; done; docker logs "$1" > "out/$1.log" 2>&1; echo "$(date -u +%H:%M:%S) fin $1 exit=$(docker inspect -f '{{.State.ExitCode}}' "$1") $(grep -E 'RESULTADO|PASS ·.*FAIL|^TOTAL' "out/$1.log" | tail -1)" >> $D; }
echo "$(date -u +%FT%TZ) inicio · app $(docker exec vrqa_app cat /app/.next/BUILD_ID)" >> $D
./qa-run.sh run auth scripts/_i18n-auth-qa.ts $ALL >> $D 2>&1; waitc vrqa_run_auth
QA_CDP_PORT_BASE=9800 I18N_LOCALES=$ALL I18N_ROUTES="$TOUCHED" I18N_SECTIONS=player I18N_TAG=player-colecciones-equipos ./qa-run.sh run visual scripts/_i18n-visual-qa.ts >> $D 2>&1; waitc vrqa_run_visual
./qa-run.sh run smoke scripts/_i18n-prod-guest-smoke.ts $ALL >> $D 2>&1; waitc vrqa_run_smoke
echo "$(date -u +%H:%M:%S) FIN" >> $D
