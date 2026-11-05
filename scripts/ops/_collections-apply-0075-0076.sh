#!/usr/bin/env bash
# =============================================================================
# COLECCIONES POR EQUIPO · 0075 + 0076 — comprobación, ensayo (BEGIN…ROLLBACK) y aplicado (UNA transacción por migración).
# =============================================================================
#   Producción (solo con autorización; se ejecuta EN EL VPS):
#     EXPECT_SHA_0075=<sha256> EXPECT_SHA_0076=<sha256> W=/tmp/tc-deploy bash _collections-apply-0075-0076.sh precheck
#     … ensayo            aplica 0075 y 0076 dentro de UNA transacción, verifica y hace ROLLBACK (no deja nada)
#     … aplicar-0075      aplica 0075 en una transacción y verifica
#     … aplicar-0076      aplica 0076 en una transacción y verifica (exige 0075)
#     … verificar         solo lectura: estado de las dos
#   Ensayo del propio guion fuera de producción: DB=<contenedor desechable> PGUSER=supabase_admin (ver
#   `_collections-migration-rehearsal.sh`, que lo ejecuta sobre una copia restaurada del backup).
#
# Mismo patrón que `_collection-apply-0074.sh`: se PARA sin tocar nada si un fichero no es el revisado, si ya hay rastro
# de la migración que se va a aplicar o si falta una dependencia. 0075 y 0076 no escriben ni una fila al aplicarse: las
# huellas de las tablas existentes deben quedar iguales. Imprime recuentos y huellas, nunca correos ni secretos.
# =============================================================================
set -uo pipefail
DB=${DB:-supabase_db_DRLCards}
DBNAME=${DBNAME:-postgres}
PGUSER=${PGUSER:-postgres}
W=${W:-/tmp/tc-deploy}
F75=${F75:-$W/0075_team_collections.sql}
F76=${F76:-$W/0076_team_identities_admin.sql}
MODE="${1:?precheck|ensayo|aplicar-0075|aplicar-0076|verificar}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U "$PGUSER" -d "$DBNAME" -X -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }
ok() { echo "OK $*"; }
check_eq() { [ "$2" = "$3" ] && ok "$1 ($2)" || stop "$1: esperado «$3», obtenido «$2»"; }

sha_check() {
  [ -n "${EXPECT_SHA_0075:-}" ] && [ -n "${EXPECT_SHA_0076:-}" ] || stop "faltan EXPECT_SHA_0075 / EXPECT_SHA_0076"
  check_eq "sha256 0075" "$(sha256sum "$F75" | cut -d' ' -f1)" "$EXPECT_SHA_0075"
  check_eq "sha256 0076" "$(sha256sum "$F76" | cut -d' ' -f1)" "$EXPECT_SHA_0076"
}

# Lo que 0075 y 0076 usan del esquema existente. Las funciones PL/pgSQL no comprueban sus llamadas al crearse: si una
# firma no existe, la migración se aplica y falla después, en la primera liquidación. Por eso se mira aquí.
deps() {
  check_eq "dependencia app_season_apply (0064)" "$(q "select to_regprocedure('public.app_season_apply(uuid,text,text,text,int,int,jsonb,jsonb)') is not null")" "t"
  check_eq "dependencia app_admin_audit (0055)" "$(q "select to_regprocedure('public.app_admin_audit(uuid,text,text,text,jsonb)') is not null")" "t"
  check_eq "dependencia game_seasons (0064)" "$(q "select to_regclass('public.game_seasons') is not null")" "t"
  check_eq "dependencia user_cosmetics PK (usuario, cosmético)" "$(q "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.user_cosmetics'::regclass and contype = 'p'")" "PRIMARY KEY (user_id, cosmetic_id)"
  check_eq "dependencia profiles.is_admin" "$(q "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_admin'")" "1"
  check_eq "dependencia content_audit_log (0055)" "$(q "select to_regclass('public.content_audit_log') is not null")" "t"
  check_eq "índice user_cards(user_id, card_id) (0011)" "$(q "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'user_cards_user_card_idx'")" "1"
}
has75() { q "select (to_regclass('public.user_team_completions') is not null)::int + (to_regclass('public.user_region_badges') is not null)::int + (to_regprocedure('public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)') is not null)::int"; }
has76() { q "select (to_regclass('public.content_team_identities') is not null)::int + (to_regprocedure('public.app_team_identity_save(uuid,text,text,text,text,text,int)') is not null)::int"; }

TABLES="auth.users public.profiles public.user_cards public.user_packs public.user_game public.duel_decks public.credit_transactions public.economy_ops public.user_cosmetics public.player_profile_customization public.game_seasons public.season_events public.season_xp_ledger public.season_progress public.user_collection_completions public.content_cards public.content_audit_log"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
fns() { q "select count(*)||':'||md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not in ('app_team_collections_settle', 'app_team_identity_save')"; }

# Verificación de una migración ya aplicada (o dentro de la transacción del ensayo). Una línea por comprobación.
VERIFY75=$(cat <<'SQL'
select 'v75 tablas=' || count(*) from pg_class where relname in ('user_team_completions', 'user_region_badges') and relnamespace = 'public'::regnamespace;
select 'v75 rls=' || count(*) filter (where relrowsecurity) from pg_class where relname in ('user_team_completions', 'user_region_badges') and relnamespace = 'public'::regnamespace;
select 'v75 politicas=' || count(*) from pg_policies where tablename in ('user_team_completions', 'user_region_badges');
select 'v75 clientes_tablas=' || coalesce(bool_or(has_table_privilege(r, t, 'SELECT') or has_table_privilege(r, t, 'INSERT') or has_table_privilege(r, t, 'UPDATE') or has_table_privilege(r, t, 'DELETE')), false)::text from unnest(array['anon','authenticated']) r, unnest(array['public.user_team_completions','public.user_region_badges']) t;
select 'v75 clientes_funcion=' || bool_or(has_function_privilege(r, 'public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)', 'EXECUTE'))::text from unnest(array['anon','authenticated']) r;
select 'v75 servidor_funcion=' || has_function_privilege('service_role', 'public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)', 'EXECUTE')::text;
select 'v75 definer=' || p.prosecdef::text || ' search_path=' || coalesce(array_to_string(p.proconfig, ','), '-') from pg_proc p where p.oid = 'public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)'::regprocedure;
select 'v75 pk=' || string_agg(pg_get_constraintdef(c.oid), ' ; ' order by pg_get_constraintdef(c.oid)) from pg_constraint c where c.contype = 'p' and c.conrelid in ('public.user_team_completions'::regclass, 'public.user_region_badges'::regclass);
select 'v75 filas=' || (select count(*) from public.user_team_completions) + (select count(*) from public.user_region_badges);
SQL
)
VERIFY76=$(cat <<'SQL'
select 'v76 tabla=' || count(*) from pg_class where relname = 'content_team_identities' and relnamespace = 'public'::regnamespace;
select 'v76 rls=' || relrowsecurity::text from pg_class where relname = 'content_team_identities' and relnamespace = 'public'::regnamespace;
select 'v76 politicas=' || count(*) from pg_policies where tablename = 'content_team_identities';
select 'v76 clientes_tabla=' || bool_or(has_table_privilege(r, 'public.content_team_identities', 'SELECT') or has_table_privilege(r, 'public.content_team_identities', 'INSERT'))::text from unnest(array['anon','authenticated']) r;
select 'v76 clientes_funcion=' || bool_or(has_function_privilege(r, 'public.app_team_identity_save(uuid,text,text,text,text,text,int)', 'EXECUTE'))::text from unnest(array['anon','authenticated']) r;
select 'v76 servidor_funcion=' || has_function_privilege('service_role', 'public.app_team_identity_save(uuid,text,text,text,text,text,int)', 'EXECUTE')::text;
select 'v76 definer=' || p.prosecdef::text || ' search_path=' || coalesce(array_to_string(p.proconfig, ','), '-') from pg_proc p where p.oid = 'public.app_team_identity_save(uuid,text,text,text,text,text,int)'::regprocedure;
select 'v76 filas=' || count(*) from public.content_team_identities;
SQL
)
expect75() {
  for want in "v75 tablas=2" "v75 rls=2" "v75 politicas=0" "v75 clientes_tablas=false" "v75 clientes_funcion=false" "v75 servidor_funcion=true" "v75 definer=true search_path=search_path=public" "v75 pk=PRIMARY KEY (user_id, region) ; PRIMARY KEY (user_id, team_id)" "v75 filas=0"; do
    echo "$1" | grep -qxF "$want" || stop "0075: falta «$want» (obtenido: $(echo "$1" | grep "^${want%%=*}="))"
  done; ok "0075 verificada (tablas, RLS sin políticas, permisos, SECURITY DEFINER + search_path, PK, 0 filas)"
}
expect76() {
  for want in "v76 tabla=1" "v76 rls=true" "v76 politicas=0" "v76 clientes_tabla=false" "v76 clientes_funcion=false" "v76 servidor_funcion=true" "v76 definer=true search_path=search_path=public" "v76 filas=0"; do
    echo "$1" | grep -qxF "$want" || stop "0076: falta «$want» (obtenido: $(echo "$1" | grep "^${want%%=*}="))"
  done; ok "0076 verificada (tabla, RLS sin políticas, permisos, SECURITY DEFINER + search_path, 0 filas)"
}
run_sql() { docker exec -i "$DB" psql -U "$PGUSER" -d "$DBNAME" -X -Atq -v ON_ERROR_STOP=1 "$@" 2>&1; }
copy_in() { docker cp "$F75" "$DB:/tmp/0075.sql" >/dev/null && docker cp "$F76" "$DB:/tmp/0076.sql" >/dev/null || stop "docker cp"; }
copy_out() { docker exec "$DB" rm -f /tmp/0075.sql /tmp/0076.sql </dev/null; }

case "$MODE" in
  precheck|verificar)
    [ "$MODE" = precheck ] && sha_check
    deps
    echo "estado: 0075 $(has75)/3 objetos · 0076 $(has76)/2 objetos"
    echo "cuentas $(q "select count(*) from public.profiles") · cartas $(q "select count(*) from public.user_cards") · temporadas $(q "select coalesce(string_agg(id || ':' || status, ','), '-') from public.game_seasons")"
    [ "$(has75)" = 3 ] && expect75 "$(echo "$VERIFY75" | run_sql)"
    [ "$(has76)" = 2 ] && expect76 "$(echo "$VERIFY76" | run_sql)"
    echo "${MODE^^}_OK"
    ;;
  ensayo)
    sha_check; deps
    check_eq "sin rastro de 0075" "$(has75)" "0"; check_eq "sin rastro de 0076" "$(has76)" "0"
    fp > "$W/ensayo-before.fp"; F0=$(fns)
    copy_in
    OUT=$( { echo "begin;"; echo '\i /tmp/0075.sql'; echo '\i /tmp/0076.sql'; echo "$VERIFY75"; echo "$VERIFY76"; echo "rollback;"; } | run_sql ); RC=$?
    copy_out
    [ "$RC" = 0 ] || { echo "$OUT" | tail -8; stop "el ensayo falló (nada quedó aplicado)"; }
    expect75 "$OUT"; expect76 "$OUT"
    check_eq "tras el ensayo, sin rastro de 0075" "$(has75)" "0"; check_eq "tras el ensayo, sin rastro de 0076" "$(has76)" "0"
    fp > "$W/ensayo-after.fp"
    diff "$W/ensayo-before.fp" "$W/ensayo-after.fp" > /dev/null && ok "DATOS_INTACTOS ($(wc -l < "$W/ensayo-before.fp") tablas)" || { diff "$W/ensayo-before.fp" "$W/ensayo-after.fp" | head; stop "huellas distintas tras el ensayo"; }
    check_eq "funciones anteriores intactas" "$(fns)" "$F0"
    echo "ENSAYO_OK 0075+0076 (ROLLBACK)"
    ;;
  aplicar-0075|aplicar-0076)
    sha_check; deps
    N=${MODE#aplicar-}
    if [ "$N" = 0075 ]; then check_eq "sin rastro de 0075" "$(has75)" "0"; check_eq "sin rastro de 0076" "$(has76)" "0"
    else check_eq "0075 aplicada antes" "$(has75)" "3"; check_eq "sin rastro de 0076" "$(has76)" "0"; fi
    fp > "$W/$N-before.fp"; F0=$(fns); T_BEFORE=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)
    copy_in
    T0=$(date +%s%N); OUT=$(run_sql -1 -f "/tmp/$N.sql"); RC=$?; T1=$(date +%s%N)
    copy_out
    echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    [ "$RC" = 0 ] || { echo "$OUT" | tail -8; stop "la transacción de $N falló y se revirtió entera: NO se improvisa nada"; }
    fp > "$W/$N-after.fp"
    if diff "$W/$N-before.fp" "$W/$N-after.fp" > /dev/null; then ok "DATOS_INTACTOS ($N no cambió ninguna fila)"; else
      diff "$W/$N-before.fp" "$W/$N-after.fp" | head; echo "AVISO_HUELLAS_DISTINTAS — actividad real durante el aplicado (revisar):"
      q "select 'libro', left(user_id::text, 8), reason, count(*) from public.credit_transactions where created_at >= '$T_BEFORE' group by 2, 3"
    fi
    check_eq "funciones anteriores intactas" "$(fns)" "$F0"
    if [ "$N" = 0075 ]; then expect75 "$(echo "$VERIFY75" | run_sql)"; else expect76 "$(echo "$VERIFY76" | run_sql)"; fi
    run_sql -c "notify pgrst, 'reload schema'" > /dev/null && ok "recarga de la caché de esquema de PostgREST pedida"
    echo "APPLY_OK $N"
    ;;
  *) stop "modo desconocido";;
esac
