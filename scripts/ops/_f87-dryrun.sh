#!/usr/bin/env bash
# =============================================================================
# F87 · ENSAYO de 0071 + FLUJOS Y CARRERAS REALES en Postgres + ROLLBACK — sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   (PC)  npx tsx scripts/ops/_f87-dryrun-data.mts <dir> > <dir>/setup.sql
#         scp 0071_pickems_bracket.sql 0071_pickems_bracket.ROLLBACK.sql <dir>/{setup.sql,picks.sql,expected.tsv,meta.env,rewards_g.json} _f87-dryrun.sh nexusadmin@VPS:/tmp/f87/
#   (VPS) SRC=/opt/nexus/backups/supabase-drlcards/pre-0071/<TS> bash /tmp/f87/_f87-dryrun.sh
#
# 1. Postgres DESECHABLE (misma imagen, `--network none`) restaurado del backup pre-0071; cabeza 0070 por estado real.
# 2. 0071 en UNA transacción; huellas de las tablas existentes antes/después (0071 no cambia ningún dato).
# 3. Ámbitos REALES de Champions 2026 (vlr-2766) con descriptores generados por el dominio TS:
#      G (grupos, terminados): ventana «abierta» simulada SOLO en la copia → picks por la RPC → resultados reales
#        restaurados → liquidación SQL comparada con la puntuación TS (paridad) → reclamos (20 en paralelo) →
#        corrección de la fuente → reliquidación sin duplicar nada.
#      P (playoffs, por jugar): cierre en la frontera −1 ms / 0 / +1 ms (reloj de la BD), estado real, reprogramación
#        a más tarde (no reabre), reapertura auditada, VOID, versiones (dos pestañas), 20 picks idénticos, limpieza de
#        descendientes, ataques (equipo/partido/ámbito falsos, roles de cliente, actor no admin), guardias de congelación.
# 4. Borrado de una cuenta con picks y reclamo (la cascada no se bloquea).
# 5. Rollback (fichero) → objetos fuera → 0071 se vuelve a aplicar limpia.
# Usuarios SINTÉTICOS `@example.invalid` solo en la copia. Salida: PASS/FAIL y DRYRUN_OK / DRYRUN_FAIL.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f87-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
# Código de error de una sentencia que DEBE fallar.
E() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1 | grep -oE 'PICKEM_[A-Z_]+|NOT_ADMIN|permission denied' | head -1; }
# Varias sentencias en UNA transacción (now() fijo): imprime la salida de la última.
T() { docker exec -i "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 2>&1 <<SQL
begin;
$1
rollback;
SQL
}
. "$DIR/meta.env"

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
docker exec "$NAME" mkdir -p /tmp/f87 </dev/null
for f in 0071_pickems_bracket.sql 0071_pickems_bracket.ROLLBACK.sql setup.sql picks.sql rewards_g.json; do docker cp "$DIR/$f" "$NAME:/tmp/f87/$f" >/dev/null; done
echo "== restaurado de $(basename "$DUMP") ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0070: alpha_feedback existe" "$(P "select to_regclass('public.alpha_feedback') is not null")" "t"
check "copia en 0070: sin pickem_brackets" "$(P "select to_regclass('public.pickem_brackets') is null")" "t"

TABLES="auth.users public.profiles public.user_cards public.user_packs public.credit_transactions public.user_cosmetics public.events public.stages public.matches public.teams public.pickem_events public.pickem_questions public.pickem_submissions public.pickem_answers public.pickem_scores public.content_audit_log public.duel_matches public.cups public.cup_matches public.alpha_feedback"
fingerprint() { for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
fingerprint > /tmp/$NAME.before
T0=$(date +%s%N)
APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/f87/0071_pickems_bracket.sql </dev/null 2>&1); RC=$?
check "0071 aplica en UNA transacción (exit)" "$RC" "0"
[ "$RC" = 0 ] || echo "$APPLY" | tail -5
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms"
fingerprint > /tmp/$NAME.after
check "0071 no cambia NINGÚN dato existente (huellas de $(wc -l < /tmp/$NAME.before) tablas)" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || echo distintas)" "iguales"
check "privilegios: anon/authenticated sin tablas ni RPC" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) where has_table_privilege(n,'public.pickem_brackets','select') or has_table_privilege(n,'public.pickem_bracket_picks','select') or has_table_privilege(n,'public.pickem_bracket_entries','select') or has_table_privilege(n,'public.pickem_bracket_claims','select') or has_function_privilege(n,'public.app_pickem_save_pick(uuid,uuid,text,text,int,text[])','execute') or has_function_privilege(n,'public.app_pickem_claim(uuid,uuid)','execute') or has_function_privilege(n,'public.app_pickem_admin_settle(uuid,uuid,int,text)','execute')")" "0"

# ─────────────── preparación: usuarios sintéticos + dos borradores reales ───────────────
IDS=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -f /tmp/f87/setup.sql </dev/null 2>&1)
G=$(echo "$IDS" | grep -E '^[0-9a-f-]{36}$' | sed -n 1p); PP=$(echo "$IDS" | grep -E '^[0-9a-f-]{36}$' | sed -n 2p)
check "borradores creados (2)" "$( [ -n "$G" ] && [ -n "$PP" ] && echo 2 || echo "$IDS" | tail -3)" "2"
check "perfiles sintéticos creados por el alta" "$(P "select count(*) from public.profiles where id in ('$QA1','$QA2','$QA3','$QA4')")" "4"
check "auditoría de creación (2 filas)" "$(P "select count(*) from public.content_audit_log where entity_type='pickem_bracket' and action='pickem_draft_create'")" "2"

# Ataques sobre BORRADOR.
check "pick en BORRADOR → NOT_OPEN" "$(E "select public.app_pickem_save_pick('$QA1','$G','753444','vlr-t-120',null,'{}')")" "PICKEM_NOT_OPEN"
check "actor NO admin → NOT_ADMIN" "$(E "select public.app_pickem_admin_set_status('$QA1','$G','publish',1,'$G_CHK',null)")" "NOT_ADMIN"
check "publicar con checksum falso → CHECKSUM" "$(E "select public.app_pickem_admin_set_status('$ADMIN','$G','publish',1,'$(printf 0%.0s $(seq 64))',null)")" "PICKEM_CHECKSUM"
check "versión vieja → STALE" "$(E "select public.app_pickem_admin_set_status('$ADMIN','$G','publish',99,'$G_CHK',null)")" "PICKEM_STALE"

# ═══════════════ G · FASE DE GRUPOS (REAL, TERMINADA) ═══════════════
check "recompensas ACTIVAS sin aceptar el pasivo → rechazo" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$G',pg_read_file('/tmp/f87/rewards_g.json')::jsonb,'ACTIVE','x',1,false)")" "PICKEM_ACTIVATION_REQUIRES_ACK"
check "recompensas ACTIVAS (borrador, antes de publicar)" "$(P "select public.app_pickem_admin_set_rewards('$ADMIN','$G',pg_read_file('/tmp/f87/rewards_g.json')::jsonb,'ACTIVE','x',1,true)->>'rewardsStatus'")" "ACTIVE"
# Ventana «abierta» SOLO en la copia: se guarda el estado real y se pone el partido por jugar en el futuro.
P "create table public._f87_saved as select id, status, start_time, winner_team_id, score_a, score_b from public.matches where stage_id = (select stage_ids[1]::uuid from public.pickem_brackets where id='$G')" >/dev/null
P "update public.matches m set status='upcoming', winner_team_id=null, score_a=null, score_b=null, start_time = now() + interval '3 days' + (match_order || ' minutes')::interval from public._f87_saved s where s.id = m.id" >/dev/null
check "publicar G" "$(P "select public.app_pickem_admin_set_status('$ADMIN','$G','publish',1,'$G_CHK',null)->>'status'")" "PUBLISHED"
check "nodos de G = 20, cierre congelado" "$(P "select count(*)||'/'||count(*) filter (where lock_at > now()) from public.pickem_bracket_matches where bracket_id='$G'")" "20/20"
OKS=$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -v gid="$G" -f /tmp/f87/picks.sql </dev/null 2>&1 | grep -c '^true$')
check "picks por la RPC ($N_PICKS)" "$OKS" "$N_PICKS"
check "recompensas congeladas mientras nada ha cerrado: cambio AÚN permitido" "$(P "select public.app_pickem_admin_set_rewards('$ADMIN','$G',pg_read_file('/tmp/f87/rewards_g.json')::jsonb,'ACTIVE','x',2,true)->>'rewardsVersion'")" "3"
# Vuelve la realidad (resultados reales restaurados).
P "update public.matches m set status=s.status, start_time=s.start_time, winner_team_id=s.winner_team_id, score_a=s.score_a, score_b=s.score_b from public._f87_saved s where s.id=m.id" >/dev/null
check "tras el inicio real: pick → LOCKED" "$(E "select public.app_pickem_save_pick('$QA4','$G','753444','vlr-t-120',null,'{}')")" "PICKEM_LOCKED"
check "recompensas tras el primer cierre → FROZEN" "$(E "select public.app_pickem_admin_set_rewards('$ADMIN','$G',pg_read_file('/tmp/f87/rewards_g.json')::jsonb,'OFF','x',3,true)")" "PICKEM_REWARDS_FROZEN"
check "descriptor publicado → FROZEN" "$(E "update public.pickem_brackets set max_points = 99 where id='$G'")" "PICKEM_FROZEN"
check "cierre de un nodo → FROZEN" "$(E "update public.pickem_bracket_matches set lock_at = now() + interval '9 days' where bracket_id='$G' and match_id='753444'")" "PICKEM_FROZEN"
check "insert directo de pick cerrado → LOCKED (guardia de tabla)" "$(E "insert into public.pickem_bracket_picks (bracket_id,user_id,match_id,team_id) values ('$G','$QA1','753444','vlr-t-14') on conflict (bracket_id,user_id,match_id) do update set team_id=excluded.team_id")" "PICKEM_LOCKED"
check "reclamar antes de liquidar → NOT_SETTLED" "$(E "select public.app_pickem_claim('$QA1','$G')")" "PICKEM_NOT_SETTLED"

check "liquidar G" "$(P "select public.app_pickem_admin_settle('$ADMIN','$G',0,null)->>'settlementVersion'")" "1"
# Paridad SQL ⇄ TS (expected.tsv, generado por el dominio TS).
while IFS=$'\t' read -r u pts cor comp ratio perf tier; do
  [ "$u" = "user" ] && continue
  ROW=$(P "select coalesce(final_points::text,'-')||' '||final_correct||' '||to_char(final_completion,'FM0.00000')||' '||to_char(final_ratio,'FM0.00000')||' '||case when final_perfect then 't' else 'f' end||' '||coalesce(final_tier,'') from public.pickem_bracket_entries where bracket_id='$G' and user_id='$u'")
  if [ "$u" = "$QA4" ]; then check "QA4 sin picks → sin participación" "${ROW:-sin-fila}" "sin-fila"; continue; fi
  check "paridad SQL⇄TS ${u: -1}" "$ROW" "$pts $cor $comp $ratio $perf $tier"
done < "$DIR/expected.tsv"
check "posición (empates por puntos y aciertos)" "$(P "select string_agg(right(user_id::text,1)||':'||final_position, ',' order by final_position, user_id) from public.pickem_bracket_entries where bracket_id='$G'")" "1:1,3:2,2:3"

check "QA3 (participación insuficiente) → NOT_ELIGIBLE" "$(E "select public.app_pickem_claim('$QA3','$G')")" "PICKEM_NOT_ELIGIBLE"
check "QA4 (sin entrada) → NOT_ELIGIBLE" "$(E "select public.app_pickem_claim('$QA4','$G')")" "PICKEM_NOT_ELIGIBLE"
MP0=$(P "select coalesce(sum(qty),0) from public.user_packs where user_id='$QA1' and pack_id='masters'")
for i in $(seq 1 20); do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_pickem_claim('$QA1','$G')->>'applied'" </dev/null > /tmp/$NAME.claim.$i 2>&1 & done; wait
check "20 reclamos simultáneos: 1 aplicado" "$(cat /tmp/$NAME.claim.* | grep -c '^true$')" "1"
check "20 reclamos simultáneos: 19 idempotentes" "$(cat /tmp/$NAME.claim.* | grep -c '^false$')" "19"
check "1 reclamo en la tabla" "$(P "select count(*) from public.pickem_bracket_claims where bracket_id='$G' and user_id='$QA1'")" "1"
check "1 asiento en el libro" "$(P "select count(*) from public.credit_transactions where user_id='$QA1' and ref='pickem_bracket:$G'")" "1"
check "+1 sobre Masters (PERFECT)" "$(P "select coalesce(sum(qty),0) - $MP0 from public.user_packs where user_id='$QA1' and pack_id='masters'")" "1"
check "insignia de Pick'em perfecto" "$(P "select count(*) from public.user_cosmetics where user_id='$QA1' and cosmetic_id='insignia:pickem:champions-2026-grupos-perfecto'")" "1"
check "créditos intactos (la recompensa no da créditos)" "$(P "select delta from public.credit_transactions where user_id='$QA1' and ref='pickem_bracket:$G'")" "0"
check "QA2 reclama PARTICIPATION (Bronce)" "$(P "select public.app_pickem_claim('$QA2','$G')->>'tier'")" "PARTICIPATION"
check "QA2 segundo reclamo: no aplica" "$(P "select public.app_pickem_claim('$QA2','$G')->>'applied'")" "false"
check "reclamo inmutable" "$(E "update public.pickem_bracket_claims set tier='ELITE' where user_id='$QA2'")" "PICKEM_CLAIM_IMMUTABLE"

# Corrección de la fuente DESPUÉS de reclamar: se reliquida sin pagar dos veces ni retirar nada.
LEDGER_BEFORE=$(P "select count(*) from public.credit_transactions where ref like 'pickem_bracket:%'")
P "update public.matches set winner_team_id = team_a_id, score_a = 2, score_b = 1 where id = '753455'" >/dev/null
check "reliquidar sin motivo → REASON_REQUIRED" "$(E "select public.app_pickem_admin_settle('$ADMIN','$G',1,null)")" "PICKEM_REASON_REQUIRED"
for i in $(seq 1 20); do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_pickem_admin_settle('$ADMIN','$G',1,'corrección de la fuente (ensayo)')->>'settlementVersion'" </dev/null > /tmp/$NAME.settle.$i 2>&1 & done; wait
check "20 reliquidaciones simultáneas: 1 aplicada" "$(cat /tmp/$NAME.settle.* | grep -c '^2$')" "1"
check "... 19 rechazadas por versión" "$(cat /tmp/$NAME.settle.* | grep -c 'PICKEM_STALE')" "19"
check "QA1 ya no es perfecto tras la corrección" "$(P "select final_perfect::text||' '||final_tier from public.pickem_bracket_entries where bracket_id='$G' and user_id='$QA1'")" "false ELITE"
check "sin asientos nuevos ni retirados" "$(P "select count(*) from public.credit_transactions where ref like 'pickem_bracket:%'")" "$LEDGER_BEFORE"
check "reclamos intactos (sin top-up ni clawback)" "$(P "select string_agg(right(user_id::text,1)||':'||tier, ',' order by user_id) from public.pickem_bracket_claims where bracket_id='$G'")" "1:PERFECT,2:PARTICIPATION"
check "auditoría de liquidaciones (settle + resettle)" "$(P "select count(*) from public.content_audit_log where entity_type='pickem_bracket' and action in ('pickem_settle','pickem_resettle')")" "2"

# ═══════════════ P · PLAYOFFS (POR JUGAR) ═══════════════
# Un cuarto (754731) ya «empezado» al publicar en la copia, para probar la reprogramación.
P "update public.matches set start_time = now() - interval '1 hour' where id = '754731'" >/dev/null
check "publicar P" "$(P "select public.app_pickem_admin_set_status('$ADMIN','$PP','publish',1,'$P_CHK',null)->>'status'")" "PUBLISHED"
check "P abierto: pick de cuartos" "$(P "select public.app_pickem_save_pick('$QA1','$PP','754732','vlr-t-1034',null,'{}')->>'revision'")" "1"
check "versión vieja (otra pestaña) → STALE" "$(P "select public.app_pickem_save_pick('$QA1','$PP','754732','vlr-t-14',0,'{}')->>'code'")" "STALE"
check "versión correcta → OK" "$(P "select public.app_pickem_save_pick('$QA1','$PP','754732','vlr-t-14',1,'{}')->>'revision'")" "2"
for i in 1 2; do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select coalesce(public.app_pickem_save_pick('$QA1','$PP','754733','vlr-t-624',2,'{}')->>'code','OK')" </dev/null > /tmp/$NAME.tab.$i 2>&1 & done; wait
check "dos pestañas con la misma versión: 1 OK + 1 STALE" "$(cat /tmp/$NAME.tab.* | sort | tr '\n' ' ')" "OK STALE "
for i in $(seq 1 20); do docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_pickem_save_pick('$QA2','$PP','754730','vlr-t-120',null,'{}')->>'ok'" </dev/null > /tmp/$NAME.same.$i 2>&1 & done; wait
check "20 picks idénticos: 20 OK" "$(cat /tmp/$NAME.same.* | grep -c '^true$')" "20"
check "... 1 fila, revisión 20" "$(P "select count(*)||'/'||(select revision from public.pickem_bracket_entries where bracket_id='$PP' and user_id='$QA2') from public.pickem_bracket_picks where bracket_id='$PP' and user_id='$QA2' and match_id='754730'")" "1/20"
# Frontera del cierre con el reloj de la BD (now() fijo dentro de la transacción).
check "cierre −1 ms antes → abierto" "$(T "update public.matches set start_time = now() + interval '1 millisecond' where id='754733'; select public.app_pickem_save_pick('$QA3','$PP','754733','vlr-t-624',null,'{}')->>'ok';" | tail -1)" "true"
check "cierre exacto (0) → LOCKED" "$(T "update public.matches set start_time = now() where id='754733'; select public.app_pickem_save_pick('$QA3','$PP','754733','vlr-t-624',null,'{}');" | grep -oE 'PICKEM_[A-Z_]+' | head -1)" "PICKEM_LOCKED"
check "cierre +1 ms después → LOCKED" "$(T "update public.matches set start_time = now() - interval '1 millisecond' where id='754733'; select public.app_pickem_save_pick('$QA3','$PP','754733','vlr-t-624',null,'{}');" | grep -oE 'PICKEM_[A-Z_]+' | head -1)" "PICKEM_LOCKED"
check "partido real en directo → LOCKED" "$(T "update public.matches set status='live' where id='754733'; select public.app_pickem_save_pick('$QA3','$PP','754733','vlr-t-624',null,'{}');" | grep -oE 'PICKEM_[A-Z_]+' | head -1)" "PICKEM_LOCKED"
# Reprogramación: cerrado una vez, cerrado (la fuente lo mueve a MÁS TARDE y no reabre).
P "update public.matches set start_time = now() + interval '5 hours' where id = '754731'" >/dev/null
check "reprogramado a más tarde tras cerrar → sigue LOCKED" "$(E "select public.app_pickem_save_pick('$QA3','$PP','754731','vlr-t-2059',null,'{}')")" "PICKEM_LOCKED"
check "reabrir sin motivo → REASON_REQUIRED" "$(E "select public.app_pickem_admin_match('$ADMIN','$PP','754731','reschedule',now() + interval '3 hours',null)")" "PICKEM_REASON_REQUIRED"
check "reapertura auditada por admin" "$(P "select public.app_pickem_admin_match('$ADMIN','$PP','754731','reschedule',now() + interval '3 hours','la fuente movió el partido (ensayo)')->>'action'")" "reschedule"
check "... ahora abierto" "$(P "select public.app_pickem_save_pick('$QA3','$PP','754731','vlr-t-2059',null,'{}')->>'ok'")" "true"
check "cierre manual auditado" "$(P "select public.app_pickem_admin_match('$ADMIN','$PP','754731','lock_now',null,'cierre manual de prueba')->>'action'")" "lock_now"
check "... cerrado" "$(E "select public.app_pickem_save_pick('$QA3','$PP','754731','vlr-t-11060',null,'{}')")" "PICKEM_LOCKED"
check "VOID auditado" "$(P "select public.app_pickem_admin_match('$ADMIN','$PP','754733','void',null,'la fuente anuló el partido (ensayo)')->>'action'")" "void"
check "... pick en anulado → LOCKED" "$(E "select public.app_pickem_save_pick('$QA2','$PP','754733','vlr-t-624',null,'{}')")" "PICKEM_LOCKED"
P "select public.app_pickem_admin_match('$ADMIN','$PP','754733','unvoid',null,'deshacer anulación (ensayo)')" >/dev/null
# Descendientes: cambiar cuartos borra la semifinal dependiente (la lista la calcula el servidor Node).
P "select public.app_pickem_save_pick('$QA2','$PP','754733','vlr-t-624',null,'{}')" >/dev/null
P "select public.app_pickem_save_pick('$QA2','$PP','754732','vlr-t-1034',null,'{}')" >/dev/null
P "select public.app_pickem_save_pick('$QA2','$PP','754735','vlr-t-1034',null,'{}')" >/dev/null
check "cambio aguas arriba con limpieza de descendientes" "$(P "select public.app_pickem_save_pick('$QA2','$PP','754732','vlr-t-14',null,array['754735','754737'])->>'cleared'")" '["754735"]'
check "... la semifinal ya no tiene pick" "$(P "select count(*) from public.pickem_bracket_picks where bracket_id='$PP' and user_id='$QA2' and match_id='754735'")" "0"
check "... el independiente sigue" "$(P "select team_id from public.pickem_bracket_picks where bracket_id='$PP' and user_id='$QA2' and match_id='754730'")" "vlr-t-120"
check "limpieza de un partido de otro ámbito → BAD_MATCH" "$(E "select public.app_pickem_save_pick('$QA2','$PP','754732','vlr-t-14',null,array['753444'])")" "PICKEM_BAD_MATCH"
# Ataques.
check "equipo TBD → BAD_TEAM" "$(E "select public.app_pickem_save_pick('$QA1','$PP','754730','vlr-t-tbd',null,'{}')")" "PICKEM_BAD_TEAM"
check "equipo inventado → BAD_TEAM" "$(E "select public.app_pickem_save_pick('$QA1','$PP','754730','equipo-falso',null,'{}')")" "PICKEM_BAD_TEAM"
check "partido inventado → BAD_MATCH" "$(E "select public.app_pickem_save_pick('$QA1','$PP','999999','vlr-t-120',null,'{}')")" "PICKEM_BAD_MATCH"
check "partido de otro ámbito → BAD_MATCH" "$(E "select public.app_pickem_save_pick('$QA1','$PP','753444','vlr-t-120',null,'{}')")" "PICKEM_BAD_MATCH"
check "ámbito inventado → NOT_FOUND" "$(E "select public.app_pickem_save_pick('$QA1',gen_random_uuid(),'754730','vlr-t-120',null,'{}')")" "PICKEM_NOT_FOUND"
check "rol authenticated no ejecuta la RPC" "$(E "set role authenticated; select public.app_pickem_save_pick('$QA1','$PP','754730','vlr-t-120',null,'{}')")" "permission denied"
check "rol anon no lee picks" "$(E "set role anon; select count(*) from public.pickem_bracket_picks")" "permission denied"
check "rol authenticated no reclama" "$(E "set role authenticated; select public.app_pickem_claim('$QA1','$G')")" "permission denied"
check "despublicar con jugadores → HAS_ENTRIES" "$(E "select public.app_pickem_admin_set_status('$ADMIN','$PP','unpublish',(select version from public.pickem_brackets where id='$PP'),null,null)")" "PICKEM_HAS_ENTRIES"
check "liquidar sin resultados → NOT_DECIDED" "$(E "select public.app_pickem_admin_settle('$ADMIN','$PP',0,null)")" "PICKEM_NOT_DECIDED"
check "reclamar en P (no liquidado) → NOT_SETTLED" "$(E "select public.app_pickem_claim('$QA1','$PP')")" "PICKEM_NOT_SETTLED"
check "cancelar sin motivo → REASON_REQUIRED" "$(E "select public.app_pickem_admin_set_status('$ADMIN','$PP','cancel',(select version from public.pickem_brackets where id='$PP'),null,null)")" "PICKEM_REASON_REQUIRED"
check "borrar un publicado → FROZEN" "$(E "delete from public.pickem_brackets where id='$PP'")" "PICKEM_FROZEN"
check "auditoría de partido (reabrir, cerrar, anular, desanular)" "$(P "select count(*) from public.content_audit_log where entity_type='pickem_bracket' and action like 'pickem_match_%'")" "4"

# ═══════════════ borrado de cuenta con picks y reclamo ═══════════════
check "borrar QA2 (picks + reclamo) no se bloquea" "$(P "delete from auth.users where id='$QA2'"; P "select count(*) from public.pickem_bracket_entries where user_id='$QA2'")" "0"

# ═══════════════ rollback y reaplicación ═══════════════
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/f87/0071_pickems_bracket.ROLLBACK.sql </dev/null 2>&1); RRC=$?
check "rollback (exit)" "$RRC" "0"
check "rollback: objetos fuera" "$(P "select (to_regclass('public.pickem_brackets') is null and to_regprocedure('public.app_pickem_claim(uuid,uuid)') is null)::text")" "true"
check "rollback: lo concedido se queda (asientos)" "$(P "select (count(*) > 0)::text from public.credit_transactions where ref like 'pickem_bracket:%'")" "true"
RA=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/f87/0071_pickems_bracket.sql </dev/null 2>&1); RAC=$?
check "0071 se vuelve a aplicar limpia" "$RAC" "0"

echo
if [ "$FAILS" = 0 ]; then echo "DRYRUN_OK"; else echo "DRYRUN_FAIL ($FAILS)"; fi
