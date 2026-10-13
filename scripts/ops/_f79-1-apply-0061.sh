#!/usr/bin/env bash
# =============================================================================
# F79.1 · APLICAR 0061 EN PRODUCCIÓN — UNA vez, en UNA transacción, con comprobaciones antes y después.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0061> bash /tmp/f791/_f79-1-apply-0061.sh'
# Se PARA (exit ≠ 0) sin tocar nada si: el fichero no es el revisado, la cabeza no es 0060 por estado real, o ya hay
# rastro de 0061. Nunca reaplica 0059/0060. No imprime secretos (la sonda de PostgREST usa el entorno del contenedor).
# =============================================================================
set -uo pipefail
DB=supabase_db_DRLCards
F=/tmp/f791/0061_forge_progression.sql
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. cabeza = 0060 por estado real"
[ "$(q "select to_regclass('public.forge_config') is null")" = "t" ] || stop "forge_config ya existe"
[ "$(q "select count(*) from pg_proc where proname in ('app_craft_card_guarded','app_salvage_cards_guarded','_card_consume_guard','_card_consume_lock')")" = "0" ] || stop "ya hay funciones de 0061"
[ "$(q "select md5(prosrc) from pg_proc where oid='public.app_craft_card(uuid, text, uuid[], jsonb, text, text)'::regprocedure")" = "63c5e91e98149ffdc9213ea32bfab4cc" ] || stop "app_craft_card no es el de 0059"
SALV=$(q "select md5(prosrc) from pg_proc where oid='public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure")
[ "$(q "select prosrc like '%LAST_COPY%' from pg_proc where oid='public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure")" = "t" ] || stop "0060 no está"
echo "cabeza 0060 confirmada (desguace md5 $SALV)"
counts() { q "select 'cards='||(select count(*) from public.content_cards)||' agents='||(select count(*) from public.agents)||' users='||(select count(*) from auth.users)||' user_cards='||(select count(*) from public.user_cards)||' economy_ops='||(select count(*) from public.economy_ops)||' credit_tx='||(select count(*) from public.credit_transactions)||' recipes='||(select string_agg(id||':'||status||':'||input_qty, ',' order by sort_order) from public.craft_recipes)||' missions='||(select count(*) from public.content_missions)||' admins='||(select count(*) from public.profiles where is_admin)"; }
BEFORE=$(counts); echo "antes: $BEFORE"

echo "== 3. aplicar (una transacción)"
docker cp "$F" "$DB:/tmp/0061.sql" >/dev/null || stop "docker cp"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f /tmp/0061.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0061.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
AFTER=$(counts); echo "después: $AFTER"
chk() { [ "$2" = "$3" ] && echo "PASS $1 ($2)" || { echo "FAIL $1 (esperado $3, obtenido $2)"; FAILS=$((FAILS+1)); }; }
FAILS=0
chk "forge_config existe y vacía" "$(q "select count(*) from public.forge_config")" "0"
chk "forge_config RLS" "$(q "select relrowsecurity from pg_class where oid='public.forge_config'::regclass")" "t"
chk "navegador sin forge_config" "$(q "select has_table_privilege('anon','public.forge_config','select') or has_table_privilege('authenticated','public.forge_config','select')")" "f"
chk "4 funciones nuevas" "$(q "select count(*) from pg_proc where proname in ('app_craft_card_guarded','app_salvage_cards_guarded','_card_consume_guard','_card_consume_lock')")" "4"
chk "guardadas solo service_role" "$(q "select has_function_privilege('service_role','public.app_craft_card_guarded(uuid,text,uuid[],jsonb,text,text,uuid[])','execute') and has_function_privilege('service_role','public.app_salvage_cards_guarded(uuid,uuid[],bigint,text,uuid[])','execute') and not has_function_privilege('authenticated','public.app_craft_card_guarded(uuid,text,uuid[],jsonb,text,text,uuid[])','execute') and not has_function_privilege('anon','public.app_salvage_cards_guarded(uuid,uuid[],bigint,text,uuid[])','execute')")" "t"
chk "app_craft_card con última copia desbloqueada (0061)" "$(q "select prosrc like '%c.locked = false and not (c.uid = any(p_uids))%' from pg_proc where oid='public.app_craft_card(uuid, text, uuid[], jsonb, text, text)'::regprocedure")" "t"
chk "0060 intacta (md5 del desguace)" "$(q "select md5(prosrc) from pg_proc where oid='public.app_salvage_cards(uuid, uuid[], bigint, text)'::regprocedure")" "$SALV"
chk "dueño de las funciones nuevas = postgres" "$(q "select string_agg(distinct pg_get_userbyid(proowner), ',') from pg_proc where proname in ('app_craft_card_guarded','app_salvage_cards_guarded','_card_consume_guard','_card_consume_lock','app_craft_card')")" "postgres"
chk "ninguna receta forge-…" "$(q "select count(*) from public.craft_recipes where id like 'forge-%'")" "0"
B_REC=$(echo "$BEFORE" | grep -o 'recipes=[^ ]*'); A_REC=$(echo "$AFTER" | grep -o 'recipes=[^ ]*')
chk "recetas idénticas" "$A_REC" "$B_REC"
chk "catálogo/agentes/admins/misiones idénticos" "$(echo "$AFTER" | grep -o 'cards=[0-9]* agents=[0-9]*') $(echo "$AFTER" | grep -o 'missions=[0-9]* admins=[0-9]*')" "$(echo "$BEFORE" | grep -o 'cards=[0-9]* agents=[0-9]*') $(echo "$BEFORE" | grep -o 'missions=[0-9]* admins=[0-9]*')"

echo "== 5. PostgREST ve las RPC nuevas (sondas SIN escritura: fallan antes de tocar nada)"
sleep 2
PROBE=$(docker exec valorosters-app node -e '
const U=process.env.SUPABASE_INTERNAL_URL, K=process.env.SUPABASE_SERVICE_ROLE_KEY, A=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const post=(f,b,k)=>fetch(U+"/rest/v1/rpc/"+f,{method:"POST",headers:{apikey:k,authorization:"Bearer "+k,"content-type":"application/json"},body:JSON.stringify(b)}).then(async r=>r.status+" "+(await r.text()).slice(0,90));
(async()=>{
  const z="00000000-0000-4000-8000-000000000000";
  console.log("craft_guarded(ref vacía, service) → "+await post("app_craft_card_guarded",{p_user:z,p_recipe:"x",p_uids:[],p_expected:{},p_output_card_id:"x",p_ref:"",p_confirm:[]},K));
  console.log("salvage_guarded(ref vacía, service) → "+await post("app_salvage_cards_guarded",{p_user:z,p_uids:[],p_total:0,p_ref:"",p_confirm:[]},K));
  console.log("craft_guarded(anon) → "+await post("app_craft_card_guarded",{p_user:z,p_recipe:"x",p_uids:[],p_expected:{},p_output_card_id:"x",p_ref:"",p_confirm:[]},A));
  const r=await fetch(U+"/rest/v1/forge_config?select=id",{headers:{apikey:A,authorization:"Bearer "+A}}); console.log("forge_config(anon) → "+r.status+" "+(await r.text()).slice(0,80));
  const s=await fetch(U+"/rest/v1/forge_config?select=id",{headers:{apikey:K,authorization:"Bearer "+K}}); console.log("forge_config(service) → "+s.status+" "+(await s.text()).slice(0,80));
})();' </dev/null 2>&1)
echo "$PROBE"
echo "$PROBE" | grep -q "craft_guarded(ref vacía, service) → 400 .*idempotencia" && echo "PASS PostgREST expone app_craft_card_guarded" || { echo "FAIL PostgREST craft_guarded"; FAILS=$((FAILS+1)); }
echo "$PROBE" | grep -q "salvage_guarded(ref vacía, service) → 400 .*idempotencia" && echo "PASS PostgREST expone app_salvage_cards_guarded" || { echo "FAIL PostgREST salvage_guarded"; FAILS=$((FAILS+1)); }
echo "$PROBE" | grep -q "craft_guarded(anon) → 40[134]" && echo "PASS anon NO puede llamar a la RPC guardada" || { echo "FAIL anon"; FAILS=$((FAILS+1)); }
echo "$PROBE" | grep -q "forge_config(service) → 200 \[\]" && echo "PASS service_role lee forge_config (vacía)" || { echo "FAIL service forge_config"; FAILS=$((FAILS+1)); }
echo "$PROBE" | grep -q "forge_config(anon) → 40[134]" && echo "PASS anon NO lee forge_config" || { echo "FAIL anon forge_config"; FAILS=$((FAILS+1)); }
[ "$FAILS" = 0 ] && echo "APPLY_OK 0061_forge_progression" || echo "APPLY_CHECKS_FAILED $FAILS (0061 aplicada; revisar, NO improvisar)"
