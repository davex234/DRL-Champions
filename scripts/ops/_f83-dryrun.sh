#!/usr/bin/env bash
# =============================================================================
# F83 · DRY-RUN de 0064 + CARRERAS REALES en Postgres + ROLLBACK — sobre una COPIA AISLADA. NUNCA toca producción.
# =============================================================================
#   (desde el PC)  scp 0064_season_track.sql 0064_season_track.ROLLBACK.sql t2config.json _f83-dryrun.sh nexusadmin@VPS:/tmp/f83/
#                  ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0064/<TS> bash /tmp/f83/_f83-dryrun.sh'
#
# 1. Postgres DESECHABLE (misma imagen, `--network none`) restaurado del backup pre-0064.
# 2. Huellas de las tablas de jugadores/economía/catálogo/F82/F89 antes y después (0064 no toca nada existente).
# 3. Ciclo de vida en BD: nace DRAFT; publicar; solape de dos publicadas rechazado; publicada inmutable; no se cancela
#    una que ya empezó; no se borra una publicada.
# 4. Carreras con usuarios SINTÉTICOS (solo en la copia), psql EN PARALELO:
#      A  20 aplicaciones del MISMO evento → 1 APPLIED, 19 REPEATED, 1 asiento
#      B  15 partidas distintas a la vez con tope diario 600 → exactamente 600 de XP de partidas
#      C  10 partidas que completan el MISMO reto a la vez → 1 asiento de reto
#      D  10 reclamos del MISMO nivel a la vez → 1 CLAIMED, 9 ALREADY, 1 fila
#      E  periodo viejo, nivel futuro, nivel sin recompensa, temporada terminada (XP no; reclamo sí en gracia; luego CLOSED)
# 5. Privilegios: anon/authenticated sin EXECUTE ni escritura; el jugador solo lee lo suyo.
# 6. Rollback (fichero) → fuera; 0063 intacta → 0064 se re-aplica limpia y es re-ejecutable.
# Salida: PASS/FAIL y `DRYRUN_OK` / `DRYRUN_FAIL`. El contenedor se borra pase lo que pase.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="f83-dryrun-$TS"
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
docker cp "$DIR/0064_season_track.sql" "$NAME:/tmp/0064.sql" >/dev/null
docker cp "$DIR/0064_season_track.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
docker cp "$DIR/t2config.json" "$NAME:/tmp/cfg.json" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0063: favorite_team_id existe" "$(P "select count(*) from information_schema.columns where table_name='player_profile_customization' and column_name='favorite_team_id'")" "1"
check "copia en 0063: sin game_seasons" "$(P "select to_regclass('public.game_seasons') is null")" "t"

TABLES="auth.users public.profiles public.user_cards public.user_packs public.user_game public.user_pass public.economy_ops public.credit_transactions public.content_cards public.duel_matches public.user_cosmetics public.user_achievements public.collection_sets public.user_collection_completions public.player_profile_customization public.mission_events public.user_mission_progress"
fingerprint() { for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
fingerprint > /tmp/$NAME.before
echo "== huellas antes: $(wc -l < /tmp/$NAME.before) tablas"
T0=$(date +%s%N)
APPLY=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0064.sql </dev/null 2>&1); RC=$?
check "0064 aplica en UNA transacción (exit)" "$RC" "0"
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms · $(echo "$APPLY" | grep -c ERROR) errores"
fingerprint > /tmp/$NAME.after
check "0064 no cambia NINGÚN dato existente (huellas)" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || echo distintas)" "iguales"
check "privilegios: anon/authenticated sin EXECUTE ni escritura" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) where has_function_privilege(n,'public.app_season_apply(uuid,text,text,text,int,int,jsonb,jsonb)','execute') or has_function_privilege(n,'public.app_season_claim(uuid,text,int)','execute') or has_table_privilege(n,'public.season_xp_ledger','insert') or has_table_privilege(n,'public.season_progress','update') or has_table_privilege(n,'public.season_reward_claims','insert') or has_table_privilege(n,'public.game_seasons','update')")" "0"
check "privilegios: anon no lee el progreso" "$(P "select has_table_privilege('anon','public.season_progress','select')::text")" "false"
echo "   políticas: $(P "select string_agg(tablename||' '||cmd||' '||coalesce(qual,'∅'), ' | ' order by tablename) from pg_policies where schemaname='public' and tablename like 'season%'")"
check "RLS: el jugador solo ve lo suyo (políticas de lectura propias)" "$(P "select count(*) from pg_policies where schemaname='public' and tablename in ('season_xp_ledger','season_progress','season_challenge_progress','season_reward_claims') and qual like '%uid() = user_id%'")" "4"

# ── 3 · ciclo de vida ──
ins() { P "insert into public.game_seasons (id, number, name, status, starts_at, ends_at, claim_until, max_level, config) values ('$1', $2, 'Ensayo $1', '$3', $4, $5, $6, 40, pg_read_file('/tmp/cfg.json')::jsonb)" 2>&1; }
check "nace DRAFT: insertar ya publicada se rechaza" "$(ins s-pub 90 PUBLISHED "now()" "now() + interval '30 days'" "now() + interval '40 days'" | grep -c GAME_SEASON_TRANSITION)" "1"
ins s-act 2 DRAFT "now() - interval '1 day'" "now() + interval '30 days'" "now() + interval '44 days'" >/dev/null
P "update public.game_seasons set status='PUBLISHED', checksum='dry', published_at=now() where id='s-act'" >/dev/null
check "publicar un borrador" "$(P "select status from public.game_seasons where id='s-act'")" "PUBLISHED"
ins s-over 3 DRAFT "now() + interval '10 days'" "now() + interval '50 days'" "now() + interval '60 days'" >/dev/null
check "dos publicadas solapadas: la BD lo impide" "$(P "update public.game_seasons set status='PUBLISHED', checksum='dry', published_at=now() where id='s-over'" 2>&1 | grep -c game_seasons_no_overlap)" "1"
check "publicada inmutable (config)" "$(P "update public.game_seasons set config='{}'::jsonb where id='s-act'" 2>&1 | grep -c GAME_SEASON_IMMUTABLE)" "1"
check "publicada inmutable (fechas)" "$(P "update public.game_seasons set ends_at = ends_at + interval '1 day' where id='s-act'" 2>&1 | grep -c GAME_SEASON_IMMUTABLE)" "1"
check "no se cancela una que ya empezó" "$(P "update public.game_seasons set status='CANCELLED', cancelled_at=now() where id='s-act'" 2>&1 | grep -c GAME_SEASON_TRANSITION)" "1"
check "no se borra una publicada" "$(P "delete from public.game_seasons where id='s-act'" 2>&1 | grep -c GAME_SEASON_IMMUTABLE)" "1"
check "publicar exige niveles = nivel máximo (forma)" "$(P "update public.game_seasons set max_level=41 where id='s-over'" >/dev/null; P "update public.game_seasons set status='PUBLISHED', checksum='x', published_at=now(), starts_at=now()+interval '200 days', ends_at=now()+interval '260 days', claim_until=now()+interval '270 days' where id='s-over'" 2>&1 | grep -c game_seasons_published_shape)" "1"

newuser() { local u; u=$(P "select gen_random_uuid()"); P "insert into auth.users (id,email,aud,role,instance_id) values ('$u','f83dry-$u@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')" >/dev/null; echo "$u"; }
DKEY="d:$(P "select to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD')")"
apply() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_season_apply('$1', 's-act', '$2', 'MATCH', $3, 600, '$4'::jsonb, '{}'::jsonb)->>'code'" </dev/null 2>&1; }

# ── 4 · carreras ──
UA=$(newuser)
for i in $(seq 1 20); do apply "$UA" "match:same" 70 "[]" > /tmp/$NAME.a.$i & done; wait
check "A · 20 veces el mismo evento → 1 APPLIED" "$(cat /tmp/$NAME.a.* | grep -c '^APPLIED$')" "1"
check "A · 19 REPEATED" "$(cat /tmp/$NAME.a.* | grep -c '^REPEATED$')" "19"
check "A · 1 asiento en el libro" "$(P "select count(*) from public.season_xp_ledger where user_id='$UA'")" "1"

UB=$(newuser)
for i in $(seq 1 15); do apply "$UB" "match:b$i" 70 "[]" > /tmp/$NAME.b.$i & done; wait
check "B · 15 partidas a la vez con tope 600 → 600 exactos" "$(P "select coalesce(sum(amount),0) from public.season_xp_ledger where user_id='$UB' and source='MATCH'")" "600"
check "B · progreso = libro" "$(P "select (select xp from public.season_progress where user_id='$UB') = (select sum(amount) from public.season_xp_ledger where user_id='$UB')")" "t"

UC=$(newuser)
OPS="[{\"challenge\":\"d-jugar-2\",\"period\":\"$DKEY\",\"op\":\"INC\",\"value\":1,\"target\":2,\"xp\":120}]"
for i in $(seq 1 10); do apply "$UC" "match:c$i" 40 "$OPS" > /tmp/$NAME.c.$i & done; wait
check "C · reto completado por 10 partidas a la vez → 1 asiento de reto" "$(P "select count(*) from public.season_xp_ledger where user_id='$UC' and source='CHALLENGE'")" "1"
check "C · progreso del reto topado en el objetivo" "$(P "select progress||'/'||target||':'||(completed_at is not null) from public.season_challenge_progress where user_id='$UC'")" "2/2:true"
STALE="[{\"challenge\":\"d-jugar-2\",\"period\":\"d:2020-01-01\",\"op\":\"INC\",\"value\":5,\"target\":2,\"xp\":120}]"
UE=$(newuser)
check "E · periodo viejo: no crea progreso de reto" "$(apply "$UE" "match:old" 40 "$STALE" >/dev/null; P "select count(*) from public.season_challenge_progress where user_id='$UE'")" "0"

UD=$(newuser)
docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_season_apply('$UD', 's-act', 'collection:big', 'COLLECTION', 20000, null, '[]'::jsonb, '{}'::jsonb)->>'code'" </dev/null >/dev/null
claim() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_season_claim('$1', '$2', $3)->>'code'" </dev/null 2>&1; }
check "E · nivel no alcanzado → LOCKED" "$(claim "$UA" s-act 10)" "LOCKED"
for i in $(seq 1 10); do claim "$UD" s-act 10 > /tmp/$NAME.d.$i & done; wait
check "D · 10 reclamos del mismo nivel → 1 CLAIMED" "$(cat /tmp/$NAME.d.* | grep -c '^CLAIMED$')" "1"
check "D · 9 ALREADY" "$(cat /tmp/$NAME.d.* | grep -c '^ALREADY$')" "9"
check "D · 1 fila de reclamo" "$(P "select count(*) from public.season_reward_claims where user_id='$UD'")" "1"
check "E · nivel fuera de rango → BAD_LEVEL" "$(claim "$UD" s-act 50)" "BAD_LEVEL"
check "E · nivel sin recompensa → NO_REWARD" "$(claim "$UD" s-act 1)" "NO_REWARD"
check "E · otro usuario no hereda el nivel → LOCKED" "$(claim "$UC" s-act 10)" "LOCKED"

# Temporada terminada (en gracia): sin XP; se reclama lo alcanzado; tras el plazo, CLOSED.
P "update public.game_seasons set status='CANCELLED', cancelled_at=now() where id='s-over'" >/dev/null 2>&1 || P "delete from public.game_seasons where id='s-over'" >/dev/null
ins s-old 7 DRAFT "now() - interval '60 days'" "now() - interval '30 days'" "now() + interval '5 days'" >/dev/null
P "update public.game_seasons set status='PUBLISHED', checksum='dry', published_at=now() where id='s-old'" >/dev/null
UF=$(newuser)
P "insert into public.season_progress (user_id, season_id, xp) values ('$UF', 's-old', 20000)" >/dev/null
check "E · temporada terminada: sin XP (INACTIVE)" "$(docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "select public.app_season_apply('$UF', 's-old', 'match:late', 'MATCH', 70, 600, '[]'::jsonb, '{}'::jsonb)->>'code'" </dev/null)" "INACTIVE"
check "E · en gracia se reclama lo alcanzado" "$(claim "$UF" s-old 10)" "CLAIMED"
ins s-arch 8 DRAFT "now() - interval '120 days'" "now() - interval '90 days'" "now() - interval '61 days'" >/dev/null
P "update public.game_seasons set status='PUBLISHED', checksum='dry', published_at=now() where id='s-arch'" >/dev/null
P "insert into public.season_progress (user_id, season_id, xp) values ('$UF', 's-arch', 20000)" >/dev/null
check "E · tras el plazo de reclamo → CLOSED" "$(claim "$UF" s-arch 10)" "CLOSED"
check "historial: progreso de temporadas anteriores intacto (no hay reinicio destructivo)" "$(P "select count(*) from public.season_progress where user_id='$UF'")" "2"

# ── 6 · rollback y re-aplicación ──
RB=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/rollback.sql </dev/null 2>&1); RC=$?
check "rollback (exit)" "$RC" "0"
check "rollback: sin tablas ni RPC de 0064" "$(P "select (to_regclass('public.game_seasons') is null and to_regclass('public.season_xp_ledger') is null and to_regprocedure('public.app_season_apply(uuid,text,text,text,int,int,jsonb,jsonb)') is null)::text")" "true"
check "rollback: 0063 intacta" "$(P "select count(*) from information_schema.columns where table_name='player_profile_customization' and column_name='favorite_team_id'")" "1"
RA=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0064.sql </dev/null 2>&1); RC=$?
check "re-aplicar 0064 tras rollback (exit)" "$RC" "0"
RA2=$(docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f /tmp/0064.sql </dev/null 2>&1); RC=$?
check "0064 es re-ejecutable (exit)" "$RC" "0"

if [ "$FAILS" = 0 ]; then echo "DRYRUN_OK"; else echo "DRYRUN_FAIL ($FAILS)"; fi
