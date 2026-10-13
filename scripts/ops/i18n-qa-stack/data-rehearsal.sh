#!/usr/bin/env bash
# =============================================================================
# ICON · ENSAYO DE LOS PASOS DE DATOS en una base AISLADA (2026-10-11). Se ejecuta en el VPS.
# =============================================================================
#   data-rehearsal.sh prepare   base `vr_rehearsal` dentro del Postgres del stack de QA (vrqa_db): esquema = las 73
#                               migraciones del repo (copiado del stack de QA) + CONTENIDO real de producción, leído con
#                               pg_dump --data-only de 6 tablas de contenido (ninguna de usuarios). Producción: solo lectura.
#   data-rehearsal.sh run       ejecuta /tmp/icon-rehearsal/sql/*.sql en el orden del plan y deja el acta en out/
#   data-rehearsal.sh drop      borra la base de ensayo
# No escribe en producción. No toca la base `postgres` del stack de QA.
# =============================================================================
set -uo pipefail
W=/tmp/icon-rehearsal
DB=vr_rehearsal
PROD=supabase_db_DRLCards
QA=vrqa_db
TABLES="content_cards content_pools content_pool_entries content_pack_pools content_distribution_version craft_recipes"
q() { docker exec -i $QA psql -U "${2:-postgres}" -d $DB -X -At -v ON_ERROR_STOP=1 -c "$1"; }
state() {
  q "select 'receta', id, input_qty, version, name, status from craft_recipes where id = 'pack-champions-icon'"
  q "select 'otras recetas md5', md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) from craft_recipes c where c.id <> 'pack-champions-icon'"
  q "select 'auditoría receta', count(*) from content_audit_log where entity_type = 'craft_recipe' and entity_id = 'pack-champions-icon'"
  q "select 'pool', id, lifecycle, mode, (select count(*) from content_pool_entries e where e.pool_id = p.id) from content_pools p where id = 'pack-icon-single'"
  q "select 'vínculos icon-single', coalesce(string_agg(pool_id || '@' || priority || ':' || enabled, ','), '(ninguno)') from content_pack_pools where pack_id = 'icon-single'"
  q "select 'otros pools md5', md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) from content_pools p where p.id <> 'pack-icon-single'"
  q "select 'otras entradas md5', md5(coalesce(string_agg(pool_id || ':' || card_id || ':' || weight || ':' || mode, '|' order by pool_id, card_id), '')), count(*) from content_pool_entries where pool_id <> 'pack-icon-single'"
  q "select 'otros vínculos md5', md5(coalesce(string_agg(to_jsonb(b)::text, '|' order by b.pack_id, b.pool_id), '')) from content_pack_pools b where b.pack_id <> 'icon-single'"
  q "select 'versión de distribución', version from content_distribution_version"
  q "select 'cartas', count(*), md5(string_agg(card_id, ',' order by card_id)) from content_cards"
}
case "${1:?prepare|run|drop}" in
  prepare)
    set -e
    mkdir -p $W/out
    docker exec $PROD pg_dump -U postgres -d postgres --data-only --no-owner $(for t in $TABLES; do printf -- '-t public.%s ' "$t"; done) > $W/prod-content.sql
    echo "volcado de contenido de producción (solo lectura): $(wc -c < $W/prod-content.sql) bytes · tablas: $TABLES"
    docker exec $QA psql -U supabase_admin -d postgres -X -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
    docker exec $QA pg_dump -U supabase_admin -d postgres -s 2> $W/out/schema-dump.err | docker exec -i $QA psql -U supabase_admin -d $DB -X -q > $W/out/schema-load.log 2>&1 || true
    echo "errores al cargar el esquema: $(grep -c '^ERROR' $W/out/schema-load.log || true) (extensiones/esquemas de plataforma; se comprueba public abajo)"
    { echo "SET session_replication_role = replica;"; echo "TRUNCATE $(echo $TABLES | sed 's/ /, /g') CASCADE;"; cat $W/prod-content.sql; } | docker exec -i $QA psql -U supabase_admin -d $DB -X -q -v ON_ERROR_STOP=1 > $W/out/data-load.log 2>&1
    echo "funciones del pool: $(q "select count(*) from pg_proc where proname in ('app_content_pool_upsert','app_content_pool_set_entries','app_content_pack_bind','app_content_pool_publish')")/4"
    echo "ESTADO INICIAL (= producción):"; state
    ;;
  run)
    : > $W/out/acta.txt
    for step in ${PLAN:?PLAN="recipe recipe-commit …"}; do
      {
        echo; echo "================ $step ================"
        docker exec -i $QA psql -U postgres -d $DB -X -v ON_ERROR_STOP=1 < $W/sql/$step.sql 2>&1 | grep -vE '^(BEGIN|SET|SELECT [0-9]+|INSERT 0 [0-9]+|UPDATE [0-9]+|DO|ROLLBACK|COMMIT)$' | cut -c1-240
        echo "--- exit=${PIPESTATUS[0]} · estado tras $step:"
        state
      } >> $W/out/acta.txt 2>&1
    done
    cat $W/out/acta.txt
    ;;
  drop)
    docker exec $QA psql -U supabase_admin -d postgres -X -q -c "DROP DATABASE IF EXISTS $DB" && echo "DROPPED $DB"
    ;;
esac
