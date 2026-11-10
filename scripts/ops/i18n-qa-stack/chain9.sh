#!/usr/bin/env bash
# RC FINAL de 8 idiomas · compuerta + QA de lo que tocan los últimos arreglos (se ejecuta en el VPS con setsid nohup). Termina en «FIN».
#   gate → app → WALKOUT 3D (8) → QA autenticada (8)
#   → [visual jugador ja completa ‖ visual admin idiomas nuevos completa]
#   → [visual jugador resto de idiomas, rutas de tienda/sobres/crafteo/raíl ‖ visual admin idiomas antiguos, pantallas con raíl + walkout]
#   → motores (Firefox + WebKit + Chromium) en japonés → humo de invitado (8) → ensayo de rollback con barrera
cd /opt/nexus/projects/valorosters-i18n-qa
ALL=es,en,de,it,fr,pt-PT,pt-BR,ja; NEW=fr,pt-PT,pt-BR,ja; OLDL=es,en,de,it; REST=es,en,de,it,fr,pt-PT,pt-BR
SHOP="/,/tienda,/tienda/creditos,/packs,/inventario,/coleccion,/colecciones,/misiones,/misiones/crafting,/misiones/crafting/sobres,/misiones/crafting/cartas,/temporada,/torneos,/entrenador,/cuenta?seccion=cuenta"
RAIL="/admin/cartas,/admin/cartas/nueva,/admin/operations,/admin/pools,/admin/pools/nueva,/admin/packs,/admin/crafting,/admin/walkout"
D=out/driver.log; : > $D
waitc() { while [ "$(docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null)" = "running" ]; do sleep 10; done; docker logs "$1" > "out/$1.log" 2>&1; echo "$(date -u +%H:%M:%S) fin $1 exit=$(docker inspect -f '{{.State.ExitCode}}' "$1") $(grep -E 'RESULTADO' "out/$1.log" | tail -1 | cut -c1-70)" >> $D; }
echo "$(date -u +%FT%TZ) inicio $(cat /tmp/i18n-rc/id)" >> $D
bash /tmp/i18n-rc/_i18n-rc-stage.sh gate > /tmp/i18n-rc/gate-run.out 2>&1
echo "$(date -u +%H:%M:%S) gate $(grep -E '^ℹ (tests|pass|fail)' /tmp/i18n-rc/gate.log | tr '\n' ' ') build=$(cat /tmp/i18n-rc/gate/.next/BUILD_ID 2>/dev/null) ts=$(grep -c 'error TS' /tmp/i18n-rc/gate.log)" >> $D
[ "$(cat /tmp/i18n-rc/gate/.next/BUILD_ID 2>/dev/null)" = "$(cat /tmp/i18n-rc/id)" ] || { echo "ABORT: build id" >> $D; exit 1; }
[ "$(grep -E '^ℹ fail' /tmp/i18n-rc/gate.log | tr -dc 0-9)" = "8" ] || { echo "ABORT: fallos de test inesperados" >> $D; exit 1; }
./qa-run.sh app >> $D 2>&1 || { echo "ABORT: app" >> $D; exit 1; }
./qa-run.sh run w3d scripts/_i18n-walkout3d-qa.ts $ALL >> $D 2>&1; waitc vrqa_run_w3d
./qa-run.sh run auth scripts/_i18n-auth-qa.ts $ALL >> $D 2>&1; waitc vrqa_run_auth
QA_CDP_PORT_BASE=9800 I18N_LOCALES=ja I18N_SECTIONS=player I18N_TAG=player-ja ./qa-run.sh run visual scripts/_i18n-visual-qa.ts >> $D 2>&1
QA_CDP_PORT_BASE=10200 I18N_LOCALES=$NEW I18N_SECTIONS=admin I18N_TAG=admin-new ./qa-run.sh run visualadmin scripts/_i18n-visual-qa.ts >> $D 2>&1
waitc vrqa_run_visual; waitc vrqa_run_visualadmin
QA_CDP_PORT_BASE=9800 I18N_LOCALES=$REST I18N_ROUTES="$SHOP" I18N_SECTIONS=player I18N_TAG=player-rest ./qa-run.sh run visualrest scripts/_i18n-visual-qa.ts >> $D 2>&1
QA_CDP_PORT_BASE=10200 I18N_LOCALES=$OLDL I18N_ADMINROUTES="$RAIL" I18N_SECTIONS=admin I18N_TAG=admin-old ./qa-run.sh run visualadminold scripts/_i18n-visual-qa.ts >> $D 2>&1
waitc vrqa_run_visualrest; waitc vrqa_run_visualadminold
./engines-run.sh engines firefox,webkit,chromium ja 390,768,1440 >> $D 2>&1; waitc vrqa_run_engines
./qa-run.sh run smoke scripts/_i18n-prod-guest-smoke.ts $ALL >> $D 2>&1; waitc vrqa_run_smoke
( cd /tmp/i18n-rc && ./rollback-rehearsal.sh /tmp/i18n-rc/gate /tmp/i18n-rc/old > out-rollback-rc.txt 2>&1; echo "$(date -u +%H:%M:%S) ensayo rollback exit=$? $(tail -1 out-rollback-rc.txt)" ) >> $D
cp /tmp/i18n-rc/out-rollback-rc.txt out/ 2>/dev/null
echo "$(date -u +%H:%M:%S) FIN" >> $D
