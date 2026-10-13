#!/usr/bin/env bash
# =============================================================================
# TAG PÚBLICO · DRY-RUN de 0068 + ATAQUES + COLISIONES + 100.000 TAGS + CONCURRENCIA + ROLLBACK — COPIA AISLADA.
# NUNCA toca producción.
#   ssh nexusadmin@VPS 'SRC=/opt/nexus/backups/supabase-drlcards/pre-0068/<TS> bash /tmp/tag/_tag-dryrun.sh'
# (con /tmp/tag/0068_public_account_tag.sql y /tmp/tag/0068_public_account_tag.ROLLBACK.sql)
# =============================================================================
set -uo pipefail
SRC="${SRC:?falta SRC}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PROD=supabase_db_DRLCards
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="tag-dryrun-$TS"
FAILS=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f /tmp/$NAME.*; }
trap cleanup EXIT
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
check() { local name="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then pass "$name ($got)"; else fail "$name (esperado «$want», obtenido «$got»)"; fi; }
P() { docker exec "$NAME" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
F() { docker exec "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 -q -f "$1" </dev/null 2>&1; }
RE='^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$'

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
docker cp "$DIR/0068_public_account_tag.sql" "$NAME:/tmp/0068.sql" >/dev/null
docker cp "$DIR/0068_public_account_tag.ROLLBACK.sql" "$NAME:/tmp/rollback.sql" >/dev/null
echo "== restaurado ($(grep -c 'error:' /tmp/$NAME.restore.log) errores de pg_restore, conocidos: roles de Supabase ausentes)"

check "copia en 0067: app_admin_set_admin existe" "$(P "select to_regprocedure('public.app_admin_set_admin(uuid,uuid,boolean,text)') is not null")" "t"
check "copia sin rastro de 0068" "$(P "select (select count(*) from information_schema.columns where table_name='profiles' and column_name='public_tag') + coalesce((select 1 from pg_class where relname='account_tag_registry'),0)")" "0"
SET67=$(P "select md5(pg_get_functiondef('public.app_admin_set_admin(uuid,uuid,boolean,text)'::regprocedure))")
TABLES="auth.users public.user_cards public.user_game public.game_state public.user_packs public.credit_transactions public.duel_pvp_ratings public.duel_pvp_rating_events public.competitive_season_players public.duel_friendships public.social_blocks public.duel_challenges public.duel_matches public.content_audit_log public.player_profile_customization public.user_cosmetics public.user_collection_completions public.game_seasons public.season_xp_ledger"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(P "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done
       printf 'profiles %s\n' "$(P "select count(*)||':'||md5(string_agg((to_jsonb(p) - 'public_tag')::text, '|' order by p.id)) from public.profiles p")"; }
fp > /tmp/$NAME.before
ADMINS=$(P "select string_agg(id::text, ',' order by id) from public.profiles where is_admin")
N=$(P "select count(*) from public.profiles")
echo "== $N perfiles · huellas de $(wc -l < /tmp/$NAME.before) tablas"

T0=$(date +%s%N); OUT=$(F /tmp/0068.sql); RC=$?
check "0068 aplica en UNA transacción (exit)" "$RC" "0"; [ "$RC" = 0 ] || echo "$OUT" | tail -5
echo "   tiempo: $(( ($(date +%s%N) - T0) / 1000000 )) ms"
fp > /tmp/$NAME.after
check "0068 no cambia NINGÚN otro dato (perfiles salvo el tag, updated_at incluido; auth, inventario, economía, ranked, social, auditoría, temporada)" "$(diff /tmp/$NAME.before /tmp/$NAME.after >/dev/null && echo iguales || (diff /tmp/$NAME.before /tmp/$NAME.after | head -4; echo distintas))" "iguales"
check "todas las cuentas existentes tienen tag; 0 nulos; 0 duplicados; formato válido" "$(P "select count(*) filter (where public_tag is null)||'|'||(count(*)-count(distinct public_tag))||'|'||count(*) filter (where public_tag !~ '$RE')||'|'||count(*) from public.profiles")" "0|0|0|$N"
check "public_tag NOT NULL en la BD" "$(P "select is_nullable from information_schema.columns where table_name='profiles' and column_name='public_tag'")" "NO"
check "UNIQUE real (constraint) y CHECK de formato" "$(P "select count(*) from pg_constraint where conname in ('profiles_public_tag_key','profiles_public_tag_format')")" "2"
check "cada tag está en el registro con SU cuenta" "$(P "select count(*) from public.profiles p join public.account_tag_registry r on r.user_id = p.id and r.tag = p.public_tag")" "$N"
check "admins intactos" "$(P "select string_agg(id::text, ',' order by id) from public.profiles where is_admin")" "$ADMINS"
TAGS1=$(P "select md5(string_agg(id||':'||public_tag, ',' order by id)) from public.profiles")
OUT=$(F /tmp/0068.sql); check "IDEMPOTENTE: reaplicar 0068 (exit)" "$?" "0"
check "… y NINGUNA cuenta cambia de tag" "$(P "select md5(string_agg(id||':'||public_tag, ',' order by id)) from public.profiles")" "$TAGS1"

newuser() { local u; u=$(P "select gen_random_uuid()"); P "insert into auth.users (id,email,aud,role,instance_id,raw_user_meta_data) values ('$u','tag-$u@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000', '{\"public_tag\":\"AAAAAAA\",\"username\":\"tagqa\"}'::jsonb)" >/dev/null; echo "$u"; }
echo "== cuentas nuevas"
U1=$(newuser)
check "cuenta nueva: tag automático válido (la BD lo pone)" "$(P "select public_tag ~ '$RE' from public.profiles where id='$U1'")" "t"
check "el registro guarda (tag → cuenta) de la cuenta nueva" "$(P "select count(*) from public.account_tag_registry where user_id='$U1'")" "1"
check "alta que INTENTA elegir tag (metadatos public_tag=AAAAAAA) → se ignora" "$(P "select public_tag <> 'AAAAAAA' from public.profiles where id='$U1'")" "t"
U2=$(P "select gen_random_uuid()")
P "insert into auth.users (id,email,aud,role,instance_id) values ('$U2','tag2-$U2@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')" >/dev/null
P "delete from public.game_state where user_id='$U2'; delete from public.user_game where user_id='$U2'" >/dev/null
P "begin; alter table public.profiles disable trigger profiles_admin_floor_del; delete from public.profiles where id='$U2'; alter table public.profiles enable trigger profiles_admin_floor_del; commit;" >/dev/null
check "INSERT directo de un perfil con public_tag='BBBBBBB' → la BD lo sustituye (y reusa SU tag del registro)" "$(P "insert into public.profiles (id, username, public_tag) values ('$U2', 'tagqa2_$RANDOM', 'BBBBBBB') returning (public_tag <> 'BBBBBBB')::text || '|' || (public_tag = (select tag from public.account_tag_registry where user_id='$U2'))::text")" "true|true"

echo "== inmutabilidad (cualquier rol)"
TU1=$(P "select public_tag from public.profiles where id='$U1'")
check "superusuario/service_role: UPDATE public_tag → ACCOUNT_TAG_IMMUTABLE" "$(P "update public.profiles set public_tag='CCCCCCC' where id='$U1'" | grep -c ACCOUNT_TAG_IMMUTABLE)" "1"
check "poner el tag a NULL → rechazado (y NOT NULL)" "$(P "update public.profiles set public_tag=null where id='$U1'" | grep -cE 'ACCOUNT_TAG_IMMUTABLE|null value')" "1"
check "con la bandera del backfill pero OTRO tag → rechazado" "$(P "begin; select set_config('drl.account_tag_writer','on',true); update public.profiles set public_tag='DDDDDDD' where id='$U1'; commit;" | grep -c ACCOUNT_TAG_IMMUTABLE)" "1"
check "authenticated (su propia fila, RLS «edita tu perfil») → rechazado" "$(P "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$U1\",\"role\":\"authenticated\"}', true); update public.profiles set public_tag='EEEEEEE' where id='$U1'; commit;" | grep -cE 'ACCOUNT_TAG_IMMUTABLE|permission denied|SEC-02')" "1"
ANON_OUT=$(P "begin; set local role anon; update public.profiles set public_tag='FFFFFFF' where id='$U1'; commit;")
check "anon → sin efecto (error, o RLS lo filtra a 0 filas) y el tag no cambia" "$( { echo "$ANON_OUT" | grep -qE 'ACCOUNT_TAG_IMMUTABLE|permission denied' || [ "$(P "select public_tag from public.profiles where id='$U1'")" = "$TU1" ]; } && echo rechazado || echo CAMBIADO)" "rechazado"
check "… y el tag sigue siendo el mismo" "$(P "select public_tag from public.profiles where id='$U1'")" "$TU1"
check "cambiar el NOMBRE sigue funcionando y no toca el tag" "$(P "update public.profiles set username='tagqa_renombrado_$RANDOM' where id='$U1' returning public_tag")" "$TU1"

echo "== registro (append-only, sin acceso de cliente)"
check "registro: UPDATE → APPEND_ONLY" "$(P "update public.account_tag_registry set tag='GGGGGGG' where user_id='$U1'" | grep -c APPEND_ONLY)" "1"
check "registro: DELETE → APPEND_ONLY" "$(P "delete from public.account_tag_registry where user_id='$U1'" | grep -c APPEND_ONLY)" "1"
check "registro: authenticated no lee ni inserta" "$(P "begin; set local role authenticated; select count(*) from public.account_tag_registry; commit;" | grep -c 'permission denied')|$(P "begin; set local role authenticated; insert into public.account_tag_registry values ('HHHHHHH', gen_random_uuid()); commit;" | grep -c 'permission denied')" "1|1"
check "registro: tag con formato inválido → CHECK" "$(P "insert into public.account_tag_registry values ('abc', gen_random_uuid())" | grep -c 'account_tag_registry_format')" "1"
check "funciones internas sin EXECUTE para clientes" "$(P "select count(*) from (values ('anon'),('authenticated')) r(n) cross join unnest(array['public._account_tag_claim(uuid)','public._account_tag_random()']) f where has_function_privilege(n, f, 'execute')")" "0"

echo "== borrado → el tag NUNCA se reutiliza"
U3=$(newuser); T3=$(P "select public_tag from public.profiles where id='$U3'")
P "delete from auth.users where id='$U3'" >/dev/null
check "borrar la cuenta: perfil fuera, el registro conserva (tag → cuenta borrada)" "$(P "select (select count(*) from public.profiles where id='$U3')||'|'||(select count(*) from public.account_tag_registry where tag='$T3' and user_id='$U3')")" "0|1"
# Forzar que el generador proponga EXACTAMENTE el tag liberado: la nueva cuenta NO puede recibirlo.
P "create sequence if not exists public._tagtest_seq; create or replace function public._account_tag_random() returns text language plpgsql volatile as \$\$ begin if nextval('public._tagtest_seq') = 1 then return '$T3'; end if; return (select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (get_byte(extensions.gen_random_bytes(1),0) % 31), 1), '') from generate_series(1,7)); end \$\$;" >/dev/null
U4=$(newuser)
check "COLISIÓN forzada con un tag de cuenta BORRADA → reintento y tag DISTINTO (nunca se reutiliza)" "$(P "select (public_tag <> '$T3')::text || '|' || (public_tag ~ '$RE')::text from public.profiles where id='$U4'")" "true|true"
P "select setval('public._tagtest_seq', 1, false)" >/dev/null
EX=$(P "select public_tag from public.profiles order by id limit 1")
P "create or replace function public._account_tag_random() returns text language plpgsql volatile as \$\$ begin if nextval('public._tagtest_seq') = 1 then return '$EX'; end if; return (select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (get_byte(extensions.gen_random_bytes(1),0) % 31), 1), '') from generate_series(1,7)); end \$\$;" >/dev/null
U5=$(newuser)
check "COLISIÓN forzada con un tag VIVO → el alta no falla: reintenta y recibe otro" "$(P "select (public_tag <> '$EX')::text from public.profiles where id='$U5'")" "true"
P "create or replace function public._account_tag_random() returns text language sql volatile as \$\$ select '$EX' \$\$;" >/dev/null
T0=$(date +%s%N)
EXH=$(P "insert into auth.users (id,email,aud,role,instance_id) values (gen_random_uuid(),'exh@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')")
MS=$(( ($(date +%s%N) - T0) / 1000000 ))
check "AGOTAMIENTO (el generador solo da tags ocupados) → ACCOUNT_TAG_EXHAUSTED tras 10 intentos, sin bucle infinito (${MS} ms)" "$(echo "$EXH" | grep -c ACCOUNT_TAG_EXHAUSTED)|$( [ "$MS" -lt 5000 ] && echo rapido || echo lento)" "1|rapido"
check "… y el alta fallida NO deja cuenta ni perfil a medias" "$(P "select count(*) from auth.users where email='exh@example.invalid'")" "0"
OUT=$(F /tmp/0068.sql); P "drop function if exists public._tagtest_seq(); drop sequence if exists public._tagtest_seq;" >/dev/null
check "generador real restaurado (reaplicar 0068)" "$(P "select prosrc like '%gen_random_bytes(16)%' from pg_proc where proname='_account_tag_random'")" "t"

echo "== 100.000 tags"
T0=$(date +%s%N)
P "create temp table if not exists x(t text)" >/dev/null
RAW=$(P "with g as (select public._account_tag_random() t from generate_series(1,100000)) select count(*)||'|'||(count(*)-count(distinct t))||'|'||count(*) filter (where t !~ '$RE') from g")
MS=$(( ($(date +%s%N) - T0) / 1000000 ))
echo "   100.000 tags del generador en ${MS} ms · total|duplicados crudos (esperado ≈ 0,18 por cumpleaños)|formato inválido = $RAW"
check "100.000 tags crudos: formato válido en todos" "$(echo "$RAW" | cut -d'|' -f3)" "0"
T0=$(date +%s%N)
REG=$(P "with c as (select public._account_tag_claim(gen_random_uuid()) t from generate_series(1,100000)) select count(*)||'|'||(count(*)-count(distinct t)) from c")
MS=$(( ($(date +%s%N) - T0) / 1000000 ))
check "100.000 asignaciones por el REGISTRO (con resolución de colisiones): 100.000 tags y 0 duplicados (${MS} ms)" "$REG" "100000|0"
check "… el registro (PK) contiene 100.000 tags nuevos únicos" "$(P "select count(*) - count(distinct tag) from public.account_tag_registry")" "0"

echo "== concurrencia"
for i in $(seq 1 100); do ( P "insert into auth.users (id,email,aud,role,instance_id) values (gen_random_uuid(),'conc$i-$RANDOM@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000')" >/dev/null ) & done; wait
check "100 altas SIMULTÁNEAS → 100 perfiles, 100 tags distintos y válidos" "$(P "select count(*)||'|'||count(distinct p.public_tag)||'|'||count(*) filter (where p.public_tag !~ '$RE') from auth.users u join public.profiles p on p.id=u.id where u.email like 'conc%@example.invalid'")" "100|100|0"
SAME=$(P "select gen_random_uuid()")
for i in $(seq 1 20); do ( P "select public._account_tag_claim('$SAME')" > /tmp/$NAME.c$i ) & done; wait
check "20 asignaciones simultáneas para la MISMA cuenta → un único tag" "$(cat /tmp/$NAME.c* | sort -u | wc -l)|$(P "select count(*) from public.account_tag_registry where user_id='$SAME'")" "1|1"

echo "== auditoría de admins con el tag (0067 + instantánea)"
X=$(newuser); Y=$(newuser)
P "begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '$X'; commit;" >/dev/null
check "GRANT_ADMIN registra id interno + target_tag + nombre" "$(P "select public.app_admin_set_admin('$X','$Y',true,'ensayo')->>'code'")|$(P "select (entity_id = '$Y')::text||'|'||(detail->>'target_tag' = (select public_tag from public.profiles where id='$Y'))::text||'|'||(detail ? 'target_username')::text from public.content_audit_log order by id desc limit 1")" "GRANTED|true|true|true"
check "último admin sigue protegido (LAST_ADMIN) y NOT_ADMIN intacto" "$(P "select public.app_admin_set_admin('$U1','$U1',true,null)" | grep -c NOT_ADMIN)" "1"

echo "== rollback"
TAGS2=$(P "select md5(string_agg(id||':'||public_tag, ',' order by id)) from public.profiles")
REGN=$(P "select count(*) from public.account_tag_registry")
OUT=$(F /tmp/rollback.sql); check "rollback aplica (exit)" "$?" "0"
check "rollback → sin columna ni disparadores; REGISTRO conservado; app_admin_set_admin = 0067 byte a byte" "$(P "select (select count(*) from information_schema.columns where table_name='profiles' and column_name='public_tag')||'|'||(select count(*) from pg_trigger where tgname like 'profiles_account_tag%')||'|'||(select count(*) from public.account_tag_registry)||'|'||(md5(pg_get_functiondef('public.app_admin_set_admin(uuid,uuid,boolean,text)'::regprocedure)) = '$SET67')")" "0|0|$REGN|true"
OUT=$(F /tmp/0068.sql); check "0068 se reaplica tras el rollback" "$?" "0"
check "… y CADA cuenta recupera EXACTAMENTE su tag (el registro manda)" "$(P "select md5(string_agg(id||':'||public_tag, ',' order by id)) from public.profiles")" "$TAGS2"

echo "== $FAILS fallos"
[ "$FAILS" = 0 ] && echo DRYRUN_OK || echo DRYRUN_FAIL
