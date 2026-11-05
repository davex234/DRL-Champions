#!/usr/bin/env bash
# =============================================================================
# 0076 · IDENTIDAD DE EQUIPOS NUEVOS DESDE EL PANEL — ENSAYO EN LA BASE DE QA (se ejecuta en el VPS; nunca toca producción)
# =============================================================================
#   team-collections-0076.sh apply      aplica 0076 en UNA transacción; comprueba que no cambia ninguna fila ni función anterior
#   team-collections-0076.sh sqltest    la función contra Postgres real (BEGIN … ROLLBACK: no deja nada)
#   team-collections-0076.sh rollback   ejecuta el ROLLBACK: archivo de la tabla, nada perdido, segundo intento rechazado
#   team-collections-0076.sh restore    vuelve a aplicar 0076 y devuelve las filas archivadas
#
# Necesita en $W: 0076_team_identities_admin.sql, 0076_team_identities_admin.ROLLBACK.sql y
# team-collections-0076.sqltest.sql. Solo usa el contenedor vrqa_db y cuentas `coll-tc*@example.invalid`.
# Haz antes `team-collections-0075.sh backup` (la copia de la base de QA sirve para las dos).
# =============================================================================
set -uo pipefail
W=${RC_WORK:-/tmp/tc-rc}
psqlq() { docker exec -i vrqa_db psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 "$@"; }
q() { psqlq -c "$1" < /dev/null; }
fail=0
ok() { echo "OK    $*"; }
ko() { echo "FALLO $*"; fail=1; }
eq() { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else ko "$1: esperado «$3», obtenido «$2»"; fi; }
TABLES="auth.users public.profiles public.user_cards public.user_packs public.credit_transactions public.content_cards public.content_players public.assets public.user_team_completions public.user_region_badges public.content_audit_log"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }

case "${1:?apply|sqltest|rollback|restore}" in
  apply)
    [ "$(q "select to_regclass('public.content_team_identities') is null and to_regprocedure('public.app_team_identity_save(uuid,text,text,text,text,text,int)') is null")" = "t" ] || { echo "APPLY_STOP ya hay rastro de 0076"; exit 1; }
    fp > "$W/0076-before.fp"
    FNS=$(q "select md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")
    T0=$(date +%s%N)
    psqlq -1 -q -f - < "$W/0076_team_identities_admin.sql" || { echo "APPLY_FAIL (la transacción se revirtió entera)"; exit 1; }
    echo "aplicada en $(( ($(date +%s%N) - T0) / 1000000 )) ms"
    q "insert into public._qa_migrations (name) values ('0076_team_identities_admin.sql') on conflict do nothing; notify pgrst, 'reload schema'" > /dev/null
    sleep 2
    fp > "$W/0076-after.fp"
    diff "$W/0076-before.fp" "$W/0076-after.fp" > /dev/null && ok "DATOS_INTACTOS: 0076 no cambió ninguna fila de $(wc -l < "$W/0076-before.fp") tablas" || { ko "huellas distintas tras aplicar"; diff "$W/0076-before.fp" "$W/0076-after.fp" | head; }
    eq "funciones anteriores intactas" "$(q "select md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'app_team_identity_save'")" "$FNS"
    eq "tabla nueva vacía" "$(q "select count(*) from public.content_team_identities")" "0"
    eq "RLS activada" "$(q "select relrowsecurity::text from pg_class where relname = 'content_team_identities'")" "true"
    eq "sin políticas (solo servidor)" "$(q "select count(*) from pg_policies where tablename = 'content_team_identities'")" "0"
    [ "$fail" = 0 ] && echo "APPLY_OK 0076" || echo "APPLY_CON_FALLOS"
    ;;
  sqltest)
    BEFORE=$(fp)
    psqlq < "$W/team-collections-0076.sqltest.sql" 2>&1 | tee "$W/0076-sqltest.out"
    grep -q "^SQLTEST_0076_OK" "$W/0076-sqltest.out" && ok "función: permisos, admin, alta, conflicto, clave inmutable, clave única, validación y auditoría" || ko "sqltest 0076"
    [ "$(fp)" = "$BEFORE" ] && ok "tras el ROLLBACK la base está exactamente igual" || ko "el sqltest dejó rastro"
    [ "$fail" = 0 ] && echo "SQLTEST_OK 0076" || echo "SQLTEST_CON_FALLOS"
    ;;
  rollback)
    BEFORE=$(q "select count(*) from public.content_team_identities")
    psqlq -q -f - < "$W/0076_team_identities_admin.ROLLBACK.sql" || { echo "ROLLBACK_FAIL"; exit 1; }
    q "delete from public._qa_migrations where name = '0076_team_identities_admin.sql'; notify pgrst, 'reload schema'" > /dev/null; sleep 2
    eq "función y tabla retiradas" "$(q "select (to_regprocedure('public.app_team_identity_save(uuid,text,text,text,text,text,int)') is null)::text || (to_regclass('public.content_team_identities') is null)::text")" "truetrue"
    eq "archivo con TODAS las filas" "$(q "select count(*) from public.ops_rollback_0076_content_team_identities")" "$BEFORE"
    eq "el archivo no es legible por clientes" "$(q "select bool_or(has_table_privilege(r, 'public.ops_rollback_0076_content_team_identities', 'SELECT'))::text from unnest(array['anon','authenticated']) r")" "false"
    if psqlq -q -f - < "$W/0076_team_identities_admin.ROLLBACK.sql" > "$W/0076-rb-second.out" 2>&1; then ko "un segundo rollback no se rechazó"; else ok "segundo rollback rechazado sin tocar nada"; fi
    [ "$fail" = 0 ] && echo "ROLLBACK_OK 0076" || echo "ROLLBACK_CON_FALLOS"
    ;;
  restore)
    [ "$(q "select to_regclass('public.ops_rollback_0076_content_team_identities') is not null")" = "t" ] || { echo "no hay archivo que restaurar"; exit 1; }
    ARCH=$(q "select count(*) from public.ops_rollback_0076_content_team_identities")
    psqlq -1 -q -f - < "$W/0076_team_identities_admin.sql" || { echo "REAPPLY_FAIL"; exit 1; }
    q "begin;
       insert into public.content_team_identities (printed_team, team_id, name, tag, region, rev, created_at, created_by, updated_at, updated_by)
         select printed_team, team_id, name, tag, region, rev, created_at, created_by, updated_at, updated_by from public.ops_rollback_0076_content_team_identities;
       drop table public.ops_rollback_0076_content_team_identities;
       insert into public._qa_migrations (name) values ('0076_team_identities_admin.sql') on conflict do nothing;
       commit; notify pgrst, 'reload schema'" > /dev/null; sleep 2
    eq "filas devueltas" "$(q "select count(*) from public.content_team_identities")" "$ARCH"
    [ "$fail" = 0 ] && echo "RESTORE_OK 0076" || echo "RESTORE_CON_FALLOS"
    ;;
esac
exit "$fail"
