#!/usr/bin/env bash
# Cadena de QA contra la RC, dentro del stack aislado (se ejecuta en el VPS, en segundo plano: `nohup ./driver.sh &`).
# w3d → auth en serie (comparten la cuenta de jugador). Después, la pasada visual de JUGADOR y la de ADMINISTRACIÓN
# en paralelo: usan cuentas distintas (qa-player / qa-admin), así que no se pisan el idioma. Termina con «FIN».
cd /opt/nexus/projects/valorosters-i18n-qa
D=out/driver.log; : > $D
waitc() { while [ "$(docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null)" = "running" ]; do sleep 10; done; docker logs "$1" > "out/$1.log" 2>&1; echo "$(date -u +%H:%M:%S) fin $1 exit=$(docker inspect -f '{{.State.ExitCode}}' "$1")" >> $D; }
rm -f out/logs/i18n/rc/auth-baseline-es.json
echo "$(date -u +%H:%M:%S) inicio $(cat /tmp/i18n-rc/id)" >> $D
./qa-run.sh run w3d scripts/_i18n-walkout3d-qa.ts es,en,de,it >> $D 2>&1; waitc vrqa_run_w3d
./qa-run.sh run auth scripts/_i18n-auth-qa.ts es,en,de,it >> $D 2>&1; waitc vrqa_run_auth
I18N_SECTIONS=player I18N_TAG=player ./qa-run.sh run visual scripts/_i18n-visual-qa.ts >> $D 2>&1
I18N_SECTIONS=admin I18N_TAG=admin ./qa-run.sh run visualadmin scripts/_i18n-visual-qa.ts >> $D 2>&1
waitc vrqa_run_visualadmin; waitc vrqa_run_visual
I18N_TAG=after ./qa-run.sh run probe scripts/_i18n-packcard-probe.ts 390,768,1440 >> $D 2>&1; waitc vrqa_run_probe
echo "$(date -u +%H:%M:%S) FIN" >> $D
