#!/usr/bin/env bash
# =============================================================================
# TAG PÚBLICO · APLICAR 0068 EN PRODUCCIÓN — UNA vez, en UNA transacción, con huellas antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0068> bash /tmp/tag/_tag-apply-0068.sh'
# Se PARA sin tocar nada si: el fichero no es el revisado, la cabeza no es 0067 por estado real o ya hay rastro de 0068.
# Imprime solo recuentos, huellas y el TAG de la cuenta personal (público). Nunca UUID completos, correos ni secretos.
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/tag/0068_public_account_tag.sql
PERSONAL=2f86cbe8
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0067 por estado real, sin rastro de 0068"
[ "$(q "select to_regprocedure('public.app_admin_set_admin(uuid,uuid,boolean,text)') is not null and exists (select 1 from pg_trigger where tgname='profiles_admin_write_guard')")" = "t" ] || stop "0067 no está"
[ "$(q "select not exists (select 1 from information_schema.columns where table_name='profiles' and column_name='public_tag') and to_regclass('public.account_tag_registry') is null")" = "t" ] || stop "ya hay rastro de 0068"
TABLES="auth.users public.user_cards public.user_game public.game_state public.user_packs public.credit_transactions public.duel_pvp_ratings public.duel_pvp_rating_events public.competitive_season_players public.duel_friendships public.social_blocks public.duel_challenges public.duel_matches public.content_audit_log public.player_profile_customization public.user_cosmetics public.user_collection_completions public.game_seasons public.season_xp_ledger"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done
       printf 'profiles %s\n' "$(q "select count(*)||':'||md5(string_agg((to_jsonb(p) - 'public_tag')::text, '|' order by p.id)) from public.profiles p")"; }
fp > /tmp/tag/before.fp
PERSONAL_BEFORE=$(q "select md5((to_jsonb(p) - 'public_tag')::text) from public.profiles p where left(id::text,8)='$PERSONAL'")
ADMINS=$(q "select string_agg(left(id::text,8), ',' order by id) from public.profiles where is_admin")
N=$(q "select count(*) from public.profiles")
echo "perfiles: $N · admins: $ADMINS · huellas de $(wc -l < /tmp/tag/before.fp) tablas"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0068.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0068.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0068.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
fp > /tmp/tag/after.fp
if diff /tmp/tag/before.fp /tmp/tag/after.fp >/dev/null; then echo "DATOS_INTACTOS (todo igual salvo el tag; updated_at incluido)"; else diff /tmp/tag/before.fp /tmp/tag/after.fp | head; echo "AVISO_HUELLAS_DISTINTAS (actividad real durante el aplicado: revisar qué tabla)"; fi
echo "tags: $(q "select count(*)||' perfiles · nulos '||count(*) filter (where public_tag is null)||' · duplicados '||(count(*)-count(distinct public_tag))||' · formato inválido '||count(*) filter (where public_tag !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}\$') from public.profiles")"
echo "registro: $(q "select count(*) from public.account_tag_registry") filas (debe = $N)"
[ "$(q "select string_agg(left(id::text,8), ',' order by id) from public.profiles where is_admin")" = "$ADMINS" ] && echo "ADMINS_IGUALES" || stop "los admins cambiaron"
[ "$(q "select md5((to_jsonb(p) - 'public_tag')::text) from public.profiles p where left(id::text,8)='$PERSONAL'")" = "$PERSONAL_BEFORE" ] && echo "CUENTA_PERSONAL: solo recibe el tag (resto idéntico)" || stop "la cuenta personal cambió en algo más que el tag"
echo "TAG_CUENTA_PERSONAL=#$(q "select public_tag from public.profiles where left(id::text,8)='$PERSONAL'")"
PRIV=$(q "select has_column_privilege('authenticated','public.profiles','public_tag','SELECT')::text||has_column_privilege('authenticated','public.profiles','public_tag','UPDATE')::text||has_column_privilege('anon','public.profiles','public_tag','SELECT')::text||has_table_privilege('authenticated','public.account_tag_registry','select')::text||has_table_privilege('authenticated','public.account_tag_registry','insert')::text||has_table_privilege('anon','public.account_tag_registry','select')::text")
echo "privilegios de cliente (auth select/update tag, anon select tag, auth select/insert registro, anon select registro): $PRIV"
[ "$PRIV" = "falsefalsefalsefalsefalsefalse" ] || stop "privilegios de cliente inesperados"
echo "disparadores: $(q "select string_agg(tgname, ',' order by tgname) from pg_trigger where tgname like 'profiles_account_tag%' or tgname = 'account_tag_registry_append_only'")"
echo "F83 temporada-2: $(q "select status from public.game_seasons where id='temporada-2'")"
echo "APPLY_OK 0068"
