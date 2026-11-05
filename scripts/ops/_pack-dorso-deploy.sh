#!/usr/bin/env bash
# =============================================================================
# APERTURA DE SOBRES (dorso neutro antes del giro) · ACTIVAR drl-0.1.1-1-06d507d2 — PREPARADO 2026-10-15, NO EJECUTADO.
#   Lo lanza el propietario cuando decida desplegar, con una copia de seguridad del MISMO día ya verificada:
#     ssh nexusadmin@212.95.40.144 'bash /tmp/pa2-rc/_pack-dorso-deploy.sh /opt/nexus/backups/supabase-drlcards/<carpeta>'
# Comprueba que la viva sigue siendo 2b8f8817, la copia (COMPLETE + SHA256SUMS), el artefacto anterior y la candidata
# (puerta GATE_OK), copia la candidata a incoming/, verifica su sha256 allí y llama al procedimiento oficial
# `bin/deploy.sh` (build + BUILD_ID + recrea SOLO valorosters-app). Sin migraciones, sin tocar la base ni otros servicios.
# Vuelta atrás: cd /opt/nexus/projects/valorosters && bin/deploy.sh --activate drl-0.1.1-1-2b8f8817
# =============================================================================
set -euo pipefail
ID=drl-0.1.1-1-06d507d2
PREV=drl-0.1.1-1-2b8f8817
SHA=f8560c30b7057dcedb7021e29292100f39dc4dd0627f77a5e3bc136e4c76c673
PREV_SHA=8f6cdf70199c6c6df10175fa023bbefbbe7e2f6f5c2ec43891065fe03f544d3b
V=/opt/nexus/projects/valorosters
RC=/opt/nexus/projects/valorosters-i18n-qa/rc
B=${1:?uso: _pack-dorso-deploy.sh <carpeta de copia verificada>}
[ "$(readlink $V/current)" = "releases/$PREV" ] || { echo "ABORT: la viva no es $PREV"; exit 2; }
[ -f $B/COMPLETE ] && ( cd $B && sha256sum -c --quiet SHA256SUMS ) && echo "BACKUP_VERIFIED $B" || { echo "ABORT: copia"; exit 2; }
( cd $V/incoming && echo "$PREV_SHA  $PREV.tar" | sha256sum -c --quiet ) && echo "PREV_ARTIFACT_OK $PREV"
[ ! -e $V/releases/$ID ] && [ ! -e $V/incoming/$ID.tar ] || { echo "ABORT: $ID ya existe"; exit 2; }
echo "$SHA  $ID.tar" | ( cd $RC && sha256sum -c --quiet ) && echo "RC_OK $ID"
cp $RC/$ID.tar $RC/$ID.tar.sha256 $V/incoming/
( cd $V/incoming && sha256sum -c $ID.tar.sha256 )
echo "inicio $(date -u +%FT%TZ)"
cd $V && bin/deploy.sh $ID
echo "fin $(date -u +%FT%TZ)"
echo "ACTIVA $(readlink $V/current) · BUILD_ID $(cat $V/current/.next/BUILD_ID)"
curl -fsS http://127.0.0.1:3005/api/ready | head -c 300; echo
