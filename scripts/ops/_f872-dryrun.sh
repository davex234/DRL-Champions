#!/usr/bin/env bash
# =============================================================================
# F87.2 · ENSAYO de 0073 (launch guard de Pick'ems) sobre una COPIA AISLADA (--network none). NUNCA toca producción.
# =============================================================================
#   (PC)  npx tsx scripts/ops/_f872-dryrun-data.mts <dir>
#         scp 0073_*.sql 0073_*.ROLLBACK.sql _f872-dryrun.sh <dir>/* VPS:/tmp/f872/
#   (VPS) SRC=/opt/nexus/backups/supabase-drlcards/pre-0073/<TS> bash /tmp/f872/_f872-dryrun.sh
#
#  · 0073 en UNA transacción; histórico legacy, libro, Pick'ems 2.0 y economía real: huellas IGUALES antes/después.
#  · LEGACY: ningún camino crea un Pick'em clásico nuevo (worker, rol de cliente, admin sin bandera); versión
#    desconocida → rechazada; sin rebaja de versión; vlr-2976 (LEGACY_V1) puede TERMINAR con sus reglas; el worker
#    legacy no puede pagar un Pick'em 2.0.
#  · ELEGIBILIDAD: fronteras de antigüedad (7 días exactos / 1 s menos) y de partidas (2, 2+1 después, 3 privadas);
#    fresca con PERFECTO → sigue PERFECTA y no cobra (20 reclamos = 0); granja de participación bloqueada; madura cobra
#    una vez (20 reclamos = 1); inserción directa del reclamo también bloqueada; rol de cliente sin acceso.
#  · PUERTAS: activar sin política / política desconocida / demasiado tarde / naciendo activo → rechazado; recompensas
#    congeladas tras el primer cierre; desactivar sí; una política futura no cambia la de un ámbito ya congelado.
#  · Rollback de 0073 (se niega con recompensas ACTIVAS; devuelve las guardias de 0072 sin reabrir legacy) y reaplicación.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f872-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
E() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1 | grep -oE 'PICKEM_[A-Z_]+|NOT_ADMIN|permission denied|violates check constraint' | head -1; }
. "$DIR/meta.env"
LEG=8c7b9a5e-d74d-4f58-966b-c72f1822671a      # Pick'em legacy de Champions 2026 (anterior al corte)
L2976=d1a9af15-a556-4e22-b51b-7a404a453fd7    # Pick'em legacy de VCT EMEA Stage 2 (abierto, LEGACY_V1)
VR=b7ccff02-e845-4a5d-ac1c-4ab23689b0a9        # ValoRosters (solo LECTURA)
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
docker exec "$NAME" mkdir -p /tmp/f872 </dev/null
for f in 0073_pickems_launch_guard.sql 0073_pickems_launch_guard.ROLLBACK.sql setup.sql picks1.sql maturity.sql rewards1.json rewards4.json nopolicy.json v9policy.json; do docker cp "$DIR/$f" "$NAME:/tmp/f872/$f" >/dev/null; done
echo "== restaurado de $(basename "$DUMP")"
# La imagen de Supabase concede por defecto a anon/authenticated los objetos que RESTAURA supabase_admin: se alinean
# los privilegios de la copia con los de PRODUCCIÓN (comprobados aparte: todo cerrado para los roles de cliente).
P "revoke all on table public.pickem_events, public.pickem_questions, public.pickem_brackets, public.pickem_bracket_matches, public.pickem_bracket_entries, public.pickem_bracket_picks, public.pickem_bracket_claims, public.credit_transactions from anon, authenticated; grant select on public.pickem_events to anon, authenticated; revoke all on all functions in schema public from anon, authenticated;" >/dev/null
check "copia en 0072: legacy_mode y guardias presentes" "$(P "select count(*) from pg_trigger where tgname in ('pickem_events_legacy_guard','pickem_submissions_legacy_guard','credit_tx_pickem_legacy_guard','pickem_brackets_rewards_guard','pickem_claims_authority_guard')")" "5"
check "copia sin 0073" "$(P "select to_regprocedure('public.app_pickem_reward_eligibility(uuid, uuid, timestamptz)') is null")" "t"

fp() {
  P "select 'pickem_events', count(*)||':'||md5(string_agg(t::text, '#' order by t::text)) from public.pickem_events t"
  for t in pickem_questions pickem_submissions pickem_answers pickem_scores credit_transactions user_packs user_cosmetics user_cards pickem_brackets pickem_bracket_matches pickem_bracket_entries pickem_bracket_picks pickem_bracket_claims duel_matches; do
    P "select '$t', count(*)||':'||coalesce(md5(string_agg(t::text, '#' order by t::text)),'-') from public.$t t"
  done
  P "select 'profiles', md5(string_agg(t::text, '#' order by t::text)) from public.profiles t"
}
REAL_FP="select md5(string_agg(x, '#' order by x)) from (select concat_ws('|','p',id,credits,xp,points,level,packs_opened) x from public.profiles where id in ('$DX','$VR') union all select concat_ws('|','t',id,user_id,delta,reason,ref,balance_after,created_at) from public.credit_transactions where user_id in ('$DX','$VR') union all select concat_ws('|','k',user_id,pack_id,qty) from public.user_packs where user_id in ('$DX','$VR') union all select concat_ws('|','c',user_id,count(*)) from public.user_cards where user_id in ('$DX','$VR') group by user_id) s"
VR500="select concat_ws('|',id,user_id,delta,reason,ref,balance_after,created_at) from public.credit_transactions where user_id='$VR' and reason like 'pickem_reward:%'"
fp > /tmp/$NAME.before
REAL_BEFORE=$(P "$REAL_FP"); VR500_BEFORE=$(P "$VR500")
echo "huella económica real de la copia: $REAL_BEFORE (se compara antes/después DENTRO del ensayo)"

APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/f872/0073_pickems_launch_guard.sql </dev/null 2>&1); RC=$?
check "0073 aplica en UNA transacción (exit)" "$RC" "0"
[ "$RC" = 0 ] || echo "$APPLY" | tail -5
fp > /tmp/$NAME.after
check "TODO el histórico y la economía: huellas IGUALES tras 0073" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || diff /tmp/$NAME.before /tmp/$NAME.after | head -3)" "iguales"
check "sin privilegios de cliente sobre lo nuevo" "$(P "select bool_or(has_function_privilege(r, f, 'EXECUTE')) from unnest(array['anon','authenticated']) r, unnest(array['public.app_pickem_reward_eligibility(uuid,uuid,timestamptz)','public.app_pickem_eligibility_summary(uuid)','public._pickem_window_closed(uuid,timestamptz)','public._pickem_first_lock(uuid)']) f")" "f"

IDS=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -f /tmp/f872/setup.sql </dev/null 2>&1)
B1=$(echo "$IDS" | grep -E '^[0-9a-f-]{36}$' | sed -n 1p); B4=$(echo "$IDS" | grep -E '^[0-9a-f-]{36}$' | sed -n 2p)
check "evento sintético + 2 borradores" "$( [ -n "$B1" ] && [ -n "$B4" ] && echo ok || echo "$IDS" | tail -2)" "ok"

# ═══════════════ LEGACY: solo histórico + terminar lo existente ═══════════════
check "worker: crear un Pick'em clásico para un evento nuevo → RETIRED" "$(E "insert into public.pickem_events (event_id, title, description, locks_at, status) values ('$EVT', 'Predicciones · X', 'x', now() + interval '1 day', 'open')")" "PICKEM_LEGACY_RETIRED"
check "admin/servicio SIN bandera de operador pidiendo LEGACY_V1 → RETIRED" "$(E "insert into public.pickem_events (event_id, title, locks_at, status, legacy_mode) values ('$EVT', 'x', now() + interval '1 day', 'open', 'LEGACY_V1')")" "PICKEM_LEGACY_RETIRED"
check "rol de cliente (authenticated) creando un Pick'em clásico → sin permiso" "$(E "set role authenticated; insert into public.pickem_events (event_id, title, locks_at, status) values ('$EVT', 'x', now() + interval '1 day', 'open')")" "permission denied"
check "versión desconocida (LEGACY_V2) incluso con bandera → rechazada" "$(E "begin; select set_config('drl.pickem_legacy_writer','on',true); insert into public.pickem_events (event_id, title, locks_at, status, legacy_mode) values ('$EVT', 'x', now() + interval '1 day', 'open', 'LEGACY_V2'); commit;")" "violates check constraint"
RET=$(P "begin; select set_config('drl.pickem_legacy_writer','on',true); insert into public.pickem_events (event_id, title, locks_at, status, legacy_mode) values ('$EVT', 'QA retirado', now() + interval '2 days', 'open', 'RETIRED') returning id; commit;" 2>&1 | grep -E '^[0-9a-f-]{36}$')
check "rebaja RETIRED → LEGACY_V1 sin bandera → inmutable" "$(E "update public.pickem_events set legacy_mode='LEGACY_V1' where id='$RET'")" "PICKEM_LEGACY_MODE_IMMUTABLE"
check "worker legacy pagando con ref de un Pick'em 2.0 → rechazado" "$(E "select public.app_grant_reward(p_user => '$M_PART', p_ref => 'pickem:$B1:participacion', p_reason => 'pickem_reward:participacion', p_credits => 500)")" "PICKEM_LEGACY_REWARD_RETIRED"
# vlr-2976 TERMINA con sus reglas: una pregunta (solo en la copia, como la crearía el ciclo legacy), un pick, puntuar, pagar.
P "insert into public.pickem_questions (pickem_event_id, kind, prompt, options, points, locks_at) values ('$L2976', 'champion', '¿QA 2976?', '[{\"key\":\"a\",\"label\":\"A\"},{\"key\":\"b\",\"label\":\"B\"}]', 10, now() + interval '1 day')" >/dev/null
Q2976=$(P "select id from public.pickem_questions where pickem_event_id='$L2976' order by created_at desc limit 1")
check "vlr-2976 (LEGACY_V1) sigue admitiendo predicciones" "$(P "select public.app_submit_pick('$M_PART','$Q2976','a')->>'option'")" "a"
check "vlr-2976: puntuar con su RPC legacy sin error" "$(P "select public.app_score_pickem_event('$L2976') is not null")" "t"
check "vlr-2976: pagar SU escalón legacy (camino del worker)" "$(P "select public.app_grant_reward(p_user => '$M_PART', p_ref => 'pickem:$L2976:participacion', p_reason => 'pickem_reward:participacion', p_credits => 500)->>'applied'")" "true"
check "vlr-2976: el mismo pago otra vez → no aplica (exactamente una vez)" "$(P "select public.app_grant_reward(p_user => '$M_PART', p_ref => 'pickem:$L2976:participacion', p_reason => 'pickem_reward:participacion', p_credits => 500)->>'applied'")" "false"

# ═══════════════ PUERTAS DE ACTIVACIÓN ═══════════════
check "por defecto: recompensas OFF y borrador" "$(P "select string_agg(status||'/'||rewards_status, ',' order by slug) from public.pickem_brackets where id in ('$B1','$B4')")" "DRAFT/OFF,DRAFT/OFF"
check "activar con los partidos ya jugados → DEMASIADO TARDE" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$B1',pg_read_file('/tmp/f872/rewards1.json')::jsonb,'ACTIVE','x',1,true)")" "PICKEM_REWARDS_TOO_LATE"
check "un Pick'em no puede NACER con recompensas activas" "$(E "insert into public.pickem_brackets (slug, event_id, title, format_kind, stage_ids, descriptor, descriptor_checksum, admin_edges, max_points, lock_policy, rewards, rewards_status) select 'qa-f872-nace', event_id, title, format_kind, stage_ids, descriptor, descriptor_checksum, admin_edges, max_points, lock_policy, pg_read_file('/tmp/f872/rewards1.json')::jsonb, 'ACTIVE' from public.pickem_brackets where id='$B1'")" "PICKEM_REWARDS_TOO_LATE"
P "create table public._f872_saved as select id, status, start_time, winner_team_id, score_a, score_b from public.matches where event_id='$EVT'" >/dev/null
P "update public.matches m set status='upcoming', winner_team_id=null, score_a=null, score_b=null, start_time = now() + interval '3 days' + (match_order || ' minutes')::interval where event_id='$EVT'" >/dev/null
check "activar SIN política de elegibilidad → rechazado" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$B1',pg_read_file('/tmp/f872/nopolicy.json')::jsonb,'ACTIVE','x',1,true)")" "PICKEM_ELIGIBILITY_POLICY_REQUIRED"
check "activar con una política DESCONOCIDA → rechazado" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$B1',pg_read_file('/tmp/f872/v9policy.json')::jsonb,'ACTIVE','x',1,true)")" "PICKEM_ELIGIBILITY_POLICY_REQUIRED"
check "activar reglas v1 + política v1 antes del primer cierre → ACTIVE" "$(P "select public.app_pickem_admin_set_rewards('$ADMIN','$B1',pg_read_file('/tmp/f872/rewards1.json')::jsonb,'ACTIVE','x',1,true)->>'rewardsStatus'")" "ACTIVE"
check "B4 activado" "$(P "select public.app_pickem_admin_set_rewards('$ADMIN','$B4',pg_read_file('/tmp/f872/rewards4.json')::jsonb,'ACTIVE','x',1,true)->>'rewardsStatus'")" "ACTIVE"
check "antes del primer cierre se puede re-guardar (misma regla)" "$(P "select public.app_pickem_admin_set_rewards('$ADMIN','$B4',pg_read_file('/tmp/f872/rewards4.json')::jsonb,'ACTIVE','x',2,true)->>'rewardsVersion'")" "3"
check "publicar B1 (con recompensas)" "$(P "select public.app_pickem_admin_set_status('$ADMIN','$B1','publish',1,'$CHK',null)->>'status'")" "PUBLISHED"
check "publicar B4" "$(P "select public.app_pickem_admin_set_status('$ADMIN','$B4','publish',1,'$CHK',null)->>'status'")" "PUBLISHED"
N1=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -v b1="$B1" -f /tmp/f872/picks1.sql </dev/null 2>&1 | grep -c '^true$')
check "TODOS (cuentas nuevas incluidas) pueden predecir" "$N1" "$(grep -c . "$DIR/picks1.sql")"
check "vista previa antes del cierre: no definitiva" "$(P "select (public.app_pickem_reward_eligibility('$F_PERFECT','$B1')->>'final')")" "false"
P "update public.matches m set status=s.status, start_time=s.start_time, winner_team_id=s.winner_team_id, score_a=s.score_a, score_b=s.score_b from public._f872_saved s where s.id=m.id" >/dev/null
REF=$(P "select public._pickem_first_lock('$B1')")
docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -v ref="$REF" -f /tmp/f872/maturity.sql </dev/null >/tmp/$NAME.mat 2>&1
check "madurez QA fijada respecto al primer cierre real ($REF)" "$(P "select count(*) from public.duel_matches where rules_version='qa-f872'")" "$(grep -c '^insert' "$DIR/maturity.sql")"

# ═══════════════ CONGELACIÓN Y POLÍTICA FUTURA ═══════════════
check "tras el primer cierre: cambiar recompensas ACTIVAS → CONGELADAS" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$B4',jsonb_set(pg_read_file('/tmp/f872/rewards4.json')::jsonb,'{minCompletion}','0.5'),'ACTIVE','x',3,true)")" "PICKEM_REWARDS_FROZEN"
check "tras el cierre tampoco se DESACTIVAN (0071 congela todo cambio)" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$B4',pg_read_file('/tmp/f872/rewards4.json')::jsonb,'OFF','x',3,false)")" "PICKEM_REWARDS_FROZEN"
# Una política v2 (más estricta) registrada en el futuro NO cambia la de un ámbito congelado en v1.
P "create or replace function public._pickem_eligibility_policy(p_id text) returns jsonb language sql immutable as \$\$ select case p_id when 'reward-eligibility-v1' then jsonb_build_object('id','reward-eligibility-v1','minAccountAgeDays',7,'minCompletedMatches',3,'countedModes',jsonb_build_array('PVE','DRAFT_GAUNTLET','PVP'),'countedStatuses',jsonb_build_array('COMPLETED','DRAW')) when 'reward-eligibility-v2' then jsonb_build_object('id','reward-eligibility-v2','minAccountAgeDays',365,'minCompletedMatches',100,'countedModes',jsonb_build_array('PVP'),'countedStatuses',jsonb_build_array('COMPLETED')) else null end \$\$" >/dev/null
check "con v2 registrada, B1 sigue evaluando con v1" "$(P "select (public.app_pickem_reward_eligibility('$M_PERFECT','$B1')->>'policy')||'|'||(public.app_pickem_reward_eligibility('$M_PERFECT','$B1')->>'code')")" "reward-eligibility-v1|ELIGIBLE"
check "pasar B1 a v2 tras el cierre → CONGELADAS" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$B1',jsonb_set(pg_read_file('/tmp/f872/rewards1.json')::jsonb,'{eligibilityPolicy}','\"reward-eligibility-v2\"'),'ACTIVE','x',2,true)")" "PICKEM_REWARDS_FROZEN"

# ═══════════════ LIQUIDACIÓN, RENDIMIENTO Y ELEGIBILIDAD ═══════════════
check "liquidar B1" "$(P "select public.app_pickem_admin_settle('$ADMIN','$B1',0,null)->>'settlementVersion'")" "1"
while IFS=$'\t' read -r u name tier code; do
  check "rendimiento intacto + elegibilidad · $name" "$(P "select coalesce(final_tier,'')||'|'||(public.app_pickem_reward_eligibility(user_id, bracket_id)->>'code')||'|'||(final_position is not null) from public.pickem_bracket_entries where bracket_id='$B1' and user_id='$u'")" "$tier|$code|true"
done < "$DIR/expected.tsv"
check "la clasificación conserva a TODOS (también a los no elegibles)" "$(P "select count(*) from public.pickem_bracket_entries where bracket_id='$B1' and final_position is not null")" "10"
check "resumen para el panel (sin datos personales)" "$(P "select public.app_pickem_eligibility_summary('$B1')->>'ELIGIBLE'")" "4"
qty() { P "select coalesce((select qty from public.user_packs where user_id='$1' and pack_id='$2'),0)"; }
for i in $(seq 1 20); do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_pickem_claim('$F_PERFECT','$B1')->>'applied'" </dev/null > /tmp/$NAME.f.$i 2>&1 & done; wait
check "FRESCA con PERFECTO · 20 reclamos: 0 aplicados, todos INELIGIBLE" "$(cat /tmp/$NAME.f.* | grep -c '^true$')|$(cat /tmp/$NAME.f.* | grep -c 'PICKEM_REWARD_INELIGIBLE')" "0|20"
check "FRESCA con PERFECTO · sin Masters, sin insignia, sin asiento; sigue PERFECTA" "$(qty "$F_PERFECT" masters)|$(P "select count(*) from public.user_cosmetics where user_id='$F_PERFECT'")|$(P "select count(*) from public.credit_transactions where user_id='$F_PERFECT' and ref like 'pickem%'")|$(P "select final_tier from public.pickem_bracket_entries where bracket_id='$B1' and user_id='$F_PERFECT'")" "0|0|0|PERFECT"
check "inserción DIRECTA del reclamo de una fresca (saltándose la RPC) → INELIGIBLE" "$(E "insert into public.pickem_bracket_claims (bracket_id,user_id,tier,reward,ref,rewards_version,settlement_version) values ('$B1','$F_PERFECT','PERFECT','{}','x',2,1)")" "PICKEM_REWARD_INELIGIBLE"
check "GRANJA DE PARTICIPACIÓN · fresca con ≥ 80 % y pocos puntos → INELIGIBLE, sin Bronce" "$(E "select public.app_pickem_claim('$F_PART','$B1')")|$(qty "$F_PART" estandar)" "PICKEM_REWARD_INELIGIBLE|$(qty "$F_PART" estandar)"
M0=$(qty "$M_PERFECT" masters)
for i in $(seq 1 20); do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_pickem_claim('$M_PERFECT','$B1')->>'applied'" </dev/null > /tmp/$NAME.m.$i 2>&1 & done; wait
check "MADURA con PERFECTO · 20 reclamos: 1 aplicado" "$(cat /tmp/$NAME.m.* | grep -c '^true$')" "1"
check "MADURA con PERFECTO · +1 Masters + insignia, 1 asiento" "$(( $(qty "$M_PERFECT" masters) - M0 ))|$(P "select count(*) from public.user_cosmetics where user_id='$M_PERFECT' and cosmetic_id='insignia:pickem:qa-f872-b1-perfecto'")|$(P "select count(*) from public.credit_transactions where user_id='$M_PERFECT' and ref='pickem_bracket:$B1'")" "1|1|1"
E0=$(qty "$M_PART" estandar)
check "MADURA con participación → 1 Bronce" "$(P "select public.app_pickem_claim('$M_PART','$B1')->>'tier'")|$(( $(qty "$M_PART" estandar) - E0 ))" "PARTICIPATION|1"
check "FRONTERA · 7 días exactos y 3 partidas → cobra Plata" "$(P "select public.app_pickem_claim('$B_AGE_EXACT','$B1')->>'tier'")|$(qty "$B_AGE_EXACT" premium)" "GOOD|1"
check "FRONTERA · 7 días menos 1 s → INELIGIBLE" "$(E "select public.app_pickem_claim('$B_AGE_MINUS','$B1')")" "PICKEM_REWARD_INELIGIBLE"
check "FRONTERA · 2 partidas → INELIGIBLE" "$(E "select public.app_pickem_claim('$B_MATCH2','$B1')")" "PICKEM_REWARD_INELIGIBLE"
check "FRONTERA · 2 antes + 1 DESPUÉS del cierre → INELIGIBLE (la de después no cuenta)" "$(E "select public.app_pickem_claim('$B_MATCH_AFTER','$B1')")" "PICKEM_REWARD_INELIGIBLE"
check "3 partidas PRIVADAS no cuentan → INELIGIBLE" "$(E "select public.app_pickem_claim('$B_PRIVATE','$B1')")" "PICKEM_REWARD_INELIGIBLE"
# Carrera worker legacy (Champions 2026) + reclamo 2.0 de una madura.
for i in $(seq 1 10); do
  docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_score_pickem_event('$LEG'); select public.app_grant_reward(p_user => '$VR', p_ref => 'pickem:$LEG:participacion', p_reason => 'pickem_reward:participacion', p_credits => 500)->>'applied';" </dev/null > /tmp/$NAME.wr.$i 2>&1 &
  docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_pickem_claim('$M_ELITE','$B1')->>'applied'" </dev/null > /tmp/$NAME.cr.$i 2>&1 &
done; wait
check "carrera worker legacy + reclamo 2.0: 1 reclamo, 0 pagos legacy nuevos" "$(cat /tmp/$NAME.cr.* | grep -c '^true$')|$(cat /tmp/$NAME.wr.* | grep -c '^true$')" "1|0"
check "ÉLITE madura: Masters SIN insignia" "$(qty "$M_ELITE" masters)|$(P "select count(*) from public.user_cosmetics where user_id='$M_ELITE'")" "1|0"
check "reclamos totales = solo los 4 elegibles" "$(P "select count(*) from public.pickem_bracket_claims where bracket_id='$B1'")" "4"
check "ningún asiento 2.0 trae créditos" "$(P "select coalesce(sum(delta),0) from public.credit_transactions where ref like 'pickem_bracket:%'")" "0"
check "rol de cliente: no lee elegibilidad" "$(E "set role authenticated; select public.app_pickem_reward_eligibility('$F_PERFECT','$B1')")" "permission denied"
check "rol de cliente: no reclama" "$(E "set role authenticated; select public.app_pickem_claim('$F_PERFECT','$B1')")" "permission denied"
check "rol de cliente: no toca recompensas" "$(E "set role authenticated; update public.pickem_brackets set rewards_status='ACTIVE' where id='$B4'")" "permission denied"

# ═══════════════ cuentas reales ═══════════════
check "davex y ValoRosters: economía idéntica tras TODO el ensayo" "$(P "$REAL_FP")" "$REAL_BEFORE"
check "ValoRosters: sus 500 históricos siguen siendo el mismo asiento" "$(P "$VR500")" "$VR500_BEFORE"

# ═══════════════ rollback y reaplicación ═══════════════
RB0=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/f872/0073_pickems_launch_guard.ROLLBACK.sql </dev/null 2>&1); RB0C=$?
check "rollback con recompensas ACTIVAS → se niega" "$RB0C|$(echo "$RB0" | grep -c 'recompensas 2.0 ACTIVAS')" "3|1"
# Con predicciones cerradas las recompensas están congeladas (0071): en la copia se desactivan como OPERADOR
# (superusuario, sin disparadores). Es la única vía para un rollback con un evento premiado en curso: documentado.
echo "operador: $(P "begin; alter table public.pickem_brackets disable trigger user; update public.pickem_brackets set rewards_status='OFF', rewards = jsonb_set(rewards, '{status}', to_jsonb('OFF'::text)) where rewards_status='ACTIVE'; alter table public.pickem_brackets enable trigger user; commit;" | tr '
' ' ')"
check "operador: 0 ámbitos con recompensas ACTIVAS en la copia" "$(P "select count(*) from public.pickem_brackets where rewards_status='ACTIVE'")" "0"
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/f872/0073_pickems_launch_guard.ROLLBACK.sql </dev/null 2>&1); RRC=$?
check "rollback sin recompensas activas (exit)" "$RRC" "0"
[ "$RRC" = 0 ] || echo "$RB" | tail -3
check "rollback: 5 guardias de 0072 siguen, sin funciones de 0073" "$(P "select count(*) from pg_trigger where tgname in ('pickem_events_legacy_guard','pickem_submissions_legacy_guard','credit_tx_pickem_legacy_guard','pickem_brackets_rewards_guard','pickem_claims_authority_guard')")|$(P "select to_regprocedure('public.app_pickem_reward_eligibility(uuid, uuid, timestamptz)') is null")" "5|t"
check "rollback NO reabre la creación de legacy" "$(E "insert into public.pickem_events (event_id, title, locks_at, status) values ('$EVT', 'x', now() + interval '1 day', 'open')")" "PICKEM_LEGACY_RETIRED"
RA=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/f872/0073_pickems_launch_guard.sql </dev/null 2>&1); RAC=$?
check "0073 se vuelve a aplicar limpia" "$RAC" "0"
[ "$RAC" = 0 ] || echo "$RA" | tail -3
check "reaplicada: la fresca sigue sin poder cobrar" "$(E "insert into public.pickem_bracket_claims (bracket_id,user_id,tier,reward,ref,rewards_version,settlement_version) values ('$B1','$F_PERFECT','PERFECT','{}','x',3,1)")" "PICKEM_REWARD_INELIGIBLE"

echo
if [ "$FAILS" = 0 ]; then echo "DRYRUN_OK"; else echo "DRYRUN_FAIL ($FAILS)"; fi
