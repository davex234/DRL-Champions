#!/usr/bin/env bash
# =============================================================================
# F82 · DRY-RUN de 0062 + CARRERAS REALES en Postgres + ROLLBACK — sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   (desde el PC)  scp 0062_collection_sets.sql 0062_collection_sets.ROLLBACK.sql g2req.json _f82-dryrun.sh nexusadmin@VPS:/tmp/f82/
#                  ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0062/<TS> bash /tmp/f82/_f82-dryrun.sh'
#
# 1. Postgres DESECHABLE (misma imagen que producción, `--network none`) restaurado del backup pre-0062.
# 2. Huellas de las tablas de jugadores/economía/catálogo antes y después de 0062 (0062 no toca ningún dato existente).
# 3. Carreras con usuarios SINTÉTICOS (solo en la copia) y procesos psql EN PARALELO de verdad:
#      A  20 reclamos simultáneos del mismo usuario (doble clic + dos pestañas + reintentos) → 1 compleción, 1 insignia
#      B  retirar el set mientras 10 usuarios reclaman → nadie queda con compleción a medias; tras el retiro, RETIRED
#      C  10 «destacar insignias» con la MISMA versión → exactamente 1 SAVED
#      D  reclamar mientras se desguaza la carta que lo completa → o COMPLETED con su carta, o INCOMPLETE; nunca otra cosa
# 4. Compatibilidad: `player_profile_set` (0049, app anterior) sigue funcionando con la columna nueva.
# 5. Rollback operativo (fichero) → tablas/RPC fuera → 0062 se vuelve a aplicar limpia.
# Salida: PASS/FAIL y `DRYRUN_OK` / `DRYRUN_FAIL`. El contenedor se borra pase lo que pase.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f82-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }

[ -f "$SRC/COMPLETE" ] || { echo "DRYRUN_FAIL backup no COMPLETE"; exit 1; }
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || { echo "DRYRUN_FAIL SHA256SUMS"; exit 1; }
IMAGE=$(docker inspect "$PROD" --format '{{.Config.Image}}')
PASSW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PASSW" "$IMAGE" >/dev/null </dev/null || { echo "DRYRUN_FAIL arranque"; exit 1; }
ok=0; streak=0
for i in $(seq 1 120); do
  if docker logs "$NAME" 2>&1 | grep -q "init process complete" && docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "select 1" </dev/null >/dev/null 2>&1; then
    streak=$((streak+1)); [ "$streak" -ge 3 ] && { ok=1; break; }
  else streak=0; fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "DRYRUN_FAIL postgres no listo"; exit 1; }
docker exec "$NAME" psql -U supabase_admin -d postgres -Atqc "drop schema if exists auth cascade; drop schema if exists storage cascade;" </dev/null >/dev/null
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --no-owner < "$SRC/db.dump" > /tmp/$NAME.restore.log 2>&1 || true
docker cp "$DIR/0062_collection_sets.sql" "$NAME:/tmp/0062.sql" >/dev/null
docker cp "$DIR/0062_collection_sets.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0061: forge_config existe" "$(P "select to_regclass('public.forge_config') is not null")" "t"
check "copia en 0061: sin collection_sets" "$(P "select to_regclass('public.collection_sets') is null")" "t"

TABLES="auth.users public.profiles public.user_cards public.user_packs public.user_game public.user_pass public.economy_ops public.credit_transactions public.craft_recipes public.content_cards public.content_card_versions public.content_pools public.content_pool_entries public.agents public.content_packs public.duel_decks public.user_card_favorites public.user_cosmetics public.user_achievements public.content_audit_log public.duel_pvp_ratings public.duel_matches public.forge_config"
fingerprint() {
  for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done
  printf '%s %s\n' "ppc(0049 cols)" "$(P "select count(*)||':'||coalesce(md5(string_agg(user_id::text||showcase_card_uids::text||featured_achievement_ids::text||version, '|' order by user_id)),'-') from public.player_profile_customization")"
}
fingerprint > /tmp/$NAME.before
echo "== huellas antes: $(wc -l < /tmp/$NAME.before) tablas"

T0=$(date +%s%N)
APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0062.sql </dev/null 2>&1); RC=$?
check "0062 aplica en UNA transacción (exit)" "$RC" "0"
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms · $(echo "$APPLY" | grep -c ERROR) errores"
fingerprint > /tmp/$NAME.after
check "0062 no cambia NINGÚN dato existente (huellas)" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || echo distintas)" "iguales"
check "privilegios: anon/authenticated sin nada" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) where has_table_privilege(n,'public.collection_sets','select') or has_table_privilege(n,'public.user_collection_completions','select') or has_function_privilege(n,'public.app_collection_claim(uuid,text)','execute') or has_function_privilege(n,'public.player_profile_set_badges(uuid,text[],int)','execute')")" "0"

# ─────────────── set real (G2) y usuarios sintéticos ───────────────
REQ=$(cat "$DIR/g2req.json")
P "insert into public.collection_sets (id,family,version,kind,subject_id,title,requirements,reward,logo) values ('team-g2-v1','team:g2',1,'TEAM','g2','G2','$REQ'::jsonb,'{\"badgeId\":\"insignia:coleccion:team-g2\"}','/hints/teams/g2.png')" >/dev/null
P "update public.collection_sets set status='PUBLISHED', checksum='dryrun', published_at=now() where id='team-g2-v1'" >/dev/null
check "set G2 publicado" "$(P "select status from public.collection_sets where id='team-g2-v1'")" "PUBLISHED"
CARDS=$(P "select string_agg(quote_literal(e->'cardIds'->>0), ',') from jsonb_array_elements('$REQ'::jsonb) e")
newuser() { local u; u=$(P "select gen_random_uuid()"); P "insert into auth.users (id,email,aud,role,instance_id) values ('$u','f82dry-$u@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')" >/dev/null; echo "$u"; }
givefull() { P "insert into public.user_cards (user_id, card_id, origin) select '$1', c, 'admin' from unnest(array[$CARDS]) c" >/dev/null; }
claim() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_collection_claim('$1','team-g2-v1')->>'code'" </dev/null 2>&1; }

# A · 20 reclamos simultáneos del mismo usuario
UA=$(newuser); givefull "$UA"
for i in $(seq 1 20); do claim "$UA" > /tmp/$NAME.a.$i & done; wait
check "A · exactamente 1 COMPLETED de 20" "$(cat /tmp/$NAME.a.* | grep -c '^COMPLETED$')" "1"
check "A · los otros 19 = ALREADY" "$(cat /tmp/$NAME.a.* | grep -c '^ALREADY$')" "19"
check "A · 1 compleción" "$(P "select count(*) from public.user_collection_completions where user_id='$UA'")" "1"
check "A · 1 insignia" "$(P "select count(*) from public.user_cosmetics where user_id='$UA' and cosmetic_id='insignia:coleccion:team-g2'")" "1"
check "A · satisfied_by guarda 5 requisitos" "$(P "select count(*) from public.user_collection_completions c, jsonb_object_keys(c.satisfied_by) where user_id='$UA'")" "5"

# D · reclamar mientras se desguaza la carta que lo completa
UD=$(newuser); givefull "$UD"
LAST=$(P "select e->'cardIds'->>0 from jsonb_array_elements('$REQ'::jsonb) e limit 1")
( claim "$UD" > /tmp/$NAME.d.claim ) & ( P "delete from public.user_cards where user_id='$UD' and card_id='$LAST'" >/dev/null ) & wait
DC=$(cat /tmp/$NAME.d.claim); DN=$(P "select count(*) from public.user_collection_completions where user_id='$UD'")
if { [ "$DC" = "COMPLETED" ] && [ "$DN" = "1" ]; } || { [ "$DC" = "INCOMPLETE" ] && [ "$DN" = "0" ]; }; then pass "D · reclamo vs desguace coherente ($DC, compleciones=$DN)"; else fail "D · incoherente ($DC, $DN)"; fi
check "D · insignia sí ⇔ compleción sí" "$(P "select count(*) from public.user_cosmetics where user_id='$UD'")" "$DN"

# B · retirar mientras 10 usuarios reclaman
USERS=""; for i in $(seq 1 10); do u=$(newuser); givefull "$u"; USERS="$USERS $u"; done
i=0; for u in $USERS; do i=$((i+1)); claim "$u" > /tmp/$NAME.b.$i & done
( P "update public.collection_sets set status='RETIRED', retired_at=now() where id='team-g2-v1'" > /tmp/$NAME.b.retire ) &
wait
B_DONE=$(cat /tmp/$NAME.b.[0-9]* | grep -c '^COMPLETED$'); B_RET=$(cat /tmp/$NAME.b.[0-9]* | grep -c '^RETIRED$')
check "B · cada reclamo es COMPLETED o RETIRED" "$((B_DONE + B_RET))" "10"
check "B · compleciones = COMPLETED informados" "$(P "select count(*) from public.user_collection_completions where user_id in ($(for u in $USERS; do printf "'%s'," "$u"; done | sed 's/,$//'))")" "$B_DONE"
check "B · insignias = compleciones" "$(P "select count(*) from public.user_cosmetics where cosmetic_id='insignia:coleccion:team-g2' and user_id in ($(for u in $USERS; do printf "'%s'," "$u"; done | sed 's/,$//'))")" "$B_DONE"
check "B · set retirado" "$(P "select status from public.collection_sets where id='team-g2-v1'")" "RETIRED"
UL=$(newuser); givefull "$UL"
check "B · tras retirar, un usuario nuevo recibe RETIRED" "$(claim "$UL")" "RETIRED"
check "B · el que ya lo tenía sigue ALREADY" "$(claim "$UA")" "ALREADY"
check "B · retirado inmutable (requisitos)" "$(P "update public.collection_sets set requirements='[]' where id='team-g2-v1'" 2>&1 | grep -c COLLECTION_SET_IMMUTABLE)" "1"

# C · 10 «destacar» simultáneos con la misma versión
VER=$(P "select coalesce((select version from public.player_profile_customization where user_id='$UA'),0)")
P "insert into public.player_profile_customization (user_id) values ('$UA') on conflict do nothing" >/dev/null
VER=$(P "select version from public.player_profile_customization where user_id='$UA'")
for i in $(seq 1 10); do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.player_profile_set_badges('$UA', array['insignia:coleccion:team-g2'], $VER)->>'code'" </dev/null > /tmp/$NAME.c.$i 2>&1 & done; wait
check "C · exactamente 1 SAVED de 10" "$(cat /tmp/$NAME.c.* | grep -c '^SAVED$')" "1"
check "C · el resto UNCHANGED/CONFLICT" "$(cat /tmp/$NAME.c.* | grep -cE '^(UNCHANGED|CONFLICT)$')" "9"
check "C · insignia de otro = LOCKED" "$(P "select public.player_profile_set_badges('$UL', array['insignia:coleccion:team-g2'], null)->>'code'")" "LOCKED"

# 4 · compatibilidad con la app anterior (0049)
check "0049 player_profile_set sigue funcionando" "$(P "select public.player_profile_set('$UA', null, array[]::text[], null)->>'code'")" "UNCHANGED"
check "0049 conserva las insignias destacadas" "$(P "select featured_badge_ids::text from public.player_profile_customization where user_id='$UA'")" "{insignia:coleccion:team-g2}"

# 5 · rollback y re-aplicación
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/rollback.sql </dev/null 2>&1); RC=$?
check "rollback (exit)" "$RC" "0"
check "rollback: sin tablas ni RPC de 0062" "$(P "select (to_regclass('public.collection_sets') is null and to_regclass('public.user_collection_completions') is null and to_regprocedure('public.app_collection_claim(uuid,text)') is null and to_regprocedure('public.player_profile_set_badges(uuid,text[],int)') is null)::text")" "true"
check "rollback: 0049 intacta" "$(P "select public.player_profile_set('$UA', null, array[]::text[], null)->>'code'")" "UNCHANGED"
RA=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0062.sql </dev/null 2>&1); RC=$?
check "re-aplicar 0062 tras rollback (exit)" "$RC" "0"

if [ "$FAILS" = 0 ]; then echo "DRYRUN_OK"; else echo "DRYRUN_FAIL ($FAILS)"; fi
