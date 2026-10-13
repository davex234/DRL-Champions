#!/usr/bin/env bash
# =============================================================================
# F87.1 · ENSAYO de 0072 (corte de autoridad de recompensas de Pick'ems) sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   (PC)  npx tsx scripts/ops/_f871-dryrun-data.mts <dir>
#         scp 0072_*.sql 0072_*.ROLLBACK.sql _f871-dryrun.sh <dir>/{setup.sql,picks1.sql,picks3.sql,expected.tsv,meta.env,rewards1.json,rewards3.json,bad_rewards.json} VPS:/tmp/f871/
#   (VPS) SRC=/opt/nexus/backups/supabase-drlcards/pre-0072/<TS> bash /tmp/f871/_f871-dryrun.sh
#
#  · 0072 en UNA transacción; histórico legacy, libro y economía de las cuentas reales: huellas IGUALES antes/después.
#  · LEGACY: no se crean Pick'ems clásicos; legacy_mode inmutable; un RETIRED no admite predicciones ni recompensas;
#    el libro rechaza pagos legacy no clasificables o falsificados; lo anterior al corte (Champions 2026) sigue pagando
#    con sus reglas y los 500 créditos históricos de ValoRosters no se tocan; el camino EXACTO del worker ×20 = idempotente.
#  · PICK'EMS 2.0 (evento sintético solo en la copia): reglas v1 exactas para activar; una autoridad por evento;
#    escalones PERFECT/ELITE/GREAT/GOOD/PARTICIPATION/NADA y fronteras con paridad SQL⇄TS; VOID; hueco sin pick;
#    20 reclamos simultáneos; carrera worker legacy + reclamo; reintento; corrección tras reclamar.
#  · Rollback de 0072 y reaplicación.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f871-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
E() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1 | grep -oE 'PICKEM_[A-Z_]+|NOT_ADMIN|permission denied' | head -1; }
. "$DIR/meta.env"
LEG=8c7b9a5e-d74d-4f58-966b-c72f1822671a      # Pick'em legacy de Champions 2026 (anterior al corte)
VR=b7ccff02-e845-4a5d-ac1c-4ab23689b0a9        # ValoRosters (solo LECTURA de su histórico)
DX=3befce61-4c21-4c84-8397-40504fe6ec27        # davex (solo LECTURA)

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
DUMP=$(ls "$SRC"/*.dump 2>/dev/null | head -1)
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --no-owner < "$DUMP" > /tmp/$NAME.restore.log 2>&1 || true
docker exec "$NAME" mkdir -p /tmp/f871 </dev/null
for f in 0072_pickems_reward_cutover.sql 0072_pickems_reward_cutover.ROLLBACK.sql setup.sql picks1.sql picks3.sql rewards1.json rewards3.json bad_rewards.json; do docker cp "$DIR/$f" "$NAME:/tmp/f871/$f" >/dev/null; done
echo "== restaurado de $(basename "$DUMP")"
check "copia en 0071: pickem_brackets existe" "$(P "select to_regclass('public.pickem_brackets') is not null")" "t"
check "copia en 0071: sin legacy_mode" "$(P "select count(*) from information_schema.columns where table_name='pickem_events' and column_name='legacy_mode'")" "0"

# ─────────────── huellas: histórico legacy + libro + economía real ───────────────
fp() {
  P "select 'pickem_events', count(*)||':'||md5(string_agg(concat_ws('|',id,event_id,season_id,title,description,opens_at,locks_at,status,created_at,updated_at), '#' order by id)) from public.pickem_events"
  for t in pickem_questions pickem_submissions pickem_answers pickem_scores credit_transactions user_packs user_cosmetics pickem_brackets pickem_bracket_matches pickem_bracket_entries pickem_bracket_picks pickem_bracket_claims; do
    P "select '$t', count(*)||':'||coalesce(md5(string_agg(t::text, '#' order by t::text)),'-') from public.$t t"
  done
  P "select 'profiles_econ', md5(string_agg(concat_ws('|',id,credits,xp,points,level,packs_opened), '#' order by id)) from public.profiles"
}
REAL_FP="select md5(string_agg(x, '#' order by x)) from (select concat_ws('|','p',id,credits,xp,points,level,packs_opened) x from public.profiles where id in ('$DX','$VR') union all select concat_ws('|','t',id,user_id,delta,reason,ref,balance_after,created_at) from public.credit_transactions where user_id in ('$DX','$VR') union all select concat_ws('|','k',user_id,pack_id,qty) from public.user_packs where user_id in ('$DX','$VR') union all select concat_ws('|','c',user_id,count(*)) from public.user_cards where user_id in ('$DX','$VR') group by user_id) s"
VR500="select concat_ws('|',id,user_id,delta,reason,ref,balance_after,created_at) from public.credit_transactions where user_id='$VR' and reason like 'pickem_reward:%'"
fp > /tmp/$NAME.before
REAL_BEFORE=$(P "$REAL_FP"); VR500_BEFORE=$(P "$VR500")
check "los 500 créditos históricos de ValoRosters existen (1 asiento)" "$(P "select count(*)||'|'||sum(delta) from public.credit_transactions where user_id='$VR' and reason like 'pickem_reward:%'")" "1|500"

APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/f871/0072_pickems_reward_cutover.sql </dev/null 2>&1); RC=$?
check "0072 aplica en UNA transacción (exit)" "$RC" "0"
[ "$RC" = 0 ] || echo "$APPLY" | tail -5
fp > /tmp/$NAME.after
check "histórico legacy, libro, inventario, perfiles y Pick'ems 2.0: huellas IGUALES" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || diff /tmp/$NAME.before /tmp/$NAME.after | head -3)" "iguales"
check "los 3 Pick'ems legacy quedan LEGACY_V1" "$(P "select string_agg(legacy_mode, ',' order by created_at) from public.pickem_events")" "LEGACY_V1,LEGACY_V1,LEGACY_V1"
check "valor por defecto para filas nuevas: RETIRED" "$(P "select column_default like '%RETIRED%' from information_schema.columns where table_name='pickem_events' and column_name='legacy_mode'")" "t"

# Usuarios QA sintéticos + evento sintético + 2 borradores (solo en la copia) antes de las pruebas.
IDS=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -f /tmp/f871/setup.sql </dev/null 2>&1)
B1=$(echo "$IDS" | grep -E '^[0-9a-f-]{36}$' | sed -n 1p); B3=$(echo "$IDS" | grep -E '^[0-9a-f-]{36}$' | sed -n 2p)

# ═══════════════ LEGACY ═══════════════
check "worker: crear un Pick'em legacy nuevo (su INSERT exacto) → RETIRED" "$(E "insert into public.pickem_events (event_id, title, description, locks_at, status) values ('vlr-2976-emea-stage-2', 'Predicciones · X', 'x', now() + interval '1 day', 'open')")" "PICKEM_LEGACY_RETIRED"
check "legacy_mode inmutable sin bandera de operador" "$(E "update public.pickem_events set legacy_mode='RETIRED' where id='$LEG'")" "PICKEM_LEGACY_MODE_IMMUTABLE"
RET=$(P "begin; select set_config('drl.pickem_legacy_writer','on',true); insert into public.pickem_events (event_id, title, locks_at, status, legacy_mode) values ('qa-f871-evt', 'QA retirado', now() + interval '2 days', 'open', 'RETIRED') returning id; commit;" 2>&1 | grep -E '^[0-9a-f-]{36}$')
P "insert into public.pickem_questions (pickem_event_id, kind, prompt, options, points, locks_at) values ('$RET', 'champion', '¿QA?', '[{\"key\":\"a\",\"label\":\"A\"},{\"key\":\"b\",\"label\":\"B\"}]', 10, now() + interval '1 day')" >/dev/null 2>&1 || true
RQ=$(P "select id from public.pickem_questions where pickem_event_id='$RET' limit 1")
check "predecir en un legacy RETIRED → rechazado" "$(E "select public.app_submit_pick('$U_PERFECT','$RQ','a')")" "PICKEM_LEGACY_RETIRED"
C0=$(P "select credits from public.profiles where id='$U_PERFECT'")
check "pago legacy de un RETIRED → rechazado (falla cerrada)" "$(E "select public.app_grant_reward(p_user => '$U_PERFECT', p_ref => 'pickem:$RET:participacion', p_reason => 'pickem_reward:participacion', p_credits => 500)")" "PICKEM_LEGACY_REWARD_RETIRED"
check "pago legacy con ref falsificada (pickem_bracket) → rechazado" "$(E "select public.app_grant_reward(p_user => '$U_PERFECT', p_ref => 'pickem_bracket:00000000-0000-4000-8000-000000000000', p_reason => 'pickem_reward:oraculo', p_credits => 6000)")" "PICKEM_LEGACY_REWARD_RETIRED"
check "pago legacy con ref malformada → rechazado" "$(E "select public.app_grant_reward(p_user => '$U_PERFECT', p_ref => 'pickem:no-es-uuid:oraculo', p_reason => 'pickem_reward:oraculo', p_credits => 6000)")" "PICKEM_LEGACY_REWARD_RETIRED"
check "pago legacy de un Pick'em inexistente → rechazado" "$(E "select public.app_grant_reward(p_user => '$U_PERFECT', p_ref => 'pickem:00000000-0000-4000-8000-000000000001:oraculo', p_reason => 'pickem_reward:oraculo', p_credits => 6000)")" "PICKEM_LEGACY_REWARD_RETIRED"
check "tras los rechazos: créditos intactos y 0 asientos" "$(P "select credits||'|'||(select count(*) from public.credit_transactions where user_id='$U_PERFECT' and reason like 'pickem%') from public.profiles where id='$U_PERFECT'")" "$C0|0"
LQ=$(P "select id from public.pickem_questions where pickem_event_id='$LEG' and locks_at > now() order by locks_at limit 1")
if [ -n "$LQ" ]; then
  OPT=$(P "select options->0->>'key' from public.pickem_questions where id='$LQ'")
  check "Champions 2026 legacy (anterior al corte) sigue admitiendo predicciones" "$(P "select public.app_submit_pick('$U_ELITE','$LQ','$OPT')->>'option'")" "$OPT"
else pass "Champions 2026 legacy: sin preguntas abiertas en esta copia (nada que probar)"; fi
check "Champions 2026 legacy sigue pudiendo pagar con SUS reglas (escalón nuevo de una QA)" "$(P "select public.app_grant_reward(p_user => '$U_ELITE', p_ref => 'pickem:$LEG:participacion', p_reason => 'pickem_reward:participacion', p_credits => 500)->>'applied'")" "true"
# Camino EXACTO del worker legacy ×20 en paralelo (corregir + pagar por escalón): idempotente, sin asientos nuevos para ValoRosters.
LEDGER0=$(P "select count(*) from public.credit_transactions")
for i in $(seq 1 20); do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_score_pickem_event('$LEG'); select public.app_grant_reward(p_user => '$VR', p_ref => 'pickem:$LEG:participacion', p_reason => 'pickem_reward:participacion', p_credits => 500)->>'applied';" </dev/null > /tmp/$NAME.w.$i 2>&1 & done; wait
check "worker legacy ×20: ningún pago aplicado (ya pagado)" "$(cat /tmp/$NAME.w.* | grep -c '^true$')" "0"
check "worker legacy ×20: 0 asientos nuevos" "$(P "select count(*) from public.credit_transactions")" "$LEDGER0"
check "los 500 de ValoRosters: el MISMO asiento (id, importe, saldo, fecha)" "$(P "$VR500")" "$VR500_BEFORE"

# ═══════════════ PICK'EMS 2.0 (evento sintético solo en la copia) ═══════════════
check "evento sintético + 2 borradores" "$( [ -n "$B1" ] && [ -n "$B3" ] && echo ok || echo "$IDS" | tail -2)" "ok"
check "por defecto: recompensas OFF" "$(P "select string_agg(rewards_status, ',') from public.pickem_brackets where id in ('$B1','$B3')")" "OFF,OFF"
check "activar con reglas NO aprobadas (Élite = Champions) → rechazado" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$B1',pg_read_file('/tmp/f871/bad_rewards.json')::jsonb,'ACTIVE','x',1,true)")" "PICKEM_RULES_NOT_APPROVED"
check "activar las reglas v1 aprobadas → ACTIVE" "$(P "select public.app_pickem_admin_set_rewards('$ADMIN','$B1',pg_read_file('/tmp/f871/rewards1.json')::jsonb,'ACTIVE','x',1,true)->>'rewardsStatus'")" "ACTIVE"
P "select public.app_pickem_admin_set_rewards('$ADMIN','$B3',pg_read_file('/tmp/f871/rewards3.json')::jsonb,'ACTIVE','x',1,true)" >/dev/null
check "las reglas v1 de un ámbito no valen para otro (insignia por ámbito)" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$B3',pg_read_file('/tmp/f871/rewards1.json')::jsonb,'ACTIVE','x',2,true)")" "PICKEM_RULES_NOT_APPROVED"
# Una autoridad por evento: un ámbito 2.0 sobre Champions 2026 (Pick'em legacy anterior al corte) no se premia.
BL=$(P "select public.app_pickem_admin_save_draft('$ADMIN', null, 'qa-legacy-auth', 'vlr-2766', 'QA autoridad legacy', format_kind, stage_ids, descriptor, descriptor_checksum, '[]'::jsonb, max_points, 'MATCH', null)->>'id' from public.pickem_brackets where id='$B1'")
check "activar recompensas 2.0 en un evento con Pick'em legacy → rechazado" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$BL',jsonb_set(pg_read_file('/tmp/f871/rewards1.json')::jsonb,'{tiers,4,reward,cosmetics}','[\"insignia:pickem:qa-legacy-auth-perfecto\"]'),'ACTIVE','x',1,true)")" "PICKEM_LEGACY_AUTHORITY"
check "reclamo 2.0 en un evento con Pick'em legacy (inserción directa) → rechazado" "$(E "insert into public.pickem_bracket_claims (bracket_id,user_id,tier,reward,ref,rewards_version,settlement_version) values ('$BL','$U_PERFECT','PARTICIPATION','{}','x',1,1)")" "PICKEM_LEGACY_AUTHORITY"

# Ventana abierta SOLO en la copia → picks por la RPC → resultados reales de vuelta.
P "create table public._f871_saved as select id, status, start_time, winner_team_id, score_a, score_b from public.matches where event_id='qa-f871-evt'" >/dev/null
P "update public.matches m set status='upcoming', winner_team_id=null, score_a=null, score_b=null, start_time = now() + interval '3 days' + (match_order || ' minutes')::interval where event_id='qa-f871-evt'" >/dev/null
check "publicar B1 (recompensas ACTIVAS)" "$(P "select public.app_pickem_admin_set_status('$ADMIN','$B1','publish',1,'$CHK',null)->>'status'")" "PUBLISHED"
check "publicar B3" "$(P "select public.app_pickem_admin_set_status('$ADMIN','$B3','publish',1,'$CHK',null)->>'status'")" "PUBLISHED"
N1=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -v b1="$B1" -f /tmp/f871/picks1.sql </dev/null 2>&1 | grep -c '^true$')
N3=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -v b3="$B3" -f /tmp/f871/picks3.sql </dev/null 2>&1 | grep -c '^true$')
check "picks por la RPC (B1 + B3)" "$N1+$N3" "$(grep -c . "$DIR/picks1.sql")+$(grep -c . "$DIR/picks3.sql")"
check "VOID auditado de una Apertura en B3" "$(P "select public.app_pickem_admin_match('$ADMIN','$B3','$VOIDED','void',null,'ensayo F87.1: partido anulado')->>'action'")" "void"
P "update public.matches m set status=s.status, start_time=s.start_time, winner_team_id=s.winner_team_id, score_a=s.score_a, score_b=s.score_b from public._f871_saved s where s.id=m.id" >/dev/null
check "reclamar antes de liquidar → NOT_SETTLED" "$(E "select public.app_pickem_claim('$U_PERFECT','$B1')")" "PICKEM_NOT_SETTLED"
check "liquidar B1" "$(P "select public.app_pickem_admin_settle('$ADMIN','$B1',0,null)->>'settlementVersion'")" "1"
check "liquidar B3" "$(P "select public.app_pickem_admin_settle('$ADMIN','$B3',0,null)->>'settlementVersion'")" "1"
while IFS=$'\t' read -r b u name pts cor picked perf tier; do
  bid=$B1; [ "$b" = "b3" ] && bid=$B3
  ROW=$(P "select final_points||' '||final_correct||' '||(final_correct + final_wrong)||' '||case when final_perfect then 't' else 'f' end||' '||coalesce(final_tier,'') from public.pickem_bracket_entries where bracket_id='$bid' and user_id='$u'")
  check "paridad SQL⇄TS · $name" "$ROW" "$pts $cor $picked $perf $tier"
done < "$DIR/expected.tsv"

# Reclamos: lo entregado por escalón (un solo escalón; nada acumulativo).
packs() { P "select coalesce(string_agg(pack_id||':'||qty, ',' order by pack_id),'-') from public.user_packs where user_id='$1'"; }
qty() { P "select coalesce((select qty from public.user_packs where user_id='$1' and pack_id='$2'),0)"; }
M0=$(qty "$U_PERFECT" masters)
for i in $(seq 1 20); do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_pickem_claim('$U_PERFECT','$B1')->>'applied'" </dev/null > /tmp/$NAME.c.$i 2>&1 & done; wait
check "PERFECTO · 20 reclamos simultáneos: 1 aplicado" "$(cat /tmp/$NAME.c.* | grep -c '^true$')" "1"
check "PERFECTO · 1 asiento, +1 Masters, 1 insignia, ningún otro sobre" "$(P "select count(*) from public.credit_transactions where user_id='$U_PERFECT' and ref='pickem_bracket:$B1'")|$(qty "$U_PERFECT" masters)|$(P "select count(*) from public.user_cosmetics where user_id='$U_PERFECT' and cosmetic_id='insignia:pickem:qa-f871-b1-perfecto'")|$(qty "$U_PERFECT" premium)$(qty "$U_PERFECT" oro)" "1|$((M0+1))|1|00"
claim_one() { P "select public.app_pickem_claim('$1','$2')->>'tier'"; }
# Carrera worker legacy + reclamo 2.0 del mismo usuario (U_ELITE, que también tiene picks legacy en Champions).
for i in $(seq 1 10); do
  docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_score_pickem_event('$LEG'); select public.app_grant_reward(p_user => '$U_ELITE', p_ref => 'pickem:$LEG:participacion', p_reason => 'pickem_reward:participacion', p_credits => 500)->>'applied';" </dev/null > /tmp/$NAME.wr.$i 2>&1 &
  docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_pickem_claim('$U_ELITE','$B1')->>'applied'" </dev/null > /tmp/$NAME.cr.$i 2>&1 &
done; wait
check "carrera worker legacy + reclamo 2.0: 1 reclamo aplicado" "$(cat /tmp/$NAME.cr.* | grep -c '^true$')" "1"
check "carrera: 0 pagos legacy nuevos (ya cobrado)" "$(cat /tmp/$NAME.wr.* | grep -c '^true$')" "0"
check "ÉLITE · Masters SIN insignia, 1 asiento 2.0" "$(P "select count(*) from public.user_cosmetics where user_id='$U_ELITE'")|$(P "select count(*) from public.credit_transactions where user_id='$U_ELITE' and ref='pickem_bracket:$B1'")|$(qty "$U_ELITE" masters)" "0|1|1"
check "reintento tras pagar (reinicio antes de responder) → no aplica" "$(P "select public.app_pickem_claim('$U_ELITE','$B1')->>'applied'")" "false"
U3=00000000-0000-4000-8000-0000f8710003; U4=00000000-0000-4000-8000-0000f8710004; U5=00000000-0000-4000-8000-0000f8710005; U6=00000000-0000-4000-8000-0000f8710006; U7=00000000-0000-4000-8000-0000f8710007; U10=00000000-0000-4000-8000-0000f8710010; U11=00000000-0000-4000-8000-0000f8710011
E0_7=$(qty "$U7" estandar); E0_9=$(qty "$U_PART80" estandar)
check "GRAN RESULTADO (frontera alta 23/28) → Oro" "$(claim_one $U3 $B1)|$(qty $U3 oro)|$(qty $U3 masters)" "GREAT|1|0"
check "GRAN RESULTADO (frontera 20/28 = 71,4 %) → Oro" "$(claim_one $U4 $B1)|$(qty $U4 oro)" "GREAT|1"
check "BUEN RESULTADO (19/28 = 67,9 %, justo bajo 70 %) → Plata" "$(claim_one $U5 $B1)|$(qty $U5 premium)|$(qty $U5 oro)" "GOOD|1|0"
check "BUEN RESULTADO (14/28 = 50 % exacto) → Plata" "$(claim_one $U6 $B1)|$(qty $U6 premium)" "GOOD|1"
check "PARTICIPACIÓN (13/28 = 46 %) → Bronce" "$(claim_one $U7 $B1)|$(( $(qty $U7 estandar) - E0_7 ))|$(qty $U7 premium)" "PARTICIPATION|1|0"
check "PARTICIPACIÓN con 80 % exacto de picks y 29 % de puntos → Bronce" "$(claim_one $U_PART80 $B1)|$(( $(qty $U_PART80 estandar) - E0_9 ))" "PARTICIPATION|1"
check "NADA con 75 % de picks aunque tenga 23/28 puntos → NOT_ELIGIBLE" "$(E "select public.app_pickem_claim('$U_NONE','$B1')")" "PICKEM_NOT_ELIGIBLE"
check "VOID · perfecto con el anulado sin pick → Masters + insignia de B3" "$(claim_one $U10 $B3)|$(P "select count(*) from public.user_cosmetics where user_id='$U10' and cosmetic_id='insignia:pickem:qa-f871-b3-perfecto'")" "PERFECT|1"
check "hueco sin pick en un partido válido rompe el perfecto → Élite sin insignia" "$(claim_one $U11 $B3)|$(P "select count(*) from public.user_cosmetics where user_id='$U11'")" "ELITE|0"
check "reclamar en un ámbito donde no participó → NOT_ELIGIBLE" "$(E "select public.app_pickem_claim('$U_NONE','$B3')")" "PICKEM_NOT_ELIGIBLE"
check "ningún asiento 2.0 trae créditos" "$(P "select coalesce(sum(delta),0) from public.credit_transactions where ref like 'pickem_bracket:%'")" "0"
check "un asiento 2.0 por jugador y ámbito (sin duplicados)" "$(P "select count(*) from (select user_id, ref from public.credit_transactions where ref like 'pickem_bracket:%' group by 1,2 having count(*)>1) x")" "0"
# Corrección de la fuente tras reclamar: se reliquida sin pagar ni retirar nada.
L0=$(P "select count(*) from public.credit_transactions where ref like 'pickem_bracket:%'")
P "update public.matches set winner_team_id = case when winner_team_id = team_a_id then team_b_id else team_a_id end where id = '$G_MATCH'" >/dev/null
check "reliquidar con motivo tras la corrección" "$(P "select public.app_pickem_admin_settle('$ADMIN','$B1',1,'ensayo F87.1: corrección de la fuente')->>'settlementVersion'")" "2"
check "corrección: 0 asientos nuevos, reclamos intactos (sin clawback)" "$(P "select count(*) from public.credit_transactions where ref like 'pickem_bracket:%'")|$(P "select count(*) from public.pickem_bracket_claims where bracket_id='$B1'")" "$L0|8"

# ═══════════════ cuentas reales ═══════════════
check "davex y ValoRosters: economía idéntica tras TODO el ensayo" "$(P "$REAL_FP")" "$REAL_BEFORE"
check "ValoRosters: sus 500 históricos siguen siendo el mismo asiento" "$(P "$VR500")" "$VR500_BEFORE"

# ═══════════════ rollback y reaplicación ═══════════════
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/f871/0072_pickems_reward_cutover.ROLLBACK.sql </dev/null 2>&1); RRC=$?
check "rollback (exit)" "$RRC" "0"
check "rollback: guardias fuera, columna conservada" "$(P "select count(*) from pg_trigger where tgname in ('pickem_events_legacy_guard','pickem_submissions_legacy_guard','credit_tx_pickem_legacy_guard','pickem_brackets_rewards_guard','pickem_claims_authority_guard')")|$(P "select count(*) from information_schema.columns where table_name='pickem_events' and column_name='legacy_mode'")" "0|1"
RA=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/f871/0072_pickems_reward_cutover.sql </dev/null 2>&1); RAC=$?
check "0072 se vuelve a aplicar limpia" "$RAC" "0"
[ "$RAC" = 0 ] || echo "$RA" | tail -3
check "reaplicada: 5 guardias" "$(P "select count(*) from pg_trigger where tgname in ('pickem_events_legacy_guard','pickem_submissions_legacy_guard','credit_tx_pickem_legacy_guard','pickem_brackets_rewards_guard','pickem_claims_authority_guard')")" "5"

echo
if [ "$FAILS" = 0 ]; then echo "DRYRUN_OK"; else echo "DRYRUN_FAIL ($FAILS)"; fi
