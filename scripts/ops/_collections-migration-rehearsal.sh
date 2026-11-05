#!/usr/bin/env bash
# =============================================================================
# 0075 + 0076 · ENSAYO COMPLETO SOBRE UNA COPIA RESTAURADA DE PRODUCCIÓN (se ejecuta en el VPS; NUNCA toca producción).
# =============================================================================
#   SRC=/opt/nexus/backups/supabase-drlcards/<unidad COMPLETE de backup-drlcards.sh> W=/tmp/tc-deploy \
#     EXPECT_SHA_0075=… EXPECT_SHA_0076=… bash _collections-migration-rehearsal.sh
#
# Restaura el backup en un Postgres DESECHABLE con la misma imagen que producción, `--network none` (los mismos pasos
# que `restore-drill.sh`), y sobre ESA copia ejecuta el guion real de despliegue (`_collections-apply-0075-0076.sh`) y
# los escenarios que no se pueden probar en el stack de QA:
#   1 precheck + ensayo (BEGIN…ROLLBACK) · 2 aplicar 0075 · 3 0076 FALLA a mitad (fallo inyectado): 0075 sigue, 0076 sin
#   rastro, datos iguales · 4 aplicar 0076 · 5 funcional con cuentas y esquema reales (ROLLBACK) · 6 rollback de 0076 y
#   0075 CON datos: archivo completo, XP e insignias concedidos intactos, tablas anteriores iguales · 7 restaurar el
#   archivo: filas devueltas y nadie cobra dos veces.
# El contenedor se borra siempre (trap). En W necesita: las dos migraciones, sus ROLLBACK, el guion de aplicado,
# `_collections-rehearsal.functional.sql` y `tc-0075-vars.sql`.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"; W=${W:-/tmp/tc-deploy}
PROD_CONTAINER=supabase_db_DRLCards
NAME="drlcards-migration-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)"
fail() { echo "REHEARSAL_FAIL $*"; exit 1; }
ok() { echo "OK $*"; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
[ -f "$SRC/COMPLETE" ] || fail "backup sin COMPLETE"
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || fail "SHA256SUMS no cuadra"
IMAGE=$(docker inspect "$PROD_CONTAINER" --format '{{.Config.Image}}')
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" "$IMAGE" >/dev/null </dev/null || fail "no arranca"
streak=0; for i in $(seq 1 120); do
  if docker logs "$NAME" 2>&1 | grep -q "init process complete" && docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select 1" </dev/null >/dev/null 2>&1; then streak=$((streak+1)); [ $streak -ge 3 ] && break; else streak=0; fi; sleep 2
done
[ $streak -ge 3 ] || fail "Postgres no quedó listo"
docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -Atqc "drop schema if exists auth cascade; drop schema if exists storage cascade;" </dev/null >/dev/null || fail "auth/storage"
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --no-owner < "$SRC/db.dump" > "$W/rehearsal-restore.log" 2>&1 || true
mism=0; while IFS=$'\t' read -r t e; do
  if [ "$t" = auth.users ]; then s="select count(*) from auth.users"; else s="select count(*) from public.$t"; fi
  [ "$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "$s" </dev/null)" = "$e" ] || mism=$((mism+1))
done < "$SRC/table-counts.tsv"
[ $mism = 0 ] && ok "copia restaurada: $(wc -l < "$SRC/table-counts.tsv") tablas con los recuentos del backup" || fail "$mism tablas no cuadran"

A() { DB="$NAME" PGUSER=supabase_admin W="$W" bash "$W/_collections-apply-0075-0076.sh" "$@"; }
sq() { docker exec -i "$NAME" psql -U supabase_admin -d postgres -X -Atq -v ON_ERROR_STOP=1 "$@" 2>&1; }
has() { sq -c "select (to_regclass('public.user_team_completions') is not null)::int + (to_regclass('public.user_region_badges') is not null)::int + (to_regprocedure('public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)') is not null)::int || '/' || (to_regclass('public.content_team_identities') is not null)::int + (to_regprocedure('public.app_team_identity_save(uuid,text,text,text,text,text,int)') is not null)::int" </dev/null; }
TABLES="auth.users public.profiles public.user_cards public.user_packs public.user_game public.duel_decks public.credit_transactions public.economy_ops public.user_cosmetics public.player_profile_customization public.game_seasons public.season_events public.season_xp_ledger public.season_progress public.user_collection_completions public.content_cards public.content_audit_log"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(sq -c "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t" </dev/null)"; done; }
fp > "$W/r-0.fp"

echo "##### 1 · precheck + ensayo"
A precheck | tail -3; [ "${PIPESTATUS[0]}" = 0 ] || fail "precheck"
A ensayo | grep -E "^(OK DATOS|ENSAYO_OK|APPLY_STOP)" ; [ "${PIPESTATUS[0]}" = 0 ] || fail "ensayo"

echo "##### 2 · aplicar 0075"
A aplicar-0075 | grep -E "^(OK DATOS|OK 0075|APPLY_OK|APPLY_STOP|exit=)" ; [ "${PIPESTATUS[0]}" = 0 ] || fail "aplicar 0075"

echo "##### 3 · 0076 falla a mitad (fallo inyectado al final de su transacción)"
{ cat "$W/0076_team_identities_admin.sql"; echo "select 1/0; -- fallo inyectado por el ensayo"; } > "$W/0076-broken.sql"
docker cp "$W/0076-broken.sql" "$NAME:/tmp/0076-broken.sql" >/dev/null
if sq -1 -f /tmp/0076-broken.sql > "$W/0076-broken.out"; then fail "el 0076 roto no falló"; fi
[ "$(has)" = "3/0" ] && ok "tras el fallo: 0075 entera (3/3), 0076 sin rastro (0/2)" || fail "estado tras el fallo: $(has)"
fp > "$W/r-3.fp"; diff -q "$W/r-0.fp" "$W/r-3.fp" >/dev/null && ok "datos de las tablas anteriores idénticos" || fail "huellas distintas tras el fallo"
A verificar | grep -E "^(OK 0075|VERIFICAR_OK|APPLY_STOP)"

echo "##### 4 · aplicar 0076"
A aplicar-0076 | grep -E "^(OK DATOS|OK 0076|APPLY_OK|APPLY_STOP|exit=)" ; [ "${PIPESTATUS[0]}" = 0 ] || fail "aplicar 0076"

echo "##### 5 · funcional con el esquema y las cuentas reales (ROLLBACK)"
docker cp "$W/_collections-rehearsal.functional.sql" "$NAME:/tmp/functional.sql" >/dev/null
{ cat "$W/tc-0075-vars.sql"; echo '\i /tmp/functional.sql'; } | sq > "$W/functional.out"; grep -E "OK|FALLO|ERROR|FUNCTIONAL" "$W/functional.out" | sed 's/^NOTICE:  //'
grep -q "^FUNCTIONAL_OK" "$W/functional.out" || fail "funcional"
fp > "$W/r-5.fp"; diff -q "$W/r-0.fp" "$W/r-5.fp" >/dev/null && ok "tras el funcional (ROLLBACK) los datos siguen idénticos" || fail "el funcional dejó rastro"

echo "##### 6 · rollback de 0076 y de 0075 con datos guardados"
U=$(sq -c "select id from public.profiles order by id limit 1" </dev/null); ADM=$(sq -c "select id from public.profiles where is_admin order by id limit 1" </dev/null)
{ cat "$W/tc-0075-vars.sql"; cat <<SQL
begin;
set local session_replication_role = replica;
insert into public.game_seasons (id, number, name, description, status, starts_at, ends_at, claim_until, max_level, config, checksum, published_at)
values ('qa-rehearsal-season', 902, 'QA-REHEARSAL', 'QA-REHEARSAL', 'PUBLISHED', now() - interval '1 day', now() + interval '20 days', now() + interval '25 days', :season_levels, :'season_config'::jsonb, 'qa', now());
set local session_replication_role = origin;
insert into public.user_cards (uid, user_id, card_id, origin, locked, obtained_at)
select gen_random_uuid(), '$U', c, 'pack', false, now() from jsonb_array_elements_text(:'plan_china'::jsonb -> 0 -> 'cards') c;
select public.app_team_collections_settle('$U', :'plan_china_team'::jsonb, :'plan_china'::jsonb, 'qa-rehearsal-season', 300);
select public.app_team_identity_save('$ADM', 'QA Ensayo', 'qa-ensayo', 'QA Ensayo', 'QAE', 'EMEA', 0);
commit;
SQL
} | sq > /dev/null || fail "no se pudieron guardar datos de prueba"
KEEP=$(sq -c "select (select count(*) || ':' || coalesce(sum(amount), 0) from public.season_xp_ledger) || '|' || (select count(*) from public.user_cosmetics where cosmetic_id like 'insignia:regional:%')" </dev/null)
ROWS=$(sq -c "select (select count(*) from public.user_team_completions) || ':' || (select count(*) from public.user_region_badges) || ':' || (select count(*) from public.content_team_identities)" </dev/null)
echo "   guardado antes del rollback: compleciones:insignias:identidades = $ROWS · libro de XP y cosméticos regionales = $KEEP"
FP6=$( for t in public.user_cards public.profiles public.credit_transactions public.season_xp_ledger public.user_cosmetics public.content_cards; do printf '%s %s\n' "$t" "$(sq -c "select count(*)||':'||md5(string_agg(t::text, '|' order by t::text)) from $t t" </dev/null)"; done )
for f in 0076_team_identities_admin 0075_team_collections; do docker cp "$W/$f.ROLLBACK.sql" "$NAME:/tmp/$f.rb.sql" >/dev/null; sq -f "/tmp/$f.rb.sql" > /dev/null || fail "rollback $f"; done
[ "$(has)" = "0/0" ] && ok "rollback: funciones y tablas nuevas retiradas" || fail "tras el rollback: $(has)"
ARCH=$(sq -c "select (select count(*) from public.ops_rollback_0075_user_team_completions) || ':' || (select count(*) from public.ops_rollback_0075_user_region_badges) || ':' || (select count(*) from public.ops_rollback_0076_content_team_identities)" </dev/null)
[ "$ARCH" = "$ROWS" ] && ok "archivo completo: $ARCH" || fail "archivo $ARCH ≠ $ROWS"
[ "$(sq -c "select (select count(*) || ':' || coalesce(sum(amount), 0) from public.season_xp_ledger) || '|' || (select count(*) from public.user_cosmetics where cosmetic_id like 'insignia:regional:%')" </dev/null)" = "$KEEP" ] && ok "XP concedidos e insignias del jugador intactos ($KEEP)" || fail "el rollback tocó XP o cosméticos"
FP6B=$( for t in public.user_cards public.profiles public.credit_transactions public.season_xp_ledger public.user_cosmetics public.content_cards; do printf '%s %s\n' "$t" "$(sq -c "select count(*)||':'||md5(string_agg(t::text, '|' order by t::text)) from $t t" </dev/null)"; done )
[ "$FP6" = "$FP6B" ] && ok "cartas, perfiles, créditos, libro de XP, cosméticos y catálogo idénticos tras el rollback" || fail "el rollback cambió datos existentes"
if sq -f "/tmp/0075_team_collections.rb.sql" > /dev/null 2>&1; then fail "un segundo rollback no se rechazó"; else ok "segundo rollback rechazado (no pisa el archivo)"; fi

echo "##### 7 · restaurar: volver a aplicar y devolver el archivo; nadie cobra dos veces"
for f in 0075_team_collections 0076_team_identities_admin; do docker cp "$W/$f.sql" "$NAME:/tmp/$f.sql" >/dev/null; sq -1 -f "/tmp/$f.sql" > /dev/null || fail "reaplicar $f"; done
sq > /dev/null <<'SQL' || fail "restaurar archivo"
begin;
insert into public.user_team_completions (user_id, team_id, completed_at, cards, xp_amount, xp_season_id, xp_granted_at) select user_id, team_id, completed_at, cards, xp_amount, xp_season_id, xp_granted_at from public.ops_rollback_0075_user_team_completions;
insert into public.user_region_badges (user_id, region, unlocked_at, teams, cards) select user_id, region, unlocked_at, teams, cards from public.ops_rollback_0075_user_region_badges;
insert into public.content_team_identities (printed_team, team_id, name, tag, region, rev, created_at, created_by, updated_at, updated_by) select printed_team, team_id, name, tag, region, rev, created_at, created_by, updated_at, updated_by from public.ops_rollback_0076_content_team_identities;
drop table public.ops_rollback_0075_user_team_completions; drop table public.ops_rollback_0075_user_region_badges; drop table public.ops_rollback_0076_content_team_identities;
commit;
SQL
[ "$(sq -c "select (select count(*) from public.user_team_completions) || ':' || (select count(*) from public.user_region_badges) || ':' || (select count(*) from public.content_team_identities)" </dev/null)" = "$ROWS" ] && ok "filas devueltas ($ROWS)" || fail "restauración incompleta"
R=$({ cat "$W/tc-0075-vars.sql"; echo "select public.app_team_collections_settle('$U', :'plan_china_team'::jsonb, :'plan_china'::jsonb, 'qa-rehearsal-season', 300)->>'xpGained';"; } | sq)
[ "$R" = 0 ] && ok "tras restaurar, liquidar de nuevo concede 0 XP" || fail "restaurar permitió cobrar $R"
echo "REHEARSAL_OK $NAME (contenedor borrado al salir)"
