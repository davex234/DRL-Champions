#!/usr/bin/env bash
# =============================================================================
# F87.1 · REGRESIÓN EN PRODUCCIÓN REPETIBLE (instrumento de operador, fuera de CI y fuera de la release).
# =============================================================================
#   bash scripts/ops/_f871-regression.sh setup              crea y prepara las personas QA (registro real, @example.invalid)
#   bash scripts/ops/_f871-regression.sh run <arnés…>       ejecuta arneses (smoke f812 f82 f83 f84 f85 f86 f861 f862 f87)
#   bash scripts/ops/_f871-regression.sh cleanup <N> [COMMIT] borra SOLO las QA de esta ejecución (por defecto ROLLBACK)
#
# Nada usa davex (#NB2Z9BM) ni ValoRosters (#H5ND8K7): los cargadores abortan si ven sus ids, y la cuenta personal
# borrada (#9KZAWPC) ya no es referencia de nada. Personas: A B C D E F G K L (QA = A, QG = G, QA_<x> = <x>);
# los arneses F82/F86.2 registran además las suyas (F82X, N1, N2…). Credenciales SOLO en el scratchpad.
# =============================================================================
set -uo pipefail
ROOT=/c/NEXUS-CENTRAL/DRLCards
W=${F871_QA_DIR:?falta F871_QA_DIR (directorio del scratchpad)}
ANON_FILE=${F871_ANON_FILE:?falta F871_ANON_FILE (clave anon PÚBLICA de producción)}
OUT=${F871_OUT:-$ROOT/docs/product/qa/pickems-2/f871/regression}
export QA_CREDS_DIR=$W/creds QA_SB=https://valorosters.com QA_ANON="$(tr -d '\r\n' < "$ANON_FILE")" QA_ANON_FILE="$ANON_FILE" BASE_URL=https://valorosters.com QA_PREFIX=${QA_PREFIX:-f871}
TSX="$ROOT/node_modules/.bin/tsx"
mkdir -p "$W/creds" "$W/cwd/docs/product/qa/fase67-production" "$W/cwd/docs/product/qa/pickems-2" "$OUT"
# cwd de los arneses: .env.local PÚBLICO (URL + anon pública) + tsconfig con los alias de la app.
printf 'NEXT_PUBLIC_SUPABASE_URL=https://valorosters.com\nNEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$QA_ANON" > "$W/cwd/.env.local"
printf '{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "baseUrl": "C:/NEXUS-CENTRAL/DRLCards", "paths": { "@/*": ["src/*"] }, "esModuleInterop": true, "skipLibCheck": true } }\n' > "$W/cwd/tsconfig.json"
PERSONAS="A B C D E F G K L"

case "${1:-}" in
  setup)
    date -u +%Y-%m-%dT%H:%M:%SZ > "$W/since.txt"
    ( cd "$ROOT" && "$TSX" scripts/_f87-qa-accounts.mts $PERSONAS ) || exit 1
    for p in $PERSONAS; do cp "$W/creds/$p.json" "$W/creds/QA_$p.json"; done
    cp "$W/creds/A.json" "$W/creds/QA.json"; cp "$W/creds/G.json" "$W/creds/QG.json"
    ( cd "$ROOT" && "$TSX" scripts/_f87-qa-prep.mts $PERSONAS ) || exit 1
    # F81.2 necesita un saldo distinto del de la demo (6.000): G compra un sobre como cualquier jugador.
    ( cd "$ROOT" && "$TSX" scripts/_f871-qa-spend.mts G ) || exit 1
    echo "SETUP_OK desde $(cat "$W/since.txt")" ;;
  run)
    shift
    for h in "$@"; do
      case "$h" in
        smoke) f=scripts/ops/smoke.ts ;; f812) f=scripts/_f812-prod-qa.mts ;; f82) f=scripts/_f82-prod-qa.mts ;;
        f83) f=scripts/_f83-prod-qa.mts ;; f84) f=scripts/_f84-prod-qa.mts ;; f85) f=scripts/_f85-prod-qa.mts ;;
        f86) f=scripts/_f86-prod-qa.mts ;; f861) f=scripts/_f861-prod-qa.mts ;; f862) f=scripts/_f862-alpha-e2e.mts ;;
        f87) f=scripts/_f87-prod-qa.mts ;; *) echo "arnés desconocido: $h"; exit 1 ;;
      esac
      echo "== $h · $(date -u +%H:%M:%SZ)"
      ( cd "$W/cwd" && F87_ANON_FILE="$ANON_FILE" F87_CREDS="$W/creds/f87.json" "$TSX" "$ROOT/$f" ) > "$OUT/$h.txt" 2>&1
      echo "$h exit=$? · PASS=$(grep -cE '^(PASS|OK) ' "$OUT/$h.txt") FAIL=$(grep -cE '^FAIL' "$OUT/$h.txt")"
    done ;;
  cleanup)
    N=${2:?número esperado de cuentas QA a borrar}; MODE=${3:-ROLLBACK}
    SINCE=$(cat "$W/since.txt")
    scp -q "$ROOT/scripts/ops/_f87-qa-cleanup.sql" nexusadmin@212.95.40.144:/tmp/f871/qa-cleanup.sql || exit 1
    ssh -o BatchMode=yes nexusadmin@212.95.40.144 "docker cp /tmp/f871/qa-cleanup.sql supabase_db_DRLCards:/tmp/qa-cleanup.sql >/dev/null && docker exec supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -v since=\"'$SINCE'\" -v expected=$N -v commit_or_rollback=$MODE -f /tmp/qa-cleanup.sql; rc=\$?; docker exec supabase_db_DRLCards rm -f /tmp/qa-cleanup.sql; exit \$rc" ;;
  *) echo "uso: setup | run <arnés…> | cleanup <N> [COMMIT]"; exit 1 ;;
esac
