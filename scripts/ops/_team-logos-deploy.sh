#!/usr/bin/env bash
# =============================================================================
# LOGOS DE EQUIPO · ACTIVAR drl-0.1.1-1-baddbaed (2026-10-15). Lo ejecuta el propietario:
#   ssh nexusadmin@212.95.40.144 'bash /tmp/tl-rc/_team-logos-deploy.sh'
# Comprueba que la viva sigue siendo d523a42a y que hay copia de hoy verificada, copia la candidata (puerta GATE_OK)
# a incoming/, verifica su sha256 allí y llama al procedimiento oficial `bin/deploy.sh`. Sin migraciones, sin tocar la
# base ni otros servicios (deploy.sh recrea solo valorosters-app). Vuelta: bin/deploy.sh --activate drl-0.1.1-1-d523a42a
# =============================================================================
set -euo pipefail
ID=drl-0.1.1-1-baddbaed
PREV=drl-0.1.1-1-d523a42a
SHA=2d19ca561919cf3fd967642ab02aa45f1036afada59c67aeba5f90273b1294cc
V=/opt/nexus/projects/valorosters
RC=/opt/nexus/projects/valorosters-i18n-qa/rc
B=/opt/nexus/backups/supabase-drlcards/pre-logos-deploy/20261015T092513Z
[ "$(readlink $V/current)" = "releases/$PREV" ] || { echo "ABORT: la viva no es $PREV"; exit 2; }
[ -f $B/COMPLETE ] && ( cd $B && sha256sum -c --quiet SHA256SUMS ) && echo "BACKUP_VERIFIED $B" || { echo "ABORT: copia"; exit 2; }
( cd $V/incoming && echo "4acdf145c568514b1386692d9ff56bb9cc619f79d6fa2a540d69726132fa2df6  $PREV.tar" | sha256sum -c --quiet ) && echo "PREV_ARTIFACT_OK $PREV"
[ ! -e $V/releases/$ID ] && [ ! -e $V/incoming/$ID.tar ] || { echo "ABORT: $ID ya existe"; exit 2; }
echo "$SHA  $ID.tar" | ( cd $RC && sha256sum -c --quiet ) && echo "RC_OK $ID"
cp $RC/$ID.tar $RC/$ID.tar.sha256 $V/incoming/
( cd $V/incoming && sha256sum -c $ID.tar.sha256 )
echo "inicio $(date -u +%FT%TZ)"
cd $V && bin/deploy.sh $ID
echo "fin $(date -u +%FT%TZ)"
echo "ACTIVA $(readlink $V/current) · BUILD_ID $(cat $V/current/.next/BUILD_ID)"
curl -fsS http://127.0.0.1:3005/api/ready | head -c 300; echo
