#!/usr/bin/env bash
# =============================================================================
# COLECCIONES POR EQUIPO · RELEASE CANDIDATA (2026-10-13) — PREPARA, NO DESPLIEGA.
# =============================================================================
#   ssh nexusadmin@VPS 'bash /tmp/tc-rc/_team-collections-rc-stage.sh stage'   fuente de PRODUCCIÓN (solo lectura) + overlay →
#                                                                              frontera, F78 intacto, BUILD_ID, tar de la RC
#   ssh nexusadmin@VPS 'bash /tmp/tc-rc/_team-collections-rc-stage.sh gate'    npm ci + next build + tsc + tests de esa fuente
#                                                                              en un contenedor desechable, con el entorno
#                                                                              del STACK DE QA (ni secretos ni red de producción)
#
# Es `_collection-rc-stage.sh` con otra base (la release viva, 4b1f4c01), otra carpeta de trabajo y la migración que
# trae esta candidata: 0075 (aditiva; sin ella el servidor solo deja de guardar compleciones e insignias). Necesita $W/overlay.tar y $W/overlay.txt (lista exacta del commit de la
# funcionalidad). No escribe en `incoming/`, `releases/` ni `current`, no toca valorosters-app ni la base de producción.
# =============================================================================
set -euo pipefail
V=/opt/nexus/projects/valorosters
QA=/opt/nexus/projects/valorosters-i18n-qa
BASE=${RC_BASE:-drl-0.1.1-1-4b1f4c01}
W=${RC_WORK:-/tmp/tc-rc}
ST=$W/stage
IMG=node:24.15.0-bookworm-slim
case "${1:?stage|gate}" in
  stage)
    [ "$(readlink "$V/current")" = "releases/$BASE" ] || { echo "ABORT: la release viva ya no es $BASE ($(readlink "$V/current"))"; exit 2; }
    rm -rf "$ST"; mkdir -p "$ST"
    ( cd "$V/releases/$BASE" && tar --exclude=./node_modules --exclude=./.next --exclude=./tsconfig.tsbuildinfo --exclude=./next-env.d.ts --exclude='./.env*' -cf - . ) | tar -xf - -C "$ST"
    ( cd "$ST" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > $W/base.sha
    tar -xf $W/overlay.tar -C "$ST"
    # Ficheros que la candidata RETIRA (lista exacta en $W/deleted.txt; vacía o ausente = ninguno).
    touch $W/deleted.txt
    while IFS= read -r f; do [ -n "$f" ] && rm -f "$ST/$f"; done < $W/deleted.txt
    ( cd "$ST" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > $W/staged.sha
    names() { sed 's/^[0-9a-f]*  \.\///' "$1" | sort; }
    comm -13 <(names $W/base.sha) <(names $W/staged.sha) > $W/added.txt
    comm -23 <(names $W/base.sha) <(names $W/staged.sha) > $W/removed.txt
    join -j2 -o 1.1,1.2,2.1 <(sort -k2 $W/base.sha) <(sort -k2 $W/staged.sha) | awk '$1 != $3 {print $2}' | sed 's/^\.\///' | sort > $W/modified.txt
    echo "base $(wc -l < $W/base.sha) · staged $(wc -l < $W/staged.sha) · añadidos $(wc -l < $W/added.txt) · modificados $(wc -l < $W/modified.txt) · borrados $(wc -l < $W/removed.txt)"
    cat $W/added.txt $W/modified.txt | sort > $W/changed.txt
    diff -q $W/changed.txt <(sort $W/overlay.txt) >/dev/null && echo "BOUNDARY_OK añadidos+modificados = overlay exacto" || { echo "BOUNDARY_FAIL"; diff $W/changed.txt <(sort $W/overlay.txt) | head; exit 1; }
    diff -q $W/removed.txt <(sort $W/deleted.txt) >/dev/null && echo "BOUNDARY_OK borrados = lista exacta ($(wc -l < $W/removed.txt)): $(tr '
' ' ' < $W/removed.txt)" || { echo "BOUNDARY_FAIL borrados"; diff $W/removed.txt <(sort $W/deleted.txt) | head; exit 1; }
    for f in scripts/ops/backup-drlcards.sh scripts/ops/backup-offsite.sh scripts/ops/backup-status.sh scripts/ops/backup-cron.sh scripts/ops/backup-schedule.sh scripts/ops/offsite-harness.sh scripts/ops/offsite-drill.sh scripts/ops/b2-provision.mjs scripts/ops/restore-drill.sh src/instrumentation.ts src/domain/ops/backup.ts; do
      if [ -f "$V/releases/$BASE/$f" ]; then
        [ "$(sha256sum < "$V/releases/$BASE/$f")" = "$(sha256sum < "$ST/$f")" ] && echo "F78 = producción: $f" || { echo "F78 LEAK: $f"; exit 1; }
      else
        [ ! -e "$ST/$f" ] && echo "F78 ausente en producción y en la RC: $f" || { echo "F78 LEAK (nuevo): $f"; exit 1; }
      fi
    done
    # Una sola migración nueva y aditiva: 0075. Las anteriores, byte a byte las de producción (ya lo garantiza la frontera).
    [ "$(ls "$ST/supabase/migrations" | sort | tail -1)" = "0075_team_collections.sql" ] && [ "$(grep -c '^supabase/migrations/' $W/added.txt)" = "1" ] && ! grep -q '^supabase/migrations/' $W/modified.txt       && echo "MIGRATIONS_OK cabeza 0075 (una migración nueva, ninguna anterior modificada)" || { echo "MIGRATIONS_FAIL"; exit 1; }
    ! grep -v '^\s*--' "$ST/supabase/migrations/0075_team_collections.sql" | grep -E -i "drop (table|column|function|index)|truncate|delete from|alter table public\.(profiles|user_cards|user_packs|credit_transactions)|insert into public\.(profiles|user_cards|user_packs|credit_transactions)"       && echo "MIGRATION_ADDITIVE_OK 0075 no borra nada ni toca créditos, cartas o sobres" || { echo "MIGRATION_NOT_ADDITIVE"; exit 1; }
    [ -f "$ST/docs/operations/rollback/0075_team_collections.ROLLBACK.sql" ] && echo "ROLLBACK_PRESENTE" || { echo "falta el rollback de 0075"; exit 1; }
    # Nada de economía: precios, probabilidades, pools, recetas, desguace y sobres, byte a byte los de producción.
    ! grep -E '^src/(data/(packs|recipes|storeCatalog|packStats)|domain/(economy|packs|crafting|forge)/|pack/|server/services/(economy|packs|crafting|forge|inventory|userCards)\.ts)' $W/changed.txt       && echo "ECONOMY_OK el overlay no toca economía, sobres ni lectura de inventario" || { echo "ECONOMY_TOUCHED"; exit 1; }
    ID=$(docker run --rm -v "$ST:/app:ro" -w /app $IMG node --input-type=module -e "const m = await import('/app/next.config.mjs'); console.log(await m.default.generateBuildId())")
    echo "BUILD_ID=$ID"
    [ -e "$V/releases/$ID" ] && { echo "ya existe releases/$ID"; exit 1; }
    mkdir -p "$QA/rc"
    ( cd "$ST" && tar -cf "$QA/rc/$ID.tar" . )
    ( cd "$QA/rc" && sha256sum "$ID.tar" | tee "$ID.tar.sha256" )
    echo "$ID" > $W/id
    echo "STAGED $ID (NO está en incoming/: no se puede desplegar por accidente)"
    ;;
  gate)
    ID=$(cat $W/id)
    G=$W/gate; rm -rf "$G"; mkdir -p "$G"
    tar -xf "$QA/rc/$ID.tar" -C "$G"
    set -a; . "$QA/secrets/qa.env"; set +a
    umask 077
    printf '%s\n' "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3027" "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3027" "NEXT_PUBLIC_SUPABASE_SAME_ORIGIN=1" "SUPABASE_INTERNAL_URL=http://vrqa_kong:8000" \
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=$QA_ANON_KEY" "SUPABASE_SERVICE_ROLE_KEY=$QA_SERVICE_KEY" "NEXT_PUBLIC_ADMIN=1" "ESPORTS_AUTO_SYNC_ENABLED=false" "SYNC_SECRET=rc-gate-not-production-000000000000000000" > $W/gate.env
    docker run --rm --name valorosters-tc-gate --user 1000:1000 --memory 8g --cpus 6 \
      --network valorosters-i18n-qa --env-file $W/gate.env \
      -e HOME=/tmp -e NEXT_TELEMETRY_DISABLED=1 -e NODE_OPTIONS=--max-old-space-size=6144 \
      -v "$G:/app" -w /app $IMG \
      bash -c 'npm ci --no-audit --no-fund && npx next build && npx tsc --noEmit --incremental false && npm test' > $W/gate.log 2>&1 < /dev/null \
      || { echo "GATE FALLIDA"; grep -E "^✖|error TS|Error:|failing" $W/gate.log | head -30; tail -15 $W/gate.log; rm -f $W/gate.env; exit 1; }
    rm -f $W/gate.env
    GOT=$(cat "$G/.next/BUILD_ID")
    grep -E "^ℹ (tests|pass|fail)" $W/gate.log | tr '\n' ' '; echo
    [ "$GOT" = "$ID" ] && echo "GATE_OK build + typecheck + tests · BUILD_ID $GOT" || { echo "BUILD_ID $GOT ≠ $ID"; exit 1; }
    ;;
esac
