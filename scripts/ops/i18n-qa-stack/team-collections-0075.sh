#!/usr/bin/env bash
# =============================================================================
# COLECCIONES POR EQUIPO · ENSAYO DE LA MIGRACIÓN 0075 EN LA BASE DE QA (se ejecuta en el VPS; nunca toca producción)
# =============================================================================
#   team-collections-0075.sh backup      copia de la base de QA antes de tocarla (pg_dump -Fc + sha256 + prueba de lectura)
#   team-collections-0075.sh apply       aplica 0075 en UNA transacción y comprueba tablas, permisos y que no cambia ninguna fila
#   team-collections-0075.sh season on|off   crea / retira una temporada SOLO de QA, publicada y activa (la base no tiene ninguna)
#   team-collections-0075.sh sqltest     la función contra Postgres real: incompletos, sin temporada, XP una vez, concurrencia,
#                                        insignias permanentes, entradas inválidas, permisos y aislamiento entre cuentas
#   team-collections-0075.sh txfail      error a mitad de la liquidación: no queda nada; el reintento cobra 300 XP una vez
#                                        (una transacción con ROLLBACK; necesita team-collections-0075.txfail.sql en $W)
#   team-collections-0075.sh rollback    ejecuta el ROLLBACK: archivo de las dos tablas, nada perdido, segundo intento rechazado
#   team-collections-0075.sh restore     vuelve a aplicar 0075 y devuelve las filas archivadas (nadie cobra dos veces)
#   team-collections-0075.sh reset       deja las cuentas sintéticas sin compleciones ni insignias (para la QA de navegador)
#
# Necesita en $W: 0075_team_collections.sql, 0075_team_collections.ROLLBACK.sql y tc-0075-vars.sql
# (los genera `scripts/_team-collections-qa-prep.ts`). Solo usa los contenedores vrqa_* y cuentas `coll-tc*@example.invalid`.
# =============================================================================
set -uo pipefail
QA=/opt/nexus/projects/valorosters-i18n-qa
W=${RC_WORK:-/tmp/tc-rc}
SEASON=qa-tc-season
set -a; . "$QA/secrets/qa.env"; set +a
psqlq() { docker exec -i vrqa_db psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 "$@"; }
q() { psqlq -c "$1" < /dev/null; }
# Una sentencia con las variables de los planes cargadas (psql no interpola variables en -c).
qv() { { cat "$W/tc-0075-vars.sql"; echo "$1"; } | psqlq -q; }
uid_of() { q "select id from auth.users where email = 'coll-$1@example.invalid'"; }
fail=0
ok() { echo "OK    $*"; }
ko() { echo "FALLO $*"; fail=1; }
eq() { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else ko "$1: esperado «$3», obtenido «$2»"; fi; }
TABLES="auth.users public.profiles public.user_cards public.user_packs public.credit_transactions public.economy_ops public.duel_decks public.user_cosmetics public.player_profile_customization public.season_events public.season_xp_ledger public.season_progress public.user_collection_completions"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
economy_fp() { for t in public.profiles public.user_cards public.user_packs public.credit_transactions public.economy_ops; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }

case "${1:?backup|apply|season|sqltest|rollback|restore|reset}" in
  backup)
    D="$QA/backups/pre-0075/$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$D"
    docker exec vrqa_db pg_dump -U postgres -d postgres -Fc --no-owner > "$D/qa.dump" < /dev/null || { echo "BACKUP_FAIL"; exit 1; }
    ( cd "$D" && sha256sum qa.dump > qa.dump.sha256 )
    n=$(docker exec -i vrqa_db pg_restore -l < "$D/qa.dump" | grep -c "TABLE DATA")
    echo "$D" > "$W/backup.path"
    echo "BACKUP_OK $D · $(stat -c %s "$D/qa.dump") B · sha256 $(cut -c1-16 "$D/qa.dump.sha256")… · $n tablas con datos legibles"
    ;;
  apply)
    [ "$(q "select to_regclass('public.user_team_completions') is null and to_regprocedure('public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)') is null")" = "t" ] || { echo "APPLY_STOP ya hay rastro de 0075"; exit 1; }
    fp > "$W/0075-before.fp"
    FNS=$(q "select count(*)||':'||md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")
    T0=$(date +%s%N)
    psqlq -1 -q -f - < "$W/0075_team_collections.sql" || { echo "APPLY_FAIL (la transacción se revirtió entera)"; exit 1; }
    echo "aplicada en $(( ($(date +%s%N) - T0) / 1000000 )) ms"
    q "insert into public._qa_migrations (name) values ('0075_team_collections.sql') on conflict do nothing; notify pgrst, 'reload schema'" > /dev/null
    sleep 2
    fp > "$W/0075-after.fp"
    diff "$W/0075-before.fp" "$W/0075-after.fp" > /dev/null && ok "DATOS_INTACTOS: 0075 no cambió ninguna fila de $(wc -l < "$W/0075-before.fp") tablas" || { ko "huellas distintas tras aplicar"; diff "$W/0075-before.fp" "$W/0075-after.fp" | head; }
    eq "funciones anteriores intactas" "$(q "select count(*)||':'||md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'app_team_collections_settle'")" "$FNS"
    eq "tablas nuevas vacías" "$(q "select (select count(*) from public.user_team_completions) + (select count(*) from public.user_region_badges)")" "0"
    eq "RLS activada en las dos tablas" "$(q "select count(*) from pg_class where relname in ('user_team_completions','user_region_badges') and relrowsecurity")" "2"
    eq "sin políticas (solo servidor)" "$(q "select count(*) from pg_policies where tablename in ('user_team_completions','user_region_badges')")" "0"
    [ "$fail" = 0 ] && echo "APPLY_OK 0075" || echo "APPLY_CON_FALLOS"
    ;;
  season)
    if [ "${2:-on}" = "on" ]; then
      # Los disparadores de 0064 obligan a publicar desde el panel; aquí es una fila de QA, insertada sin ellos.
      qv "set session_replication_role = replica;
          insert into public.game_seasons (id, number, name, description, status, starts_at, ends_at, claim_until, max_level, config, checksum, published_at)
          values ('$SEASON', 900, 'QA-TC', 'QA-TC', 'PUBLISHED', now() - interval '1 day', now() + interval '30 days', now() + interval '40 days', :season_levels, :'season_config'::jsonb, 'qa', now())
          on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, claim_until = excluded.claim_until, status = 'PUBLISHED';"
      echo "temporada de QA activa: $(q "select id || ' · ' || status || ' · hasta ' || ends_at::date from public.game_seasons where id = '$SEASON'")"
    else
      q "set session_replication_role = replica; delete from public.season_xp_ledger where season_id = '$SEASON'; delete from public.season_events where season_id = '$SEASON'; delete from public.season_progress where season_id = '$SEASON'; delete from public.season_challenge_progress where season_id = '$SEASON'; delete from public.season_reward_claims where season_id = '$SEASON'; update public.user_team_completions set xp_amount = null, xp_season_id = null, xp_granted_at = null where xp_season_id = '$SEASON'; delete from public.game_seasons where id = '$SEASON'" > /dev/null
      echo "temporada de QA retirada (quedan $(q "select count(*) from public.game_seasons") temporadas)"
    fi
    ;;
  reset)
    q "delete from public.user_team_completions where user_id in (select id from auth.users where email like 'coll-tc%@example.invalid');
       delete from public.user_region_badges where user_id in (select id from auth.users where email like 'coll-tc%@example.invalid');
       delete from public.user_cosmetics where cosmetic_id like 'insignia:regional:%' and user_id in (select id from auth.users where email like 'coll-tc%@example.invalid');
       update public.player_profile_customization set featured_badge_ids = '{}' where user_id in (select id from auth.users where email like 'coll-tc%@example.invalid');
       set session_replication_role = replica;
       delete from public.season_xp_ledger where user_id in (select id from auth.users where email like 'coll-tc%@example.invalid');
       delete from public.season_events where user_id in (select id from auth.users where email like 'coll-tc%@example.invalid');
       delete from public.season_progress where user_id in (select id from auth.users where email like 'coll-tc%@example.invalid');" > /dev/null
    psqlq -q -f - < "$W/tc-seed.sql" > /dev/null
    echo "cuentas coll-tc* sin compleciones, insignias ni XP; inventarios resembrados"
    ;;
  sqltest)
    FIVE=$(uid_of tcfive); CHINA=$(uid_of tcchina); ALL=$(uid_of tcall); EMPTY=$(uid_of tcempty)
    [ -n "$FIVE" ] && [ -n "$CHINA" ] && [ -n "$ALL" ] && [ -n "$EMPTY" ] || { echo "faltan las cuentas coll-tc*"; exit 1; }
    bash "$0" reset > /dev/null; bash "$0" season off > /dev/null
    NT=$(qv "select :n_teams;"); NC=$(qv "select :n_china_teams;")
    settle() { qv "select public.app_team_collections_settle('$1'::uuid, $2::jsonb, $3::jsonb, $4, 300);"; }
    economy_fp > "$W/sql-eco-before.fp"

    echo "##### 1 · permisos: solo el servidor"
    eq "anon/authenticated NO pueden ejecutar la función" "$(q "select bool_or(has_function_privilege(r, 'public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)', 'EXECUTE'))::text from unnest(array['anon','authenticated']) r")" "false"
    eq "service_role sí" "$(q "select has_function_privilege('service_role', 'public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)', 'EXECUTE')::text")" "true"
    eq "anon/authenticated NO pueden leer ni escribir las tablas" "$(q "select bool_or(has_table_privilege(r, t, 'SELECT') or has_table_privilege(r, t, 'INSERT') or has_table_privilege(r, t, 'UPDATE') or has_table_privilege(r, t, 'DELETE'))::text from unnest(array['anon','authenticated']) r, unnest(array['public.user_team_completions','public.user_region_badges']) t")" "false"
    R=$(docker exec -e K="$QA_ANON_KEY" vrqa_app node -e "fetch('http://vrqa_kong:8000/rest/v1/rpc/app_team_collections_settle',{method:'POST',headers:{apikey:process.env.K,authorization:'Bearer '+process.env.K,'content-type':'application/json'},body:JSON.stringify({p_user:'$ALL',p_teams:[],p_regions:[],p_season:null,p_xp:300})}).then(async r=>console.log(r.status))" 2>&1)
    case "$R" in 401|403|404) ok "PostgREST con la clave anónima: $R";; *) ko "PostgREST con la clave anónima respondió $R";; esac
    R=$(docker exec -e K="$QA_ANON_KEY" vrqa_app node -e "fetch('http://vrqa_kong:8000/rest/v1/user_team_completions?select=*',{headers:{apikey:process.env.K,authorization:'Bearer '+process.env.K}}).then(async r=>console.log(r.status+' '+(await r.text()).slice(0,2)))" 2>&1)
    case "$R" in 401*|403*|404*|"200 []") ok "tabla por PostgREST con la clave anónima: $R";; *) ko "tabla por PostgREST: $R";; esac

    echo "##### 2 · colección incompleta: nada"
    R=$(settle "$FIVE" ":'plan_g2'" "'[]'" "null")
    eq "G2 con una carta por jugador (y copias repetidas)" "$(echo "$R" | grep -o '"code": *"INCOMPLETE"' | wc -l)" "1"
    eq "sin filas ni XP" "$(q "select (select count(*) from public.user_team_completions where user_id = '$FIVE') || '/' || (select count(*) from public.season_xp_ledger where user_id = '$FIVE')")" "0/0"

    echo "##### 3 · sin temporada activa: compleción guardada, XP pendientes"
    R=$(settle "$FIVE" ":'plan_navi'" "'[]'" "null"); echo "   $R"
    eq "compleción guardada con XP a null" "$(q "select team_id || ':' || coalesce(xp_amount::text, 'null') || ':' || coalesce(xp_season_id, 'null') from public.user_team_completions where user_id = '$FIVE'")" "navi:null:null"
    R=$(settle "$FIVE" ":'plan_navi'" "'[]'" "'temporada-que-no-existe'")
    eq "temporada inexistente: sigue pendiente, no falla" "$(q "select coalesce(xp_amount::text, 'null') from public.user_team_completions where user_id = '$FIVE'")" "null"

    echo "##### 4 · con temporada: 300 XP, una sola vez"
    bash "$0" season on > /dev/null
    R=$(settle "$FIVE" ":'plan_navi'" "'[]'" "'$SEASON'"); echo "   $R"
    eq "XP cobrados al aparecer la temporada" "$(echo "$R" | grep -o '"xpGained": *300' | wc -l)" "1"
    for i in 1 2 3 4 5; do settle "$FIVE" ":'plan_navi'" "'[]'" "'$SEASON'" > /dev/null; done
    eq "tras 5 reintentos: un asiento de 300 y 300 de progreso" "$(q "select count(*) || ':' || sum(amount) || ':' || (select xp from public.season_progress where user_id = '$FIVE' and season_id = '$SEASON') from public.season_xp_ledger where user_id = '$FIVE'")" "1:300:300"
    eq "asiento con fuente y clave propias" "$(q "select source || ' ' || event_key || ' ' || (meta->>'kind') from public.season_xp_ledger where user_id = '$FIVE'")" "COLLECTION team-collection:navi TEAM_COLLECTION"
    eq "compleción marcada como cobrada" "$(q "select xp_amount || ':' || xp_season_id || ':' || (xp_granted_at is not null)::text from public.user_team_completions where user_id = '$FIVE'")" "300:$SEASON:true"

    echo "##### 5 · concurrencia: 24 sesiones a la vez liquidando TODO el catálogo de una cuenta"
    rm -f "$W"/conc-*.out
    for i in $(seq 1 24); do ( settle "$ALL" ":'plan_all_teams'" ":'plan_all_regions'" "'$SEASON'" > "$W/conc-$i.out" 2>&1 ) & done; wait
    eq "las 24 terminaron bien" "$(grep -l '"code": *"OK"' "$W"/conc-*.out | wc -l)" "24"
    SUM=0; for f in "$W"/conc-*.out; do n=$(grep -o '"xpGained": *[0-9]*' "$f" | grep -o '[0-9]*$' | tail -1); SUM=$((SUM + ${n:-0})); done
    eq "XP sumados por las 24 respuestas = equipos × 300" "$SUM" "$((NT * 300))"
    eq "compleciones (una por equipo)" "$(q "select count(*) || ':' || count(distinct team_id) from public.user_team_completions where user_id = '$ALL'")" "$NT:$NT"
    eq "asientos de XP (uno por equipo) y progreso" "$(q "select count(*) || ':' || sum(amount) || ':' || (select xp from public.season_progress where user_id = '$ALL' and season_id = '$SEASON') from public.season_xp_ledger where user_id = '$ALL'")" "$NT:$((NT * 300)):$((NT * 300))"
    eq "insignias regionales: cuatro, una vez cada una" "$(q "select count(*) || ':' || (select count(*) from public.user_cosmetics where user_id = '$ALL' and cosmetic_id like 'insignia:regional:%') from public.user_region_badges where user_id = '$ALL'")" "4:4"
    eq "exactamente una respuesta desbloqueó cada región" "$(cat "$W"/conc-*.out | grep -o '"code": *"UNLOCKED"' | wc -l)" "4"

    echo "##### 6 · concurrencia sobre UN equipo (16 sesiones)"
    rm -f "$W"/one-*.out
    for i in $(seq 1 16); do ( settle "$CHINA" ":'plan_china_team'" "'[]'" "'$SEASON'" > "$W/one-$i.out" 2>&1 ) & done; wait
    eq "una sola COMPLETED" "$(cat "$W"/one-*.out | grep -o '"code": *"COMPLETED"' | wc -l)" "1"
    eq "las otras 15, ALREADY" "$(cat "$W"/one-*.out | grep -o '"code": *"ALREADY"' | wc -l)" "15"
    eq "300 XP en total" "$(q "select coalesce(sum(amount), 0) from public.season_xp_ledger where user_id = '$CHINA'")" "300"

    echo "##### 7 · insignia regional: bloqueada si falta una carta, desbloqueada si no"
    R=$(settle "$CHINA" "'[]'" ":'plan_emea'" "'$SEASON'")
    eq "EMEA a falta de una carta" "$(echo "$R" | grep -o '"code": *"INCOMPLETE"' | wc -l)" "1"
    R=$(settle "$CHINA" "'[]'" ":'plan_china'" "'$SEASON'")
    eq "China completa" "$(echo "$R" | grep -o '"code": *"UNLOCKED"' | wc -l)" "1"
    eq "guardada una vez, con su cosmético" "$(q "select string_agg(region, ',') || '|' || (select string_agg(cosmetic_id || ' ' || source, ',') from public.user_cosmetics where user_id = '$CHINA' and cosmetic_id like 'insignia:regional:%') from public.user_region_badges where user_id = '$CHINA'")" "China|insignia:regional:china team-collections:region:China"
    R=$(qv "select public.app_team_collections_settle('$CHINA'::uuid, '[]'::jsonb, jsonb_build_array(jsonb_build_object('region', 'Pacific', 'teams', 0, 'cards', '[]'::jsonb), jsonb_build_object('region', 'Marte', 'teams', 3, 'cards', '[\"x\"]'::jsonb)), '$SEASON', 300);")
    eq "región sin equipos: EMPTY; región inventada: ignorada" "$(echo "$R" | grep -o '"code": *"EMPTY"' | wc -l):$(echo "$R" | grep -c Marte)" "1:0"

    echo "##### 8 · permanencia: se desguazan las cartas y la insignia y la compleción siguen"
    economy_fp > "$W/sql-eco-mid.fp"
    diff "$W/sql-eco-before.fp" "$W/sql-eco-mid.fp" > /dev/null && ok "hasta aquí: créditos, cartas, sobres y libro de créditos idénticos (la liquidación solo lee el inventario)" || { ko "la liquidación cambió datos de economía"; diff "$W/sql-eco-before.fp" "$W/sql-eco-mid.fp" | head -5; }
    qv "delete from public.user_cards where user_id = '$CHINA' and card_id in (select jsonb_array_elements_text(:'china_cards'::jsonb));" > /dev/null
    eq "sin cartas de China en el inventario" "$(qv "select count(*) from public.user_cards where user_id = '$CHINA' and card_id in (select jsonb_array_elements_text(:'china_cards'::jsonb));")" "0"
    R=$(settle "$CHINA" ":'plan_china_team'" ":'plan_china'" "'$SEASON'")
    eq "la función no retira nada: ALREADY ×2" "$(echo "$R" | grep -o '"code": *"ALREADY"' | wc -l)" "2"
    eq "insignia, cosmético y compleción intactos" "$(q "select (select count(*) from public.user_region_badges where user_id = '$CHINA') || ':' || (select count(*) from public.user_cosmetics where user_id = '$CHINA' and cosmetic_id = 'insignia:regional:china') || ':' || (select count(*) from public.user_team_completions where user_id = '$CHINA')")" "1:1:1"
    eq "otra región que ya no cumple no se concede" "$(settle "$CHINA" "'[]'" ":'plan_all_regions'" "'$SEASON'" | grep -o '"code": *"UNLOCKED"' | wc -l)" "0"

    echo "##### 9 · entradas inválidas"
    eq "usuario inexistente" "$(settle "00000000-0000-4000-8000-000000000000" ":'plan_navi'" "'[]'" "null" | grep -o 'BAD_USER')" "BAD_USER"
    eq "cuerpo que no es una lista" "$(settle "$ALL" "'{}'" "'[]'" "null" | grep -o 'BAD_BODY')" "BAD_BODY"
    eq "equipo sin cartas o sin id: se ignora" "$(qv "select public.app_team_collections_settle('$EMPTY'::uuid, '[{\"id\":\"x\",\"cards\":[]},{\"cards\":[\"a\"]},{\"id\":\"y\"}]'::jsonb, '[]'::jsonb, '$SEASON', 300);" | grep -o '"teams": *\[\]' | wc -l)" "1"
    eq "XP negativos o cero: no se cobra" "$(qv "select public.app_team_collections_settle('$FIVE'::uuid, :'plan_navi'::jsonb, '[]'::jsonb, '$SEASON', -50);" | grep -o '"xpGained": *0' | wc -l)" "1"

    echo "##### 10 · aislamiento entre cuentas"
    eq "la cuenta sin cartas no tiene nada" "$(q "select (select count(*) from public.user_team_completions where user_id = '$EMPTY') + (select count(*) from public.user_region_badges where user_id = '$EMPTY') + (select count(*) from public.season_xp_ledger where user_id = '$EMPTY')")" "0"
    eq "compleciones de las cuentas de esta prueba" "$(q "select string_agg(split_part(u.email, '@', 1) || '=' || n, ' ' order by u.email) from (select user_id, count(*) n from public.user_team_completions group by 1) c join auth.users u on u.id = c.user_id where u.email like 'coll-tc%'")" "coll-tcall=$NT coll-tcchina=1 coll-tcfive=1"
    # Cualquier compleción de la base (también de otras cuentas sintéticas que la QA de navegador liquidó al entrar) es de
    # alguien que tuvo TODAS las cartas del equipo. tcchina se excluye: el paso 8 le quitó las suyas a propósito.
    eq "ninguna compleción sin todas sus cartas (salvo la desguazada a propósito)" "$(qv "select count(*) from public.user_team_completions c join auth.users u on u.id = c.user_id
         join lateral (select t->'cards' cards from jsonb_array_elements(:'plan_all_teams'::jsonb) t where t->>'id' = c.team_id) p on true
         where u.email <> 'coll-tcchina@example.invalid'
           and exists (select 1 from jsonb_array_elements_text(p.cards) x where not exists (select 1 from public.user_cards uc where uc.user_id = c.user_id and uc.card_id = x));")" "0"
    eq "XP totales de la temporada de QA" "$(q "select sum(amount) from public.season_xp_ledger where season_id = '$SEASON'")" "$(( (NT + 2) * 300 ))"
    [ "$fail" = 0 ] && echo "SQLTEST_OK" || echo "SQLTEST_CON_FALLOS"
    ;;
  txfail)
    # Error a mitad de la liquidación (disparador temporal en el libro de XP). Una transacción con ROLLBACK: no deja nada.
    CHINA=$(uid_of tcchina); [ -n "$CHINA" ] || { echo "falta coll-tcchina"; exit 1; }
    { cat "$W/tc-0075-vars.sql"; echo "\\set china '$CHINA'"; cat "$W/team-collections-0075.txfail.sql"; } | psqlq 2>&1 | tee "$W/txfail.out"
    grep -q "^TXFAIL_0075_OK" "$W/txfail.out" && echo "TXFAIL_OK 0075" || { echo "TXFAIL_CON_FALLOS"; fail=1; }
    ;;
  rollback)
    BEFORE=$(q "select (select count(*) from public.user_team_completions) || ':' || (select count(*) from public.user_region_badges)")
    KEEP=$(q "select (select count(*) || ':' || coalesce(sum(amount), 0) from public.season_xp_ledger) || '|' || (select count(*) from public.user_cosmetics where cosmetic_id like 'insignia:regional:%')")
    economy_fp > "$W/rb-before.fp"
    psqlq -q -f - < "$W/0075_team_collections.ROLLBACK.sql" || { echo "ROLLBACK_FAIL"; exit 1; }
    q "delete from public._qa_migrations where name = '0075_team_collections.sql'; notify pgrst, 'reload schema'" > /dev/null; sleep 2
    economy_fp > "$W/rb-after.fp"
    eq "función y tablas retiradas" "$(q "select (to_regprocedure('public.app_team_collections_settle(uuid,jsonb,jsonb,text,int)') is null)::text || (to_regclass('public.user_team_completions') is null)::text || (to_regclass('public.user_region_badges') is null)::text")" "truetruetrue"
    eq "archivo con TODAS las filas (nada perdido)" "$(q "select (select count(*) from public.ops_rollback_0075_user_team_completions) || ':' || (select count(*) from public.ops_rollback_0075_user_region_badges)")" "$BEFORE"
    eq "el archivo no es legible por clientes" "$(q "select bool_or(has_table_privilege(r, t, 'SELECT'))::text from unnest(array['anon','authenticated']) r, unnest(array['public.ops_rollback_0075_user_team_completions','public.ops_rollback_0075_user_region_badges']) t")" "false"
    eq "XP ya concedidos e insignias del jugador: intactos" "$(q "select (select count(*) || ':' || coalesce(sum(amount), 0) from public.season_xp_ledger) || '|' || (select count(*) from public.user_cosmetics where cosmetic_id like 'insignia:regional:%')")" "$KEEP"
    diff "$W/rb-before.fp" "$W/rb-after.fp" > /dev/null && ok "créditos, cartas, sobres y libro de créditos idénticos" || ko "el rollback cambió datos de economía"
    if psqlq -q -f - < "$W/0075_team_collections.ROLLBACK.sql" > "$W/rb-second.out" 2>&1; then ko "un segundo rollback no se rechazó"; else ok "segundo rollback rechazado sin tocar nada: $(grep -o 'ya existe un archivo[^:]*' "$W/rb-second.out" | head -1)"; fi
    eq "el archivo sigue completo tras el intento" "$(q "select (select count(*) from public.ops_rollback_0075_user_team_completions) || ':' || (select count(*) from public.ops_rollback_0075_user_region_badges)")" "$BEFORE"
    [ "$fail" = 0 ] && echo "ROLLBACK_OK 0075" || echo "ROLLBACK_CON_FALLOS"
    ;;
  restore)
    [ "$(q "select to_regclass('public.ops_rollback_0075_user_team_completions') is not null")" = "t" ] || { echo "no hay archivo que restaurar"; exit 1; }
    ARCH=$(q "select (select count(*) from public.ops_rollback_0075_user_team_completions) || ':' || (select count(*) from public.ops_rollback_0075_user_region_badges)")
    psqlq -1 -q -f - < "$W/0075_team_collections.sql" || { echo "REAPPLY_FAIL"; exit 1; }
    q "begin;
       insert into public.user_team_completions (user_id, team_id, completed_at, cards, xp_amount, xp_season_id, xp_granted_at) select user_id, team_id, completed_at, cards, xp_amount, xp_season_id, xp_granted_at from public.ops_rollback_0075_user_team_completions;
       insert into public.user_region_badges (user_id, region, unlocked_at, teams, cards) select user_id, region, unlocked_at, teams, cards from public.ops_rollback_0075_user_region_badges;
       drop table public.ops_rollback_0075_user_team_completions; drop table public.ops_rollback_0075_user_region_badges;
       insert into public._qa_migrations (name) values ('0075_team_collections.sql') on conflict do nothing;
       commit; notify pgrst, 'reload schema'" > /dev/null; sleep 2
    eq "filas devueltas a sus tablas" "$(q "select (select count(*) from public.user_team_completions) || ':' || (select count(*) from public.user_region_badges)")" "$ARCH"
    ALL=$(uid_of tcall); XP=$(q "select coalesce(sum(amount), 0) from public.season_xp_ledger where user_id = '$ALL'")
    R=$(qv "select public.app_team_collections_settle('$ALL'::uuid, :'plan_all_teams'::jsonb, :'plan_all_regions'::jsonb, '$SEASON', 300);")
    eq "tras restaurar, volver a liquidar no concede nada" "$(echo "$R" | grep -o '"xpGained": *0' | wc -l):$(q "select coalesce(sum(amount), 0) from public.season_xp_ledger where user_id = '$ALL'")" "1:$XP"
    [ "$fail" = 0 ] && echo "RESTORE_OK 0075" || echo "RESTORE_CON_FALLOS"
    ;;
esac
exit "$fail"
