#!/usr/bin/env bash
# =============================================================================
# APERTURA DE SOBRES · SALA POR RAREZA, SIN WALKOUT · RELEASE CANDIDATA (2026-10-15) — PREPARA, NO DESPLIEGA.
# =============================================================================
#   ssh nexusadmin@VPS 'bash /tmp/pa-rc/_pack-atmosphere-rc-stage.sh stage'   fuente de PRODUCCIÓN (baddbaed, solo lectura)
#                                                                              + overlay de la rama feat/pack-opening-atmosphere
#                                                                              → frontera, F78, economía y servidor intactos,
#                                                                              SIN migraciones, BUILD_ID, tar en rc/
#   ssh nexusadmin@VPS 'bash /tmp/pa-rc/_pack-atmosphere-rc-stage.sh gate'    npm ci + next build + tsc + eslint + i18n +
#                                                                              tests de esa fuente en un contenedor desechable
#                                                                              con el entorno del STACK DE QA (ni secretos ni red
#                                                                              de producción)
#
# Es `_team-logos-rc-stage.sh` con otra base, otra carpeta y otra lista de comprobaciones. Necesita $W/overlay.tar,
# $W/overlay.txt (añadidos+modificados, rutas relativas) y $W/test-fixtures.tar. No escribe en `incoming/`, `releases/` ni
# `current`, no toca valorosters-app ni la base.
# =============================================================================
set -euo pipefail
V=/opt/nexus/projects/valorosters
QA=/opt/nexus/projects/valorosters-i18n-qa
BASE=${RC_BASE:-drl-0.1.1-1-baddbaed}
W=${RC_WORK:-/tmp/pa-rc}
ST=$W/stage
IMG=node:24.15.0-bookworm-slim
case "${1:?stage|gate}" in
  stage)
    [ "$(readlink "$V/current")" = "releases/$BASE" ] || { echo "ABORT: la release viva ya no es $BASE ($(readlink "$V/current"))"; exit 2; }
    rm -rf "$ST"; mkdir -p "$ST"
    ( cd "$V/releases/$BASE" && tar --exclude=./node_modules --exclude=./.next --exclude=./tsconfig.tsbuildinfo --exclude=./next-env.d.ts --exclude='./.env*' -cf - . ) | tar -xf - -C "$ST"
    ( cd "$ST" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > $W/base.sha
    tar -xf $W/overlay.tar -C "$ST"
    ( cd "$ST" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > $W/staged.sha
    names() { sed 's/^[0-9a-f]*  \.\///' "$1" | sort; }
    comm -13 <(names $W/base.sha) <(names $W/staged.sha) > $W/added.txt
    comm -23 <(names $W/base.sha) <(names $W/staged.sha) > $W/removed.txt
    join -j2 -o 1.1,1.2,2.1 <(sort -k2 $W/base.sha) <(sort -k2 $W/staged.sha) | awk '$1 != $3 {print $2}' | sed 's/^\.\///' | sort > $W/modified.txt
    echo "base $(wc -l < $W/base.sha) · staged $(wc -l < $W/staged.sha) · añadidos $(wc -l < $W/added.txt) · modificados $(wc -l < $W/modified.txt) · borrados $(wc -l < $W/removed.txt)"
    cat $W/added.txt $W/modified.txt | sort > $W/changed.txt
    diff -q $W/changed.txt <(sort $W/overlay.txt) >/dev/null && echo "BOUNDARY_OK añadidos+modificados = overlay exacto ($(wc -l < $W/changed.txt))" || { echo "BOUNDARY_FAIL"; diff $W/changed.txt <(sort $W/overlay.txt) | head; exit 1; }
    [ ! -s $W/removed.txt ] && echo "BOUNDARY_OK ningún fichero retirado" || { echo "BOUNDARY_FAIL borrados"; head $W/removed.txt; exit 1; }
    for f in scripts/ops/backup-drlcards.sh scripts/ops/backup-offsite.sh scripts/ops/backup-status.sh scripts/ops/backup-cron.sh scripts/ops/backup-schedule.sh scripts/ops/offsite-harness.sh scripts/ops/offsite-drill.sh scripts/ops/b2-provision.mjs scripts/ops/restore-drill.sh scripts/ops/production-check.ts src/instrumentation.ts src/domain/ops/backup.ts; do
      if [ -f "$V/releases/$BASE/$f" ]; then
        [ "$(sha256sum < "$V/releases/$BASE/$f")" = "$(sha256sum < "$ST/$f")" ] && echo "F78 = producción: $f" || { echo "F78 LEAK: $f"; exit 1; }
      else
        [ ! -e "$ST/$f" ] && echo "F78 ausente en producción y en la RC: $f" || { echo "F78 LEAK (nuevo): $f"; exit 1; }
      fi
    done
    # Sin migraciones, sin Supabase, sin docs, sin instrumentos `_` (la QA de navegador no viaja en la release).
    ! grep -E '^(supabase/|docs/|scripts/_)' $W/changed.txt && echo "NO_MIGRATIONS_OK ni supabase/, ni docs/, ni instrumentos _ en el overlay" || { echo "MIGRATION_DOCS_OR_QA_IN_OVERLAY"; exit 1; }
    [ "$(ls "$ST/supabase/migrations" | sort | tail -1)" = "$(ls "$V/releases/$BASE/supabase/migrations" | sort | tail -1)" ] && echo "MIGRATIONS_OK cabeza = la de producción ($(ls "$ST/supabase/migrations" | sort | tail -1))" || { echo "MIGRATIONS_FAIL"; exit 1; }
    # Economía, sorteo, catálogo, servidor y middleware byte a byte los de producción. En domain/packs SOLO cambian la
    # presentación de la ceremonia (reveal.ts, atmosphere.ts): ni openPack, ni packClass, ni odds, ni precios, ni pools.
    ! grep -E '^src/(data/|domain/(economy|crafting|forge|teamCollections|cards|collection)/|pack/|server/|app/api/|lib/game/|store/|middleware\.ts)' $W/changed.txt \
      && echo "ECONOMY_RULES_OK sin data/, economía, cartas, colección, servidor, API, sync, store ni middleware" || { echo "ECONOMY_OR_RULES_TOUCHED"; exit 1; }
    BAD_PACKS=$(grep -E '^src/domain/packs/' $W/changed.txt | grep -vE '^src/domain/packs/(reveal|atmosphere)\.ts$' || true)
    [ -z "$BAD_PACKS" ] && echo "PACKS_DOMAIN_OK en domain/packs solo reveal.ts (presentación) y atmosphere.ts (nuevo)" || { echo "PACKS_DOMAIN_TOUCHED $BAD_PACKS"; exit 1; }
    grep -q 'PACK_WALKOUT_3D_ENABLED: "off" | "admins" | "all" = "off";' "$ST/src/config/features.ts" && ! grep -qE 'PackWalkout|PACK_WALKOUT_3D_ENABLED' "$ST/src/components/packs/PackOpeningExperience.tsx" \
      && echo "WALKOUT_OUT_OK la apertura no monta el walkout; interruptor en off; /admin/walkout presente: $(test -f "$ST/src/app/admin/walkout/page.tsx" && echo sí)" || { echo "WALKOUT_STILL_IN_OPENING"; exit 1; }
    ID=$(docker run --rm -v "$ST:/app:ro" -w /app $IMG node --input-type=module -e "const m = await import('/app/next.config.mjs'); console.log(await m.default.generateBuildId())")
    echo "BUILD_ID=$ID"
    [ -e "$V/releases/$ID" ] && { echo "ya existe releases/$ID"; exit 1; }
    [ -e "$V/incoming/$ID.tar" ] && { echo "ya existe incoming/$ID.tar"; exit 1; }
    mkdir -p "$QA/rc"
    [ -e "$QA/rc/$ID.tar" ] && { echo "ya existe rc/$ID.tar (no se sobrescribe)"; exit 1; }
    ( cd "$ST" && tar -cf "$QA/rc/$ID.tar" . )
    ( cd "$QA/rc" && sha256sum "$ID.tar" | tee "$ID.tar.sha256" )
    echo "$ID" > $W/id
    echo "STAGED $ID (NO está en incoming/: no se puede desplegar por accidente)"
    ;;
  gate)
    ID=$(cat $W/id)
    G=$W/gate; rm -rf "$G"; mkdir -p "$G"
    ( cd "$QA/rc" && sha256sum -c "$ID.tar.sha256" )
    tar -xf "$QA/rc/$ID.tar" -C "$G"
    [ -f $W/test-fixtures.tar ] || { echo "falta $W/test-fixtures.tar (node scripts/ops/release-test-fixtures.mjs)"; exit 1; }
    set -a; . "$QA/secrets/qa.env"; set +a
    umask 077
    printf '%s\n' "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3027" "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3027" "NEXT_PUBLIC_SUPABASE_SAME_ORIGIN=1" "SUPABASE_INTERNAL_URL=http://vrqa_kong:8000" \
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=$QA_ANON_KEY" "SUPABASE_SERVICE_ROLE_KEY=$QA_SERVICE_KEY" "NEXT_PUBLIC_ADMIN=1" "ESPORTS_AUTO_SYNC_ENABLED=false" "SYNC_SECRET=rc-gate-not-production-000000000000000000" > $W/gate.env
    docker run --rm --name valorosters-pa-gate --user 1000:1000 --memory 8g --cpus 6 \
      --network valorosters-i18n-qa --env-file $W/gate.env \
      -e HOME=/tmp -e NEXT_TELEMETRY_DISABLED=1 -e NODE_OPTIONS=--max-old-space-size=6144 \
      -v "$G:/app" -v "$W/test-fixtures.tar:/fixtures.tar:ro" -w /app $IMG \
      bash -c 'npm ci --no-audit --no-fund && npx next build && npx tsc --noEmit --incremental false && npx eslint src && npx tsx scripts/i18n/audit.ts && tar -xf /fixtures.tar -C /app && npm test' > $W/gate.log 2>&1 < /dev/null \
      || { echo "GATE FALLIDA"; grep -E "^✖|error TS|Error:|failing|RESULTADO" $W/gate.log | head -30; tail -15 $W/gate.log; rm -f $W/gate.env; exit 1; }
    rm -f $W/gate.env
    GOT=$(cat "$G/.next/BUILD_ID")
    grep -E "^ℹ (tests|pass|fail)|problems|RESULTADO" $W/gate.log | tr '\n' ' '; echo
    # La build lleva la sala nueva y no lleva el walkout en la apertura (el chunk de /admin/walkout puede llevarlo).
    grep -rlq 'reveal-atmosphere' "$G/.next/static" && echo "BUILD_HAS_ATMOSPHERE_OK" || { echo "BUILD_SIN_SALA"; exit 1; }
    [ "$GOT" = "$ID" ] && echo "GATE_OK build + tsc (app) + eslint + i18n + tests · BUILD_ID $GOT" || { echo "BUILD_ID $GOT ≠ $ID"; exit 1; }
    ;;
esac
