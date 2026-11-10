#!/usr/bin/env bash
# =============================================================================
# F79.1 · DRY-RUN de 0061 + CONCURRENCIA REAL en Postgres + ROLLBACK — sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   (desde el PC)  scp -r <dir con 0061.sql, rollback.sql y este script> nexusadmin@VPS:/tmp/f791/
#                  ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0061/<TS> bash /tmp/f791/_f79-1-dryrun.sh'
#
# 1. Postgres DESECHABLE con la MISMA imagen que producción, `--network none`, restaurado del backup pre-0061.
# 2. Huellas (md5 de cada fila) de las tablas de jugadores, libro mayor, crafteo, misiones, admin y catálogo.
# 3. 0060 → 0061 en UNA transacción; huellas idénticas después; guardia y comprobaciones de permisos/contenido.
# 4. Carreras A–I con usuarios SINTÉTICOS (solo en la copia), procesos psql en paralelo de verdad.
# 5. Rollback operativo (fichero) → la app anterior sigue funcionando → 0061 se vuelve a aplicar.
# Salida: líneas PASS/FAIL y `DRYRUN_OK` / `DRYRUN_FAIL`. El contenedor se borra pase lo que pase.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f791-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
# Una RPC: imprime el JSON o «ERR:<mensaje>».
R() { local out; out=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1); if [ $? -eq 0 ]; then echo "$out"; else echo "ERR:$(echo "$out" | grep -o 'ERROR: .*' | head -1)"; fi; }

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
docker cp "$DIR/0061_forge_progression.sql" "$NAME:/tmp/0061.sql" >/dev/null
docker cp "$DIR/0061_forge_progression.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

# ─────────────── 1. ESTADO 0060 de la copia ───────────────
check "copia en 0060: sin forge_config" "$(P "select to_regclass('public.forge_config') is null")" "t"
check "copia en 0060: sin RPC guardadas" "$(P "select count(*) from pg_proc where proname in ('app_craft_card_guarded','app_salvage_cards_guarded')")" "0"
check "copia en 0060: app_craft_card = cuerpo 0059" "$(P "select md5(prosrc) from pg_proc where oid='public.app_craft_card(uuid, text, uuid[], jsonb, text, text)'::regprocedure")" "63c5e91e98149ffdc9213ea32bfab4cc"
SALV_MD5=$(P "select md5(prosrc) from pg_proc where oid='public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure")

TABLES="auth.users public.profiles public.user_cards public.user_packs public.user_game public.user_pass public.economy_ops public.credit_transactions public.craft_recipes public.content_missions public.content_card_projects public.user_mission_progress public.user_project_claims public.mission_events public.content_cards public.content_card_versions public.agents public.content_packs public.duel_decks public.user_card_favorites public.player_profile_customization public.content_audit_log public.user_sanctions public.duel_pvp_ratings public.duel_matches public.user_achievements"
fingerprint() { for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
fingerprint > /tmp/$NAME.before
echo "== huellas antes: $(wc -l < /tmp/$NAME.before) tablas"

# ─────────────── 2. 0060 → 0061 ───────────────
T0=$(date +%s%N)
APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0061.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
check "0061 aplica en UNA transacción (exit)" "$RC" "0"
echo "   (aplicación: $(( (T1-T0)/1000000 )) ms)"
[ "$RC" = 0 ] || echo "$APPLY" | tail -5
fingerprint > /tmp/$NAME.after
if cmp -s /tmp/$NAME.before /tmp/$NAME.after; then pass "datos INTACTOS: huellas idénticas en $(wc -l < /tmp/$NAME.after) tablas (usuarios, inventario, libro mayor, crafteo, misiones, admin, catálogo)"; else fail "huellas cambiaron: $(diff /tmp/$NAME.before /tmp/$NAME.after | tr '\n' ' ' | head -c 400)"; fi
check "forge_config existe y VACÍA (nada publicado)" "$(P "select count(*) from public.forge_config")" "0"
check "forge_config con RLS" "$(P "select relrowsecurity from pg_class where oid='public.forge_config'::regclass")" "t"
check "anon/authenticated sin acceso a forge_config" "$(P "select has_table_privilege('anon','public.forge_config','select') or has_table_privilege('authenticated','public.forge_config','select') or has_table_privilege('authenticated','public.forge_config','insert')")" "f"
check "service_role lee/escribe forge_config" "$(P "select has_table_privilege('service_role','public.forge_config','select') and has_table_privilege('service_role','public.forge_config','update')")" "t"
check "RPC guardadas: solo service_role" "$(P "select has_function_privilege('service_role','public.app_craft_card_guarded(uuid,text,uuid[],jsonb,text,text,uuid[])','execute') and not has_function_privilege('authenticated','public.app_craft_card_guarded(uuid,text,uuid[],jsonb,text,text,uuid[])','execute') and not has_function_privilege('anon','public.app_salvage_cards_guarded(uuid,uuid[],bigint,text,uuid[])','execute') and has_function_privilege('service_role','public.app_salvage_cards_guarded(uuid,uuid[],bigint,text,uuid[])','execute')")" "t"
check "ayudantes internos no invocables (ni service_role)" "$(P "select has_function_privilege('service_role','public._card_consume_guard(uuid,uuid[],uuid[])','execute') or has_function_privilege('authenticated','public._card_consume_lock(uuid)','execute')")" "f"
check "0060 intacta (cuerpo del desguace sin cambios)" "$(P "select md5(prosrc) from pg_proc where oid='public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure")" "$SALV_MD5"
check "ninguna receta forge-… (contenido nuevo = 0)" "$(P "select count(*) from public.craft_recipes where id like 'forge-%'")" "0"
check "economía de recetas congelada" "$(P "select string_agg(id||':'||status||':'||input_qty, ' ' order by sort_order) from public.craft_recipes")" "pack-estandar-premium:ACTIVE:4 pack-premium-oro:ACTIVE:2 pack-oro-masters:ACTIVE:2 pack-masters-champions:ACTIVE:3 pack-champions-icon:ACTIVE:2 card-base-plata:ACTIVE:7 card-plata-oro:ACTIVE:3 card-oro-masters:ACTIVE:8 card-masters-champions:ACTIVE:14 card-champions-prime:ACTIVE:10 card-prime-icon:DISABLED:5"
REAPPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0061.sql </dev/null 2>&1); check "0061 es idempotente (segunda aplicación)" "$?" "0"

# ─────────────── 3. CARRERAS en Postgres real ───────────────
X=$(P "select card_id from public.content_cards order by card_id limit 1 offset 10")
Y=$(P "select card_id from public.content_cards order by card_id limit 1 offset 11")
OUT=$(P "select card_id from public.content_cards order by card_id limit 1 offset 200")
N=0
# El contador vive en un FICHERO: `U=$(newuser)` corre en un subshell y una variable no sobreviviría (todos serían el mismo).
newuser() { N=$(( $(cat /tmp/$NAME.n 2>/dev/null || echo 0) + 1 )); echo "$N" > /tmp/$NAME.n; local id; id=$(printf 'f7910000-0000-4000-8000-%012d' "$N"); P "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values ('$id','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f791-$N@example.invalid','',now(),now())" >/dev/null; echo "$id"; }
give() { P "insert into public.user_cards (user_id, card_id, serial, origin) select '$1','$2',null,'pack' from generate_series(1,$3)" >/dev/null; }
uids() { P "select string_agg(uid::text, ',' order by uid) from (select uid from public.user_cards where user_id='$1' and card_id='$2' order by uid offset ${3:-0} limit $4) s"; }
arr() { echo "array[$(echo "$1" | sed "s/\([^,]*\)/'\1'::uuid/g")]"; }
exp() { echo "jsonb_build_object($(echo "$1" | tr ',' '\n' | sed "s/.*/'&','$2'/" | paste -sd, -))"; }
craftnc() { echo "select public.app_craft_card_guarded('$1','card-plata-oro',$(arr "$2"),$(exp "$2" "$X"),'$OUT','$3','{}'::uuid[])"; }
salv() { echo "select public.app_salvage_cards_guarded('$1',$(arr "$2"),5,'$3','{}'::uuid[])"; }
cnt() { P "select count(*) from public.user_cards where user_id='$1' and card_id='$2'"; }
ops() { P "select count(*) from public.economy_ops where user_id='$1' and kind='$2'"; }
par() { local i=0; for q in "$@"; do R "$q" > /tmp/$NAME.p$i & i=$((i+1)); done; wait; }
res() { cat /tmp/$NAME.p$1; }
echo "== carreras (X=$X Y=$Y OUT=$OUT)"
[ -n "$X" ] && [ -n "$OUT" ] && P "select count(*) from public.content_cards where card_id in ('$X','$Y','$OUT')" | grep -qx 3 || { echo "DRYRUN_FAIL cartas de prueba no válidas"; exit 1; }

# A · receta de UNA vez desde dos peticiones a la vez (clave «once» común, material para dos)
U=$(newuser); give "$U" "$X" 9
A1=$(uids "$U" "$X" 0 3); A2=$(uids "$U" "$X" 3 3)
par "$(craftnc "$U" "$A1" "craft:card:$U:once:forge-ruta-oro")" "$(craftnc "$U" "$A2" "craft:card:$U:once:forge-ruta-oro")"
check "A · una sola forja en el libro mayor" "$(ops "$U" craft_card)" "1"
check "A · un solo consumo (9 − 3 = 6)" "$(cnt "$U" "$X")" "6"
check "A · una sola carta de salida" "$(cnt "$U" "$OUT")" "1"
check "A · la otra petición recibe el MISMO resultado (repeated)" "$( (res 0; res 1) | grep -c '"repeated": true')" "1"
check "A · las dos ven la misma carta" "$( (res 0; res 1) | grep -o '"outputs": \[[^]]*' | sort -u | wc -l)" "1"

# B · forja repetible a la vez: (1) material para las dos → las dos; (2) 6 pestañas sobre las MISMAS 3 copias → 1
U=$(newuser); give "$U" "$X" 9
B1=$(uids "$U" "$X" 0 3); B2=$(uids "$U" "$X" 3 3)
par "$(craftnc "$U" "$B1" "b-$U-1")" "$(craftnc "$U" "$B2" "b-$U-2")"
check "B1 · dos forjas legítimas" "$(ops "$U" craft_card)/$(cnt "$U" "$X")/$(cnt "$U" "$OUT")" "2/3/2"
U=$(newuser); give "$U" "$X" 4
B3=$(uids "$U" "$X" 0 3)
par "$(craftnc "$U" "$B3" "b6-$U-1")" "$(craftnc "$U" "$B3" "b6-$U-2")" "$(craftnc "$U" "$B3" "b6-$U-3")" "$(craftnc "$U" "$B3" "b6-$U-4")" "$(craftnc "$U" "$B3" "b6-$U-5")" "$(craftnc "$U" "$B3" "b6-$U-6")"
check "B2 · 6 a la vez con material para 1 → 1 forja, nunca negativo" "$(ops "$U" craft_card)/$(cnt "$U" "$X")" "1/1"
check "B2 · los perdedores fallan por inventario (NOT_ELIGIBLE), sin errores raros" "$(for i in 0 1 2 3 4 5; do res $i; done | grep -c 'NOT_ELIGIBLE')" "5"

# C · forja + desguace sobre las mismas copias
U=$(newuser); give "$U" "$X" 4
C3=$(uids "$U" "$X" 0 3); C4=$(uids "$U" "$X" 2 2)
CR0=$(P "select coalesce(credits,0) from public.profiles where id='$U'")
par "$(craftnc "$U" "$C3" "c-$U-craft")" "$(salv "$U" "$C4" "c-$U-salv")"
LEFT=$(cnt "$U" "$X"); OPS=$(( $(ops "$U" craft_card) + $(ops "$U" salvage) ))
check "C · gana UNA (forja o desguace)" "$OPS" "1"
[ "$LEFT" -ge 1 ] && pass "C · nunca 0 copias ($LEFT)" || fail "C · quedaron $LEFT copias"
CRP=$(P "select coalesce(credits,0) - $CR0 from public.profiles where id='$U'"); SALV=$(ops "$U" salvage)
check "C · créditos coherentes con lo aplicado (5 × desguaces)" "$CRP" "$((5*SALV))"

# D · forja (Forja) + intercambio F73 (ambos guardados) sobre las mismas copias
U=$(newuser); give "$U" "$X" 4
D3=$(uids "$U" "$X" 0 3)
par "$(craftnc "$U" "$D3" "d-$U-forge")" "$(craftnc "$U" "$D3" "d-$U-exchange")"
check "D · una sola operación, 1 copia de X y 1 salida" "$(ops "$U" craft_card)/$(cnt "$U" "$X")/$(cnt "$U" "$OUT")" "1/1/1"

# E · dos intercambios sobre las mismas copias: uno por la RPC guardada y otro por la ANTIGUA (app ya desplegada)
U=$(newuser); give "$U" "$X" 4
E3=$(uids "$U" "$X" 0 3)
par "$(craftnc "$U" "$E3" "e-$U-new")" "select public.app_craft_card('$U','card-plata-oro',$(arr "$E3"),$(exp "$E3" "$X"),'$OUT','e-$U-old')"
check "E · nueva + antigua a la vez → una sola, 1 copia de X" "$(ops "$U" craft_card)/$(cnt "$U" "$X")" "1/1"

# F · última copia: dos desguaces de copias DISTINTAS (2 copias) + forja vs desguace de la copia restante
U=$(newuser); give "$U" "$Y" 2
F1=$(P "select uid from public.user_cards where user_id='$U' order by uid limit 1"); F2=$(P "select uid from public.user_cards where user_id='$U' order by uid offset 1 limit 1")
par "$(salv "$U" "$F1" "f-$U-1")" "$(salv "$U" "$F2" "f-$U-2")"
check "F1 · dos desguaces de copias distintas → queda 1" "$(cnt "$U" "$Y")" "1"
check "F1 · el perdedor: LAST_COPY" "$( (res 0; res 1) | grep -c LAST_COPY)" "1"
U=$(newuser); give "$U" "$X" 4
F3=$(uids "$U" "$X" 0 3); F4=$(uids "$U" "$X" 3 1)
par "$(craftnc "$U" "$F3" "f2-$U-c")" "$(salv "$U" "$F4" "f2-$U-s")"
F2L=$(cnt "$U" "$X"); F2O=$(( $(ops "$U" craft_card) + $(ops "$U" salvage) ))
[ "$F2L" -ge 1 ] && [ "$F2O" = 1 ] && pass "F2 · forja de 3 + desguace del 4º a la vez → gana una, nunca 0 (quedan $F2L)" || fail "F2 · quedan $F2L, operaciones $F2O"
U=$(newuser); give "$U" "$X" 3; give "$U" "$X" 1; P "update public.user_cards set locked=true where uid=(select uid from public.user_cards where user_id='$U' order by uid desc limit 1)" >/dev/null
F5=$(P "select string_agg(uid::text, ',' order by uid) from public.user_cards where user_id='$U' and not locked")
check "F3 · la copia EN VENTA no cuenta como la que conservas (0061)" "$(R "$(craftnc "$U" "$F5" "f3-$U")" | grep -o LAST_COPY)" "LAST_COPY"

# G · carta protegida en carrera
U=$(newuser); give "$U" "$X" 4; G3=$(uids "$U" "$X" 0 3)
( docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "begin; insert into public.user_card_favorites (user_id, card_id) values ('$U','$X'); select pg_sleep(3); commit;" </dev/null >/dev/null 2>&1 ) &
sleep 1; GS=$(date +%s%N); G=$(R "$(craftnc "$U" "$G3" "g1-$U")"); GE=$(date +%s%N); wait
check "G1 · favorita llega primero (en curso) → la forja ESPERA y la rechaza" "$(echo "$G" | grep -o PROTECTED_COPY)" "PROTECTED_COPY"
[ $(( (GE-GS)/1000000 )) -ge 1500 ] && pass "G1 · la forja esperó al cerrojo de 0052 ($(( (GE-GS)/1000000 )) ms)" || fail "G1 · no esperó ($(( (GE-GS)/1000000 )) ms)"
check "G1 · nada consumido" "$(cnt "$U" "$X")" "4"
check "G1 · confirmándola sí se puede" "$(R "$(echo "$(craftnc "$U" "$G3" "g1b-$U")" | sed "s/'{}'::uuid\[\]/$(arr "$G3")/")" | grep -c '"recipeId"')" "1"
U=$(newuser); give "$U" "$X" 4; G4=$(uids "$U" "$X" 0 3)
( docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "begin; $(craftnc "$U" "$G4" "g2-$U"); select pg_sleep(3); commit;" </dev/null >/dev/null 2>&1 ) &
sleep 1; FS=$(date +%s%N); FV=$(R "insert into public.user_card_favorites (user_id, card_id) values ('$U','$X') returning card_id"); FE=$(date +%s%N); wait
[ $(( (FE-FS)/1000000 )) -ge 1500 ] && pass "G2 · la favorita esperó a la forja en curso ($(( (FE-FS)/1000000 )) ms)" || fail "G2 · la favorita no esperó"
check "G2 · forja antes que la favorita: consumo legítimo, la última copia queda y la favorita existe" "$(cnt "$U" "$X")/$(P "select count(*) from public.user_card_favorites where user_id='$U'")" "1/1"
U=$(newuser); give "$U" "$X" 4; G5=$(uids "$U" "$X" 0 3); S1=$(echo "$G5" | cut -d, -f1)
( docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "begin; select public.player_profile_set('$U', array['$S1']::uuid[], null, null); select pg_sleep(3); commit;" </dev/null >/dev/null 2>&1 ) &
sleep 1; G=$(R "$(craftnc "$U" "$G5" "g3-$U")"); wait
check "G3 · vitrina en curso → la forja espera y la rechaza" "$(echo "$G" | grep -o PROTECTED_COPY)/$(cnt "$U" "$X")" "PROTECTED_COPY/4"
U=$(newuser); give "$U" "$X" 4; G6=$(uids "$U" "$X" 0 3); S2=$(echo "$G6" | cut -d, -f1)
( docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "begin; $(craftnc "$U" "$G6" "g4-$U"); select pg_sleep(3); commit;" </dev/null >/dev/null 2>&1 ) &
sleep 1; SV=$(R "select public.player_profile_set('$U', array['$S2']::uuid[], null, null)"); wait
check "G4 · forja en curso → la vitrina espera y ve que la copia ya no es tuya" "$(echo "$SV" | grep -o NOT_OWNED)" "NOT_OWNED"
U=$(newuser); give "$U" "$X" 3; DK=$(uids "$U" "$X" 0 1); P "insert into public.duel_decks (user_id, name, card_uids) values ('$U','QA',array['$DK']::uuid[])" >/dev/null 2>&1
DKR=$(R "select public.app_salvage_cards_guarded('$U',array['$DK']::uuid[],5,'g5-$U',array['$DK']::uuid[])")
check "G5 · copia de un EQUIPO: ni confirmándola" "$(echo "$DKR" | grep -o IN_DECK)" "IN_DECK"

# H · idempotencia: reintento tras éxito (cliente sin respuesta) y mismo gesto con OTRAS copias
U=$(newuser); give "$U" "$X" 7; H1=$(uids "$U" "$X" 0 3); H2=$(uids "$U" "$X" 3 3)
R "$(craftnc "$U" "$H1" "h-$U")" > /tmp/$NAME.h1; R "$(craftnc "$U" "$H1" "h-$U")" > /tmp/$NAME.h2; R "$(craftnc "$U" "$H2" "h-$U")" > /tmp/$NAME.h3
check "H · 3 llamadas con la misma clave → 1 forja, 4 copias de X" "$(ops "$U" craft_card)/$(cnt "$U" "$X")" "1/4"
check "H · los reintentos devuelven el resultado guardado" "$(cat /tmp/$NAME.h2 /tmp/$NAME.h3 | grep -c '"repeated": true')" "2"
U=$(newuser); give "$U" "$Y" 3; HS=$(uids "$U" "$Y" 0 1); CR0=$(P "select credits from public.profiles where id='$U'")
R "$(salv "$U" "$HS" "hs-$U")" >/dev/null; R "$(salv "$U" "$HS" "hs-$U")" >/dev/null
check "H · desguace reintentado: un cobro, un asiento con su clave (el alta del usuario sintético tiene el suyo)" "$(P "select credits - $CR0 from public.profiles where id='$U'")/$(P "select count(*) from public.credit_transactions where user_id='$U' and ref='hs-$U'")" "5/1"

# I · pestañas equivalentes: misma petición exacta ×4 a la vez
U=$(newuser); give "$U" "$X" 4; I3=$(uids "$U" "$X" 0 3)
par "$(craftnc "$U" "$I3" "i-$U")" "$(craftnc "$U" "$I3" "i-$U")" "$(craftnc "$U" "$I3" "i-$U")" "$(craftnc "$U" "$I3" "i-$U")"
check "I · 4 pestañas iguales → 1 forja, 3 repeated, 1 copia" "$(ops "$U" craft_card)/$( (res 0; res 1; res 2; res 3) | grep -c '"repeated": true')/$(cnt "$U" "$X")" "1/3/1"
check "invariante global: ningún inventario sintético negativo ni copias de otros tocadas" "$(P "select count(*) from public.user_cards where user_id::text like 'f7910000%' and card_id not in ('$X','$Y','$OUT')")" "0"
check "invariante global: datos REALES intactos tras las carreras" "$(for t in public.user_cards public.economy_ops public.credit_transactions; do P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t where user_id::text not like 'f7910000%'"; done | md5sum | cut -c1-12)" "$(for t in public.user_cards public.economy_ops public.credit_transactions; do grep "^$t " /tmp/$NAME.before | cut -d' ' -f2; done | md5sum | cut -c1-12)"

# ─────────────── 4. ROLLBACK operativo y vuelta a aplicar ───────────────
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/rollback.sql </dev/null 2>&1); check "rollback operativo aplica (exit)" "$?" "0"
check "rollback: app_craft_card vuelve al cuerpo EXACTO de 0059" "$(P "select md5(prosrc) from pg_proc where oid='public.app_craft_card(uuid, text, uuid[], jsonb, text, text)'::regprocedure")" "63c5e91e98149ffdc9213ea32bfab4cc"
check "rollback: 0060 intacta" "$(P "select md5(prosrc) from pg_proc where oid='public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure")" "$SALV_MD5"
check "rollback: sin forge_config ni guardadas" "$(P "select (to_regclass('public.forge_config') is null) and (select count(*) from pg_proc where proname like '%guarded' or proname like '_card_consume%')=0")" "t"
U=$(newuser); give "$U" "$X" 4; RU=$(uids "$U" "$X" 0 3)
check "rollback: la app ANTERIOR sigue intercambiando (RPC antigua)" "$(R "select public.app_craft_card('$U','card-plata-oro',$(arr "$RU"),$(exp "$RU" "$X"),'$OUT','rb-$U')" | grep -c '"recipeId"')" "1"
AGAIN=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0061.sql </dev/null 2>&1); check "0061 se vuelve a aplicar tras el rollback" "$?" "0"

echo "== fallos: $FAILS"
[ "$FAILS" = 0 ] && echo "DRYRUN_OK $NAME" || echo "DRYRUN_FAIL $NAME ($FAILS)"
