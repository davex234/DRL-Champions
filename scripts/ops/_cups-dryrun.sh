#!/usr/bin/env bash
# =============================================================================
# F86 · TORNEOS · ENSAYO de 0069 sobre COPIA AISLADA del backup (red ninguna). NUNCA toca producción.
#   ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0069/<TS> bash /tmp/cups/_cups-dryrun.sh'
# (con /tmp/cups/0069_player_cups.sql, /tmp/cups/0069_player_cups.ROLLBACK.sql y /tmp/cups/_cups-expected.tsv)
#
# Cubre: datos existentes intactos · idempotencia · guardias (estado, ganador, seed, cuadro, borrado, trofeo doble) ·
# privilegios de cliente · inscripción/retirada/carrera de capacidad 63+20 · 20 inscripciones del mismo usuario ·
# 20 «generar» · paridad con el dominio TS en los 61 tamaños 4–64 (ronda 1, seeds, campeón) · invariantes del cuadro ·
# 20 liquidaciones del mismo resultado · empate retenido · abandono · plazo vencido · resolución admin con #TAG ·
# doble no presentado · final 20× → 1 campeón 1 trofeo · cancelaciones · aislamiento ranked/F83/F73/F85 · rollback.
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="cups-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
PR() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -c "$1" </dev/null 2>&1; }   # sin ON_ERROR_STOP: devuelve el error como texto
F() { docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f "$1" </dev/null 2>&1; }
code() { sed -n 's/.*"code": *"\([A-Z_]*\)".*/\1/p' | head -1; }
# Recuento de N respuestas concurrentes (una por fichero); una respuesta sin código cuenta como ERR y se enseña.
tally() { local f; for f in "$@"; do if grep -q '"code"' "$f"; then code < "$f"; else echo ERR; echo "   sin código en $f: $(head -c 300 "$f")" >&2; fi; done | sort | uniq -c | awk '{print $2"="$1}' | sort | tr '\n' ' '; }

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
docker cp "$DIR/0069_player_cups.sql" "$NAME:/tmp/0069.sql" >/dev/null
docker cp "$DIR/0069_player_cups.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
docker cp "$DIR/_cups-expected.tsv" "$NAME:/tmp/expected.tsv" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0068: profiles.public_tag existe" "$(P "select count(*) from information_schema.columns where table_name='profiles' and column_name='public_tag'")" "1"
check "copia sin rastro de 0069" "$(P "select count(*) from pg_class where relname in ('cups','cup_registrations','cup_matches')")" "0"
TABLES="auth.users public.profiles public.user_cards public.user_game public.game_state public.user_packs public.credit_transactions public.duel_pvp_ratings public.duel_pvp_rating_events public.competitive_season_players public.duel_friendships public.social_blocks public.duel_challenges public.duel_matches public.content_audit_log public.player_profile_customization public.user_cosmetics public.user_collection_completions public.game_seasons public.season_xp_ledger public.mission_events public.user_mission_progress public.tournaments"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
fp > /tmp/$NAME.before
N=$(P "select count(*) from public.profiles")
echo "== $N perfiles · huellas de $(wc -l < /tmp/$NAME.before) tablas"

T0=$(date +%s%N); OUT=$(F /tmp/0069.sql); RC=$?
check "0069 aplica en UNA transacción (exit)" "$RC" "0"; [ "$RC" = 0 ] || { echo "$OUT" | tail -8; echo "DRYRUN_FAIL 0069 no aplica"; exit 1; }
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms"
fp > /tmp/$NAME.after
check "0069 no cambia NINGÚN dato existente (cuentas, inventario, economía, ranked, social, auditoría, temporada, misiones, trofeos, esports)" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || (diff /tmp/$NAME.before /tmp/$NAME.after | head -4; echo distintas))" "iguales"
OUT=$(F /tmp/0069.sql); check "IDEMPOTENTE: reaplicar 0069 (exit)" "$?" "0"
check "torneos vacíos tras aplicar (0 copas, 0 inscripciones, 0 cruces)" "$(P "select (select count(*) from cups)||'|'||(select count(*) from cup_registrations)||'|'||(select count(*) from cup_matches)")" "0|0|0"

echo "== privilegios de cliente (RLS / grants)"
check "authenticated NO lee cups / cup_matches / cup_registrations" "$(P "select has_table_privilege('authenticated','public.cups','SELECT')::text||has_table_privilege('authenticated','public.cup_matches','SELECT')::text||has_table_privilege('anon','public.cup_registrations','SELECT')::text")" "falsefalsefalse"
check "authenticated/anon NO ejecutan las RPC (registrar, liquidar, generar, resolver)" "$(P "select has_function_privilege('authenticated','public.cup_register(uuid,uuid)','EXECUTE')::text||has_function_privilege('authenticated','public.cup_settle_game(uuid)','EXECUTE')::text||has_function_privilege('anon','public.cup_generate(uuid,uuid)','EXECUTE')::text||has_function_privilege('authenticated','public.cup_admin_resolve(uuid,uuid,text,text,text)','EXECUTE')::text")" "falsefalsefalsefalse"
check "RLS activada en las tres tablas" "$(P "select count(*) from pg_class where relname in ('cups','cup_registrations','cup_matches') and relrowsecurity")" "3"

echo "== mundo de prueba: 84 cuentas QA con mazo y rating fijo (empates y sin ranked)"
P "insert into auth.users (id,email,aud,role,instance_id,raw_user_meta_data)
   select ('c0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid, 'cupqa'||i||'@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000', jsonb_build_object('username','cupqa_'||i)
     from generate_series(1,84) i" >/dev/null
P "insert into public.duel_decks (id, user_id, name) select ('d0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid, ('c0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid, 'qa' from generate_series(1,84) i" >/dev/null
P "begin; select set_config('drl.rating_writer','correct',true); insert into public.duel_pvp_ratings (user_id, rating, games_played, wins, losses, draws)
   select ('c0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid, 1300 - (i/3)*10, 12, 6, 6, 0 from generate_series(1,84) i where i % 5 <> 0
   on conflict (user_id) do update set rating = excluded.rating; commit;" >/dev/null
check "ratings de prueba escritos (68 con ranked, 16 sin ranked)" "$(P "select count(*) from duel_pvp_ratings where user_id::text like 'c0000000-%'")" "68"
check "84 perfiles QA con tag" "$(P "select count(*) from profiles where id::text like 'c0000000-%' and public_tag is not null")" "84"
ADMIN=$(P "select id from profiles where is_admin order by id limit 1")
[ -n "$ADMIN" ] || { echo "DRYRUN_FAIL sin admin en la copia"; exit 1; }
U() { printf 'c0000000-0000-4000-8000-%012d' "$1"; }
CUPID() { printf 'cccccccc-0000-4000-8000-%012d' "$1"; }
# Funciones SOLO del ensayo (no están en 0069): crear/publicar una copa, mover sus fechas como un operador y jugar un cruce.
P "create or replace function qa_cup(p_id uuid, p_slug text, p_max int, p_min int default 4) returns uuid language plpgsql as \$q\$
begin
  insert into cups (id, slug, name, rules, registration_open_at, registration_close_at, starts_at, round_window_minutes, min_participants, max_participants, created_by)
  values (p_id, p_slug, 'Copa '||p_slug, 'Eliminación directa a partida única.', now() - interval '1 hour', now() + interval '1 hour', now() + interval '2 hours', 60, p_min, p_max, null);
  return p_id;
end \$q\$;
create or replace function qa_close(p_cup uuid) returns void language plpgsql as \$q\$
begin
  perform set_config('drl.cup_writer','on',true);
  update cups set registration_open_at = now() - interval '3 hours', registration_close_at = now() - interval '1 second', starts_at = now() - interval '1 second' where id = p_cup;
  perform set_config('drl.cup_writer','',true);
end \$q\$;
create or replace function qa_deck(p_user uuid) returns uuid language sql as \$q\$ select ('d'||substr(p_user::text,2))::uuid \$q\$;
create or replace function qa_play(p_match uuid, p_result text) returns text language plpgsql as \$q\$
declare m cup_matches%rowtype; r1 jsonb; r2 jsonb; g uuid;
begin
  select * into m from cup_matches where id = p_match;
  -- El ensayo no espera ventanas reales: abre la ventana del cruce como lo haría el paso del tiempo.
  perform set_config('drl.cup_writer','on',true);
  update cup_matches set available_at = least(available_at, now() - interval '1 minute'), deadline_at = greatest(deadline_at, now() + interval '1 hour') where id = p_match;
  perform set_config('drl.cup_writer','',true);
  r1 := cup_ready(m.player_a, p_match, qa_deck(m.player_a), 30);
  r2 := cup_ready(m.player_b, p_match, qa_deck(m.player_b), 30);
  if r2->>'code' <> 'START' then return 'NO_START:'||(r1->>'code')||'/'||(r2->>'code'); end if;
  g := (r2->>'gameMatchId')::uuid;
  insert into duel_matches (id, mode, user_id, player_b_id, deck_id, deck_b_id, difficulty, status, state, rng, rules_version)
  values (g, 'PVP_PRIVATE', m.player_a, m.player_b, qa_deck(m.player_a), qa_deck(m.player_b), 'NORMAL', 'IN_PROGRESS', '{}'::jsonb, '{}'::jsonb, 'duel-combat-2');
  perform cup_mark_active(p_match, g);
  if p_result in ('A','B') then
    update duel_matches set status = 'COMPLETED', winner = p_result, state = jsonb_build_object('result', jsonb_build_object('scoreA', case when p_result='A' then 6 else 4 end, 'scoreB', case when p_result='A' then 4 else 6 end)) where id = g;
  elsif p_result = 'DRAW' then update duel_matches set status = 'DRAW', winner = null where id = g;
  elsif p_result = 'ABANDON_A' then update duel_matches set closed_reason = 'ABANDONED', closed_by = m.player_a, closed_at = now() where id = g;
  elsif p_result = 'LIVE' then return g::text;
  end if;
  return g::text;
end \$q\$;
create or replace function qa_violations(p_cup uuid) returns int language plpgsql as \$q\$
declare v int := 0; c cups%rowtype; x int;
begin
  select * into c from cups where id = p_cup;
  select count(*) into x from cup_matches where cup_id = p_cup; if c.bracket_size is not null and x <> c.bracket_size - 1 then v := v + 1; end if;
  select count(*) into x from (select round, p from (select round, player_a p from cup_matches where cup_id = p_cup union all select round, player_b from cup_matches where cup_id = p_cup) z where p is not null group by round, p having count(*) > 1) q; v := v + x;
  select count(*) into x from cup_matches m join cup_matches s on s.next_match_id = m.id
   where m.cup_id = p_cup and (case when s.next_side = 'A' then m.player_a else m.player_b end) is distinct from
         (case when s.status in ('COMPLETED','BYE','VOID') then s.winner_id else null end); v := v + x;
  select count(*) into x from cup_matches m join cup_matches s on s.next_match_id = m.id
   where m.cup_id = p_cup and s.status not in ('COMPLETED','BYE','VOID','CANCELLED') and (case when s.next_side = 'A' then m.a_empty or m.player_a is not null else m.b_empty or m.player_b is not null end); v := v + x;
  select count(*) into x from cup_registrations where cup_id = p_cup and placement = 'CHAMPION'; if x > 1 then v := v + 1; end if;
  if c.status = 'COMPLETED' and c.champion_id is distinct from (select winner_id from cup_matches where cup_id = p_cup and next_match_id is null) then v := v + 1; end if;
  select count(*) into x from user_cosmetics where cosmetic_id = 'insignia:torneo:'||c.slug; if x > 1 or (c.champion_id is not null and x <> 1) then v := v + 1; end if;
  return v;
end \$q\$;
create or replace function qa_run(p_cup uuid) returns int language plpgsql as \$q\$
declare m cup_matches%rowtype; n int := 0; r text;
begin
  loop
    select * into m from cup_matches where cup_id = p_cup and status = 'READY' order by round, slot limit 1;
    exit when not found;
    r := qa_play(m.id, case when m.seed_a < m.seed_b then 'A' else 'B' end);
    if r like 'NO_START%' then raise exception 'qa_run: %', r; end if;
    perform cup_settle_game(r::uuid);
    n := n + 1;
    exit when n > 200;
  end loop;
  return n;
end \$q\$;" >/dev/null
fp > /tmp/$NAME.world   # huella tras montar el mundo: el aislamiento se mide desde aquí

echo "== guardias de escritura (también service_role / superusuario)"
C1=$(CUPID 9001)
check "crear un borrador (sin bandera) funciona" "$(P "select qa_cup('$C1','qa-guard', 8) is not null")" "t"
check "identificador (slug) ÚNICO: otro borrador con el mismo slug → cups_slug_key" "$(PR "select qa_cup(gen_random_uuid(),'qa-guard', 8)" | grep -o cups_slug_key | head -1)" "cups_slug_key"
check "nacer PUBLICADO sin pasar por la RPC → CUP_WRITE_FORBIDDEN" "$(PR "insert into cups (slug,name,registration_open_at,registration_close_at,starts_at,round_window_minutes,max_participants,status,published_at) values ('qa-x','Copa x',now(),now()+interval '1h',now()+interval '2h',60,8,'PUBLISHED',now())" | grep -o CUP_WRITE_FORBIDDEN | head -1)" "CUP_WRITE_FORBIDDEN"
check "publicar a mano (UPDATE status) → CUP_WRITE_FORBIDDEN" "$(PR "update cups set status='PUBLISHED', published_at=now() where id='$C1'" | grep -o CUP_WRITE_FORBIDDEN | head -1)" "CUP_WRITE_FORBIDDEN"
check "un no-admin no publica (NOT_ADMIN)" "$(PR "select cup_admin_publish('$(U 1)','$C1',(select version from cups where id='$C1'))" | grep -o NOT_ADMIN | head -1)" "NOT_ADMIN"
check "publicar con versión vieja → STALE_CUP" "$(PR "select cup_admin_publish('$ADMIN','$C1',-1)" | grep -o STALE_CUP | head -1)" "STALE_CUP"
check "admin publica (versión actual)" "$(P "select cup_admin_publish('$ADMIN','$C1',(select version from cups where id='$C1'))" | code)" "PUBLISHED"
check "publicado: cambiar el máximo → CUP_LOCKED" "$(PR "update cups set max_participants=16 where id='$C1'" | grep -o CUP_LOCKED | head -1)" "CUP_LOCKED"
check "publicado: cambiar fechas → CUP_LOCKED" "$(PR "update cups set starts_at=starts_at+interval '1 day' where id='$C1'" | grep -o CUP_LOCKED | head -1)" "CUP_LOCKED"
check "publicado: corregir la descripción (texto) sí" "$(P "update cups set description='Texto corregido' where id='$C1' returning description")" "Texto corregido"
check "borrar un torneo publicado → CUP_IMMUTABLE" "$(PR "delete from cups where id='$C1'" | grep -o CUP_IMMUTABLE | head -1)" "CUP_IMMUTABLE"
check "insertar una inscripción a mano → CUP_WRITE_FORBIDDEN" "$(PR "insert into cup_registrations (cup_id,user_id) values ('$C1','$(U 1)')" | grep -o CUP_WRITE_FORBIDDEN | head -1)" "CUP_WRITE_FORBIDDEN"
check "tabla de logs con la publicación auditada (actor = admin)" "$(P "select count(*) from content_audit_log where action='cup_published' and entity_id='$C1' and actor='$ADMIN'")" "1"

echo "== inscripción: exactamente una vez, retirada, carrera de capacidad"
check "inscribir (REGISTERED)" "$(P "select cup_register('$(U 1)','$C1')" | code)" "REGISTERED"
check "repetir → ALREADY_REGISTERED" "$(P "select cup_register('$(U 1)','$C1')" | code)" "ALREADY_REGISTERED"
check "retirarse con la inscripción abierta" "$(P "select cup_withdraw('$(U 1)','$C1')" | code)" "WITHDRAWN"
check "volver a inscribirse (misma fila, sin duplicar)" "$(P "select cup_register('$(U 1)','$C1')::text||'|'||(select count(*) from cup_registrations where cup_id='$C1')" | sed 's/.*"code": *"\([A-Z_]*\)".*|/\1|/')" "REGISTERED|1"
for i in $(seq 1 20); do ( P "select cup_register('$(U 2)','$C1')" > /tmp/$NAME.same.$i ) & done; wait
check "20 inscripciones simultáneas del MISMO usuario → 1 fila, contador +1" "$(P "select (select count(*) from cup_registrations where cup_id='$C1' and user_id='$(U 2)')||'|'||(select participant_count from cups where id='$C1')||'|'||(select count(*) from cup_registrations where cup_id='$C1' and status='REGISTERED')")" "1|2|2"
check "… respuestas: 1 REGISTERED + 19 ALREADY_REGISTERED" "$(tally /tmp/$NAME.same.*)" "ALREADY_REGISTERED=19 REGISTERED=1 "
for i in $(seq 1 20); do ( if [ $((i % 2)) = 0 ]; then P "select cup_register('$(U 3)','$C1')"; else P "select cup_withdraw('$(U 3)','$C1')"; fi > /tmp/$NAME.rw.$i ) & done; wait
check "inscribir ‖ retirar (20 a la vez) → un estado canónico y el contador cuadra" "$(P "select ((select participant_count from cups where id='$C1') = (select count(*) from cup_registrations where cup_id='$C1' and status='REGISTERED'))::text||'|'||(select count(*) from cup_registrations where cup_id='$C1' and user_id='$(U 3)')")" "true|1"
C64=$(CUPID 9064)
P "select qa_cup('$C64','qa-capacity', 64)" >/dev/null; P "select cup_admin_publish('$ADMIN','$C64',(select version from cups where id='$C64'))" >/dev/null
P "select cup_register(('c0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$C64') from generate_series(1,63) i" >/dev/null
check "63/64 inscritos" "$(P "select participant_count from cups where id='$C64'")" "63"
for i in $(seq 64 83); do ( P "select cup_register('$(U $i)','$C64')" > /tmp/$NAME.cap.$i ) & done; wait
check "CARRERA 63 + 20 a la vez → exactamente 64, nunca 65" "$(P "select (select participant_count from cups where id='$C64')||'|'||(select count(*) from cup_registrations where cup_id='$C64' and status='REGISTERED')")" "64|64"
check "… respuestas: 1 REGISTERED + 19 FULL" "$(tally /tmp/$NAME.cap.*)" "FULL=19 REGISTERED=1 "
check "contador forzado por encima del máximo → CHECK cups_capacity" "$(PR "begin; select set_config('drl.cup_writer','on',true); update cups set participant_count = 65 where id='$C64'; rollback;" | grep -o cups_capacity | head -1)" "cups_capacity"
check "una cuenta sancionada no se inscribe (SANCTIONED)" "$(P "insert into user_sanctions (user_id,type,reason,created_by,expires_at) values ('$(U 84)','suspension','QA del ensayo F86','$ADMIN',now()+interval '1 day'); select cup_register('$(U 84)','$C1')" | code)" "SANCTIONED"
check "inscribirse a un BORRADOR → NOT_FOUND (no se revela)" "$(P "select qa_cup('$(CUPID 9002)','qa-draft', 8); select cup_register('$(U 5)','$(CUPID 9002)')" | code)" "NOT_FOUND"

echo "== generación del cuadro: una vez"
check "generar con la inscripción ABIERTA → REGISTRATION_OPEN (nada se crea)" "$(P "select cup_generate('$C64', null)" | code)" "REGISTRATION_OPEN"
P "select qa_close('$C64')" >/dev/null
check "cerrada: retirarse ya no se puede (CLOSED)" "$(P "select cup_withdraw('$(U 1)','$C64')" | code)" "CLOSED"
check "cerrada: inscribirse ya no se puede (CLOSED)" "$(P "select cup_register('$(U 84)','$C64')" | code)" "CLOSED"
for i in $(seq 1 20); do ( P "select cup_generate('$C64', null)" > /tmp/$NAME.gen.$i ) & done; wait
check "20 «generar» a la vez → 1 GENERATED + 19 ALREADY" "$(tally /tmp/$NAME.gen.*)" "ALREADY=19 GENERATED=1 "
check "un solo cuadro: 63 cruces, 6 rondas, seeds 1..64 únicos, una auditoría" "$(P "select (select count(*) from cup_matches where cup_id='$C64')||'|'||(select rounds from cups where id='$C64')||'|'||(select count(distinct seed) from cup_registrations where cup_id='$C64' and seed between 1 and 64)||'|'||(select count(*) from content_audit_log where action='cup_bracket_generated' and entity_id='$C64')")" "63|6|64|1"
check "invariantes del cuadro recién generado" "$(P "select qa_violations('$C64')")" "0"
check "foto de rating guardada en cada inscripción (seed_rating)" "$(P "select count(*) from cup_registrations where cup_id='$C64' and seed_rating is not null and tag_snapshot is not null")" "64"
SEED63=$(P "select seed||'|'||seed_rating from cup_registrations where cup_id='$C64' and user_id='$(U 63)'")
P "begin; select set_config('drl.rating_writer','correct',true); update duel_pvp_ratings set rating = 2500 where user_id = '$(U 63)'; commit;" >/dev/null
check "cambiar el rating DESPUÉS no mueve el cuadro (sin re-siembra; la foto se queda)" "$(P "select seed||'|'||seed_rating from cup_registrations where cup_id='$C64' and user_id='$(U 63)'")" "$SEED63"
check "… y cup_generate otra vez → ALREADY, mismos seeds" "$(P "select cup_generate('$C64', '$ADMIN')" | code)" "ALREADY"
check "escribir un ganador a mano (service/superusuario) → CUP_WRITE_FORBIDDEN" "$(PR "update cup_matches set winner_id = player_a, status='COMPLETED' where cup_id='$C64' and round=1 and slot=0" | grep -o CUP_WRITE_FORBIDDEN | head -1)" "CUP_WRITE_FORBIDDEN"
check "cambiar un seed a mano → CUP_WRITE_FORBIDDEN" "$(PR "update cup_registrations set seed = 1 where cup_id='$C64' and seed = 64" | grep -o CUP_WRITE_FORBIDDEN | head -1)" "CUP_WRITE_FORBIDDEN"

echo "== jugar: «listo», partida única, resultado del motor, 20 liquidaciones"
M=$(P "select id from cup_matches where cup_id='$C64' and round=1 and slot=0")
A=$(P "select player_a from cup_matches where id='$M'"); B=$(P "select player_b from cup_matches where id='$M'")
check "un tercero no puede marcarse listo en un cruce ajeno (NOT_FOUND)" "$(P "select cup_ready('$(U 84)','$M',qa_deck('$(U 84)'),30)" | code)" "NOT_FOUND"
check "A listo → WAITING (no hay partida aún)" "$(P "select cup_ready('$A','$M',qa_deck('$A'),30)" | code)" "WAITING"
check "A otra vez → WAITING (sigue sin partida)" "$(P "select cup_ready('$A','$M',qa_deck('$A'),30)::text||'|'||coalesce((select game_match_id::text from cup_matches where id='$M'),'none')" | sed 's/.*"code": *"\([A-Z_]*\)".*|/\1|/')" "WAITING|none"
for i in $(seq 1 10); do ( P "select cup_ready('$B','$M',qa_deck('$B'),30)" > /tmp/$NAME.rd.$i ) & done; wait
check "B listo 10× a la vez → UNA reserva de partida (1 START + 9 ALREADY con el mismo id)" "$(tally /tmp/$NAME.rd.*)" "ALREADY=9 START=1 "
G=$(P "select game_match_id from cup_matches where id='$M'")
check "… todas las respuestas apuntan a la MISMA partida" "$(cat /tmp/$NAME.rd.* | grep -o '"gameMatchId": *"[0-9a-f-]*"' | sort -u | wc -l)" "1"
P "insert into duel_matches (id, mode, user_id, player_b_id, deck_id, deck_b_id, difficulty, status, state, rng, rules_version) values ('$G','PVP_PRIVATE','$A','$B',qa_deck('$A'),qa_deck('$B'),'NORMAL','IN_PROGRESS','{}','{}','duel-combat-2')" >/dev/null
check "mark_active → ACTIVE (y repetirlo no hace nada)" "$(P "select cup_mark_active('$M','$G')" | code)/$(P "select cup_mark_active('$M','$G')" | code)" "ACTIVE/ALREADY_ACTIVE"
check "una segunda partida para el mismo cruce → UNIQUE(game_match_id)" "$(PR "begin; select set_config('drl.cup_writer','on',true); update cup_matches set game_match_id='$G' where cup_id='$C64' and round=1 and slot=1; rollback;" | grep -o 'cup_matches_game_match_id_key' | head -1)" "cup_matches_game_match_id_key"
check "liquidar con la partida EN JUEGO → NOT_FINISHED (nadie avanza)" "$(P "select cup_settle_game('$G')" | code)" "NOT_FINISHED"
NEXT=$(P "select next_match_id from cup_matches where id='$M'")
check "el cruce siguiente sigue esperando (lado vacío)" "$(P "select (player_a is null and not a_empty)::text from cup_matches where id='$NEXT'")" "true"
P "update duel_matches set status='COMPLETED', winner='B', state='{\"result\":{\"scoreA\":4,\"scoreB\":6}}' where id='$G'" >/dev/null
for i in $(seq 1 20); do ( P "select cup_settle_game('$G')" > /tmp/$NAME.st.$i ) & done; wait
check "20 liquidaciones del mismo resultado → 1 SETTLED + 19 ALREADY" "$(tally /tmp/$NAME.st.*)" "ALREADY=19 SETTLED=1 "
check "ganador = el del MOTOR (B), marcador real 4–6, perdedor eliminado en ronda 1" "$(P "select (winner_id='$B')::text||'|'||score_a||'-'||score_b||'|'||resolution from cup_matches where id='$M'")|$(P "select eliminated_round||':'||placement from cup_registrations where cup_id='$C64' and user_id='$A'")" "true|4-6|PLAYED|1:ROUND_OF_64"
check "el ganador avanza UNA vez al cruce siguiente (lado A)" "$(P "select (player_a='$B')::text from cup_matches where id='$NEXT'")" "true"
check "invariantes tras el primer resultado" "$(P "select qa_violations('$C64')")" "0"
check "un tercero / el perdedor no pueden marcarse listos en el siguiente cruce" "$(P "select cup_ready('$A','$NEXT',qa_deck('$A'),30)" | code)" "NOT_FOUND"
check "el siguiente cruce no se juega con el otro lado pendiente (NOT_READY)" "$(P "select cup_ready('$B','$NEXT',qa_deck('$B'),30)" | code)" "NOT_READY"

echo "== empate retenido, resolución admin con #TAG, abandono, plazo vencido, doble no presentado"
M2=$(P "select id from cup_matches where cup_id='$C64' and round=1 and slot=1")
G2=$(P "select qa_play('$M2','DRAW')"); P "select cup_settle_game('$G2')" >/dev/null
check "EMPATE → ACTION_REQUIRED (retenido) y la semifinal… no recibe a nadie" "$(P "select status from cup_matches where id='$M2'")|$(P "select (player_b is null and not b_empty)::text from cup_matches where id='$NEXT'")" "ACTION_REQUIRED|true"
B2=$(P "select player_b from cup_matches where id='$M2'"); TAGB2=$(P "select public_tag from profiles where id='$B2'"); TAGA2=$(P "select public_tag from profiles where id=(select player_a from cup_matches where id='$M2')")
check "resolver sin motivo → REASON_REQUIRED" "$(PR "select cup_admin_resolve('$ADMIN','$M2','B','corto','#$TAGB2')" | grep -o REASON_REQUIRED | head -1)" "REASON_REQUIRED"
check "resolver con el #TAG del OTRO jugador → CONFIRM_MISMATCH" "$(PR "select cup_admin_resolve('$ADMIN','$M2','B','Empate a todo: decide la organización','#$TAGA2')" | grep -o CONFIRM_MISMATCH | head -1)" "CONFIRM_MISMATCH"
check "un no-admin no resuelve (NOT_ADMIN)" "$(PR "select cup_admin_resolve('$(U 1)','$M2','B','Empate a todo: decide la organización','#$TAGB2')" | grep -o NOT_ADMIN | head -1)" "NOT_ADMIN"
check "admin resuelve B con su #TAG (minúsculas valen) → RESOLVED" "$(P "select cup_admin_resolve('$ADMIN','$M2','B','Empate a todo: decide la organización','#$(echo "$TAGB2" | tr A-Z a-z)')" | code)" "RESOLVED"
check "… avanza una vez, resolución ADMIN_DECISION, auditada con tags y motivo" "$(P "select (player_b='$B2')::text from cup_matches where id='$NEXT'")|$(P "select resolution from cup_matches where id='$M2'")|$(P "select count(*) from content_audit_log where action='cup_match_resolved' and detail->>'winner_tag'='$TAGB2' and detail->>'reason' like 'Empate%'")" "true|ADMIN_DECISION|1"
check "resolver otra vez el mismo cruce → CUP_NOT_RESOLVABLE" "$(PR "select cup_admin_resolve('$ADMIN','$M2','B','Empate a todo: decide la organización','#$TAGB2')" | grep -o CUP_NOT_RESOLVABLE | head -1)" "CUP_NOT_RESOLVABLE"
check "la semifinal NEXT ya tiene a sus dos jugadores → READY" "$(P "select status from cup_matches where id='$NEXT'")" "READY"
M3=$(P "select id from cup_matches where cup_id='$C64' and round=1 and slot=2"); A3=$(P "select player_a from cup_matches where id='$M3'"); B3=$(P "select player_b from cup_matches where id='$M3'")
G3=$(P "select qa_play('$M3','ABANDON_A')"); P "select cup_settle_game('$G3')" >/dev/null
check "ABANDONO de A → gana B (cierre canónico del motor), resolución ABANDON" "$(P "select (winner_id='$B3')::text||'|'||resolution from cup_matches where id='$M3'")" "true|ABANDON"
M4=$(P "select id from cup_matches where cup_id='$C64' and round=1 and slot=3")
check "plazo NO vencido: el admin no puede adjudicar un no presentado (CUP_NOT_RESOLVABLE)" "$(PR "select cup_admin_resolve('$ADMIN','$M4','A','No se presentó ningún jugador','ELIMINAR A LOS DOS')" | grep -o CUP_NOT_RESOLVABLE | head -1)" "CUP_NOT_RESOLVABLE"
P "begin; select set_config('drl.cup_writer','on',true); update cup_matches set available_at = now() - interval '2 hours', deadline_at = now() - interval '1 second' where id='$M4'; commit;" >/dev/null
check "plazo vencido: «listo» ya no vale (DEADLINE_PASSED) y NADIE gana solo por el tiempo" "$(P "select cup_ready('$(P "select player_a from cup_matches where id='$M4'")','$M4',qa_deck('$(P "select player_a from cup_matches where id='$M4'")'),30)" | code)|$(P "select status||'|'||coalesce(winner_id::text,'none') from cup_matches where id='$M4'")" "DEADLINE_PASSED|READY|none"
check "doble no presentado con confirmación mala → CONFIRM_MISMATCH" "$(PR "select cup_admin_resolve('$ADMIN','$M4','NONE','No se presentó ningún jugador','eliminar')" | grep -o CONFIRM_MISMATCH | head -1)" "CONFIRM_MISMATCH"
check "doble no presentado → VOID, los dos eliminados, el ganador de M3 pasa por BYE administrativo" "$(P "select cup_admin_resolve('$ADMIN','$M4','NONE','No se presentó ningún jugador','Eliminar a los dos')" | code)|$(P "select status from cup_matches where id='$M4'")|$(P "select count(*) from cup_registrations where cup_id='$C64' and user_id in (select player_a from cup_matches where id='$M4' union select player_b from cup_matches where id='$M4') and eliminated_round=1")|$(P "select status||':'||(winner_id='$B3')::text from cup_matches where id=(select next_match_id from cup_matches where id='$M3')")" "RESOLVED|VOID|2|BYE:true"
check "invariantes tras retenido + abandono + doble no presentado" "$(P "select qa_violations('$C64')")" "0"

echo "== el resto del torneo de 64 y la final 20×"
RUN64=$(PR "select qa_run('$C64')"); echo "   qa_run(64): $(echo "$RUN64" | head -c 300)"
LEFT=$(P "select count(*) from cup_matches where cup_id='$C64' and status='READY'")
FINAL=$(P "select id from cup_matches where cup_id='$C64' and next_match_id is null")
check "solo queda la final por jugar (todo lo demás terminado)" "$(P "select status from cup_matches where id='$FINAL'")" "COMPLETED"
check "torneo de 64 COMPLETO, un campeón, un trofeo, campeón = ganador de la final" "$(P "select status||'|'||(champion_id is not null)::text from cups where id='$C64'")|$(P "select count(*) from user_cosmetics where cosmetic_id='insignia:torneo:qa-capacity'")|$(P "select qa_violations('$C64')")" "COMPLETED|true|1|0"
C4=$(CUPID 9004)
P "select qa_cup('$C4','qa-final', 4)" >/dev/null; P "select cup_admin_publish('$ADMIN','$C4',(select version from cups where id='$C4'))" >/dev/null
P "select cup_register(('c0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$C4') from generate_series(10,13) i" >/dev/null
P "select qa_close('$C4'); select cup_generate('$C4', null)" >/dev/null
P "select qa_play(id, case when seed_a < seed_b then 'A' else 'B' end) from cup_matches where cup_id='$C4' and round=1 order by slot" >/dev/null
P "select cup_settle_game(game_match_id) from cup_matches where cup_id='$C4' and round=1" >/dev/null
FM=$(P "select id from cup_matches where cup_id='$C4' and round=2")
check "final con sus dos finalistas → READY" "$(P "select status from cup_matches where id='$FM'")" "READY"
GF=$(P "select qa_play('$FM','LIVE')")
P "update duel_matches set status='COMPLETED', winner='A', state='{\"result\":{\"scoreA\":7,\"scoreB\":3}}' where id='$GF'" >/dev/null
for i in $(seq 1 20); do ( P "select cup_settle_game('$GF')" > /tmp/$NAME.fin.$i ) & done; wait
check "20 liquidaciones de la FINAL → 1 SETTLED + 19 ALREADY" "$(tally /tmp/$NAME.fin.*)" "ALREADY=19 SETTLED=1 "
CH=$(P "select player_a from cup_matches where id='$FM'")
check "1 campeón (el ganador del MOTOR), 1 trofeo con referencia al torneo, subcampeón y semifinalistas" "$(P "select (champion_id='$CH')::text from cups where id='$C4'")|$(P "select count(*)||':'||max(source) from user_cosmetics where cosmetic_id='insignia:torneo:qa-final'")|$(P "select string_agg(placement, ',' order by placement) from cup_registrations where cup_id='$C4'")" "true|1:cup:$C4|CHAMPION,RUNNER_UP,SEMIFINAL,SEMIFINAL"
check "conceder el trofeo de ese torneo a OTRA cuenta → índice de dueño único" "$(PR "insert into user_cosmetics (user_id,cosmetic_id,source) values ('$(U 70)','insignia:torneo:qa-final','forjado')" | grep -o user_cosmetics_cup_trophy_once | head -1)" "user_cosmetics_cup_trophy_once"
check "un torneo COMPLETADO no cambia (ni el texto) → CUP_FINAL" "$(PR "update cups set description='x' where id='$C4'" | grep -o CUP_FINAL | head -1)" "CUP_FINAL"
check "invariantes del torneo de 4" "$(P "select qa_violations('$C4')")" "0"

echo "== paridad con el dominio TS: los 61 tamaños de 4 a 64 (ronda 1, seeds y campeón «gana el mejor seed»)"
P "create table qa_expected (kind text, n int, a text, b text, c text)" >/dev/null
docker exec "$NAME" psql -U supabase_admin -d postgres -q -c "\\copy qa_expected from '/tmp/expected.tsv'" </dev/null
check "esperados cargados (3.497 filas)" "$(P "select count(*) from qa_expected")" "3497"
P "begin; select set_config('drl.rating_writer','correct',true); update duel_pvp_ratings set rating = 1300 - (substr(user_id::text, 25)::int / 3) * 10 where user_id::text like 'c0000000-%'; commit;" >/dev/null
P "create or replace function qa_size(n int) returns text language plpgsql as \$q\$
declare cid uuid := ('cccccccc-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; got text; want text; s1 text; s2 text; ch text;
begin
  perform qa_cup(cid, 'qa-size-'||n, greatest(n, 4));
  perform cup_admin_publish((select id from profiles where is_admin order by id limit 1), cid, (select version from cups where id = cid));
  perform cup_register(('c0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid, cid) from generate_series(1, n) i;
  perform qa_close(cid);
  perform cup_generate(cid, null);
  select string_agg(slot||':'||coalesce(player_a::text,'-')||':'||coalesce(player_b::text,'-'), ',' order by slot) into got from cup_matches where cup_id = cid and round = 1;
  select string_agg(a||':'||b||':'||c, ',' order by a::int) into want from qa_expected where kind = 'R1' and qa_expected.n = qa_size.n;
  if got is distinct from want then return 'R1 got=' || left(got, 160) || ' want=' || left(want, 160); end if;
  select string_agg(user_id::text||':'||seed||':'||seed_rating, ',' order by seed) into s1 from cup_registrations where cup_id = cid;
  select string_agg(a||':'||b||':'||c, ',' order by b::int) into s2 from qa_expected where kind = 'SEED' and qa_expected.n = qa_size.n;
  if s1 is distinct from s2 then return 'SEED'; end if;
  if qa_violations(cid) <> 0 then return 'INV0'; end if;
  perform qa_run(cid);
  select champion_id::text into ch from cups where id = cid;
  if ch is distinct from (select a from qa_expected where kind = 'CH' and qa_expected.n = qa_size.n) then return 'CH'; end if;
  if qa_violations(cid) <> 0 then return 'INV1'; end if;
  if (select count(*) from cup_registrations where cup_id = cid and placement is not null) <> n then return 'PLACE'; end if;
  return 'OK';
end \$q\$;" >/dev/null
PAR=$(P "select string_agg(n||'='||r, ' ' order by n) from (select n, qa_size(n) r from generate_series(4,64) n) z where r <> 'OK'" | head -c 900)
check "SQL = dominio TS en los 61 tamaños (ronda 1 + seeds + campeón + invariantes + colocación de todos)" "${PAR:-todos OK}" "todos OK"
check "BYEs de la SQL = tamaño − inscritos (4/5/6/7/8/10/12/16/20/32/64)" "$(P "select string_agg(n||':'||(select count(*) from cup_matches m where m.cup_id=('cccccccc-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid and round=1 and resolution='BYE'), ' ' order by n) from unnest(array[4,5,6,7,8,10,12,16,20,32,64]) n")" "4:0 5:3 6:2 7:1 8:0 10:6 12:4 16:0 20:12 32:0 64:0"

echo "== cancelaciones"
CD=$(CUPID 9101); P "select qa_cup('$CD','qa-cancel-draft', 8)" >/dev/null
check "cancelar un BORRADOR (motivo) → CANCELLED" "$(P "select cup_admin_cancel('$ADMIN','$CD','Borrador de prueba descartado',null)" | code)" "CANCELLED"
CR=$(CUPID 9102); P "select qa_cup('$CR','qa-cancel-reg', 8); select cup_admin_publish('$ADMIN','$CR',(select version from cups where id='$CR')); select cup_register('$(U 30)','$CR')" >/dev/null
check "cancelar con inscripción abierta → CANCELLED; ya no se inscribe nadie" "$(P "select cup_admin_cancel('$ADMIN','$CR','Cancelado por la organización',null)" | code)|$(P "select cup_register('$(U 31)','$CR')" | code)" "CANCELLED|CANCELLED"
CI=$(CUPID 9103); P "select qa_cup('$CI','qa-cancel-live', 8); select cup_admin_publish('$ADMIN','$CI',(select version from cups where id='$CI'))" >/dev/null
P "select cup_register(('c0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$CI') from generate_series(40,47) i; select qa_close('$CI'); select cup_generate('$CI', null)" >/dev/null
MI=$(P "select id from cup_matches where cup_id='$CI' and round=1 and slot=0"); P "select qa_play(id, 'A') from cup_matches where id='$MI'; select cup_settle_game(game_match_id) from cup_matches where id='$MI'" >/dev/null
ML=$(P "select id from cup_matches where cup_id='$CI' and round=1 and slot=1"); GL=$(P "select qa_play('$ML','LIVE')")
check "cancelar EN CURSO sin escribir el identificador → CONFIRM_MISMATCH" "$(PR "select cup_admin_cancel('$ADMIN','$CI','Problema grave con el servidor','otra-cosa')" | grep -o CONFIRM_MISMATCH | head -1)" "CONFIRM_MISMATCH"
check "cancelar EN CURSO con el identificador → CANCELLED; lo jugado se queda; lo pendiente se cancela" "$(P "select cup_admin_cancel('$ADMIN','$CI','Problema grave con el servidor','qa-cancel-live')" | code)|$(P "select status from cup_matches where id='$MI'")|$(P "select count(*) from cup_matches where cup_id='$CI' and status='CANCELLED'")" "CANCELLED|COMPLETED|5"
P "update duel_matches set status='COMPLETED', winner='A', state='{\"result\":{\"scoreA\":6,\"scoreB\":5}}' where id='$GL'" >/dev/null
check "la partida que seguía EN JUEGO termina: se guarda, no avanza a nadie, sin campeón ni trofeo" "$(P "select cup_settle_game('$GL')" | code)|$(P "select status from cup_matches where id='$ML'")|$(P "select (player_b is null)::text from cup_matches where id=(select next_match_id from cup_matches where id='$ML')")|$(P "select coalesce(champion_id::text,'none') from cups where id='$CI'")|$(P "select count(*) from user_cosmetics where cosmetic_id='insignia:torneo:qa-cancel-live'")" "RECORDED_CANCELLED|COMPLETED|true|none|0"
check "cancelar un torneo ya cancelado o completo → CUP_FINAL" "$(PR "select cup_admin_cancel('$ADMIN','$C4','Intento sobre un torneo terminado','qa-final')" | grep -o CUP_FINAL | head -1)" "CUP_FINAL"
CU=$(CUPID 9104); P "select qa_cup('$CU','qa-underfilled', 8, 4); select cup_admin_publish('$ADMIN','$CU',(select version from cups where id='$CU'))" >/dev/null
P "select cup_register(('c0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$CU') from generate_series(50,52) i; select qa_close('$CU')" >/dev/null
check "3 inscritos con mínimo 4 → al cerrar: UNDERFILLED, torneo cancelado (auditado), sin cuadro" "$(P "select cup_generate('$CU', null)" | code)|$(P "select status||':'||cancel_reason from cups where id='$CU'")|$(P "select count(*) from cup_matches where cup_id='$CU'")" "UNDERFILLED|CANCELLED:NOT_ENOUGH_PARTICIPANTS|0"

echo "== aislamiento: ranked, temporada, misiones, social, economía (medido desde el mundo de prueba)"
fp > /tmp/$NAME.end
DIFF=$(diff /tmp/$NAME.world /tmp/$NAME.end | grep '^>' | awk '{print $2}' | grep -v duel_pvp_ratings | tr '\n' ' ')
check "(sin contar duel_pvp_ratings, que movió el propio ensayo) solo cambiaron duel_matches (partidas de torneo), content_audit_log (auditoría) y user_cosmetics (trofeos); perfiles, eventos de rating, temporada competitiva, F83, F73, amistades, retos, bloqueos, economía y esports intactos" "$DIFF" "public.duel_matches public.content_audit_log public.user_cosmetics "
check "… (duel_pvp_ratings cambió SOLO por el ensayo: la subida manual a 2500 y la re-fijación de la paridad) — eventos de rating 0 nuevos" "$(grep duel_pvp_rating_events /tmp/$NAME.world)" "$(grep duel_pvp_rating_events /tmp/$NAME.end)"
check "todas las partidas de torneo son PVP_PRIVATE (nunca PVP ranked)" "$(P "select count(*) filter (where d.mode <> 'PVP_PRIVATE')||'|'||count(*) from cup_matches m join duel_matches d on d.id = m.game_match_id")" "0|$(P "select count(*) from cup_matches where game_match_id is not null")"
check "0 amistades, 0 retos, 0 bloqueos creados por los torneos" "$(grep -E 'duel_friendships|duel_challenges|social_blocks' /tmp/$NAME.world | md5sum | cut -c1-8)" "$(grep -E 'duel_friendships|duel_challenges|social_blocks' /tmp/$NAME.end | md5sum | cut -c1-8)"

echo "== rendimiento (64 inscritos, 63 cruces)"
EXPL=$(P "explain (analyze, format text) select * from cup_matches where cup_id='$C64' order by round, slot" | grep -oE 'Index Scan|Seq Scan|Execution Time: [0-9.]+ ms' | tr '\n' ' ')
echo "   cuadro: $EXPL"
EXPL2=$(P "explain (analyze, format text) select * from cup_matches where status in ('READY','ACTIVE','ACTION_REQUIRED') and (player_a='$(U 1)' or player_b='$(U 1)')" | grep -oE 'Bitmap|Index Scan|Seq Scan|Execution Time: [0-9.]+ ms' | tr '\n' ' ')
echo "   mi cruce: $EXPL2"
EXPL3=$(P "begin; set local enable_seqscan = off; explain (analyze, format text) select * from cup_matches where cup_id='$C64' order by round, slot; commit;" | grep -oE 'cup_matches_cup_id_round_slot_key' | head -1)
echo "   cuadro con recorrido secuencial desactivado: $EXPL3"
check "cuadro de 64 en < 50 ms y con índice (cup_id, round, slot) utilizable cuando la tabla crezca" "$(echo "$EXPL" | awk '{for(i=1;i<=NF;i++) if ($i=="Time:") t=$(i+1)} END {print (t+0 < 50) ? "rapido" : "lento"}')|$EXPL3" "rapido|cup_matches_cup_id_round_slot_key"

echo "== rollback y reaplicación"
PRE=$(P "select count(*) from user_cosmetics where cosmetic_id like 'insignia:torneo:%'")
fp > /tmp/$NAME.prerb
OUT=$(F /tmp/rollback.sql); check "ROLLBACK aplica (exit)" "$?" "0"
check "tablas y RPC de torneo fuera" "$(P "select (select count(*) from pg_class where relname in ('cups','cup_registrations','cup_matches'))||'|'||(select count(*) from pg_proc where proname like 'cup\_%' or proname like '\_cup%')")" "0|0"
check "el rollback NO quita trofeos ganados ni partidas jugadas" "$(P "select count(*) from user_cosmetics where cosmetic_id like 'insignia:torneo:%'")|$(diff <(grep -v -E 'content_audit_log' /tmp/$NAME.prerb) <(fp | grep -v -E 'content_audit_log') >/dev/null && echo iguales || echo distintas)" "$PRE|iguales"
OUT=$(F /tmp/0069.sql); check "reaplicar 0069 tras el rollback (exit)" "$?" "0"

echo
if [ "$FAILS" = 0 ]; then echo "DRYRUN_OK 0069"; else echo "DRYRUN_FAIL $FAILS"; fi
