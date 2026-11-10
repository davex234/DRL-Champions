#!/usr/bin/env bash
# =============================================================================
# PACK OPENING 3.1 · STAGING = fuente de PRODUCCIÓN (drl-0.1.1-1-af7250fa) + overlay (sin migración).
# =============================================================================
#   ssh nexusadmin@VPS 'bash /tmp/pack31/_pack31-stage.sh'   (con /tmp/pack31/pack31-overlay.tar y /tmp/pack31/deleted.txt (vacío))
# Demuestra la frontera: lo que cambia respecto a la base es EXACTAMENTE el overlay + los borrados; los ficheros de F78
# siguen siendo los de producción. Calcula el BUILD_ID con el next.config de la fuente y deja incoming/<id>.tar.
# =============================================================================
set -euo pipefail
V=/opt/nexus/projects/valorosters
BASE=${PACK31_BASE:-drl-0.1.1-1-af7250fa}   # la release viva (Pack Opening 3.0)
W=/tmp/pack31
ST=$W/stage
rm -rf "$ST"; mkdir -p "$ST"
cd "$V/releases/$BASE"
tar --exclude=./node_modules --exclude=./.next --exclude=./tsconfig.tsbuildinfo --exclude=./next-env.d.ts -cf - . | tar -xf - -C "$ST"
( cd "$ST" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > $W/base.sha
tar -xf $W/pack31-overlay.tar -C "$ST"
while read -r f; do [ -n "$f" ] && rm -f "$ST/$f"; done < $W/deleted.txt
( cd "$ST" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > $W/staged.sha
echo "base files: $(wc -l < $W/base.sha) · staged files: $(wc -l < $W/staged.sha)"
names() { sed 's/^[0-9a-f]*  \.\///' "$1" | sort; }
comm -13 <(names $W/base.sha) <(names $W/staged.sha) > $W/added.txt
comm -23 <(names $W/base.sha) <(names $W/staged.sha) > $W/removed.txt
join -j2 -o 1.1,1.2,2.1 <(sort -k2 $W/base.sha) <(sort -k2 $W/staged.sha) | awk '$1 != $3 {print $2}' | sed 's/^\.\///' | sort > $W/modified.txt
echo "added=$(wc -l < $W/added.txt) modified=$(wc -l < $W/modified.txt) removed=$(wc -l < $W/removed.txt)"
tar -tf $W/pack31-overlay.tar | sort > $W/overlay.txt
cat $W/added.txt $W/modified.txt | sort > $W/changed.txt
diff -q $W/changed.txt $W/overlay.txt >/dev/null && echo "BOUNDARY_OK añadidos+modificados = overlay PACK OPENING 3.1 exacto" || { echo "BOUNDARY_FAIL"; diff $W/changed.txt $W/overlay.txt | head; exit 1; }
diff -q $W/removed.txt <(sort $W/deleted.txt) >/dev/null && echo "BOUNDARY_OK borrados = lista PACK OPENING 3.1 exacta (ninguno)" || { echo "BOUNDARY_FAIL borrados"; exit 1; }
for f in scripts/ops/backup-drlcards.sh scripts/ops/backup-offsite.sh scripts/ops/backup-status.sh scripts/ops/offsite-harness.sh scripts/ops/offsite-drill.sh scripts/ops/b2-provision.mjs scripts/ops/production-check.ts src/domain/ops/backup.test.ts src/domain/ops/backup.ts; do
  if [ -f "$V/releases/$BASE/$f" ]; then
    a=$(sha256sum "$V/releases/$BASE/$f" | cut -d' ' -f1); b=$(sha256sum "$ST/$f" | cut -d' ' -f1)
    [ "$a" = "$b" ] && echo "F78 = producción: $f" || { echo "F78 LEAK: $f"; exit 1; }
  else
    [ ! -e "$ST/$f" ] && echo "F78 ausente en producción y en el staging: $f" || { echo "F78 LEAK (nuevo): $f"; exit 1; }
  fi
done
ID=$(docker run --rm -v "$ST:/app:ro" -w /app node:24.15.0-bookworm-slim node --input-type=module -e "const m = await import('/app/next.config.mjs'); console.log(await m.default.generateBuildId())")
echo "BUILD_ID=$ID"
[ -e "$V/releases/$ID" ] && { echo "ya existe releases/$ID"; exit 1; }
( cd "$ST" && tar -cf "$V/incoming/$ID.tar" . )
sha256sum "$V/incoming/$ID.tar"
echo "STAGED $ID"
