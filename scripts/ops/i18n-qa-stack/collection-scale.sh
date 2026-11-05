#!/usr/bin/env bash
# =============================================================================
# COLECCIONES ILIMITADAS · PRUEBA DE CARGA (solo stack de QA aislado; se ejecuta en el VPS)
# =============================================================================
#   collection-scale.sh seed                 cuentas sintéticas coll-<n>@example.invalid con n cartas cada una
#   collection-scale.sh measure <etiqueta>   mide cada cuenta contra la app de QA → $W/scale/<etiqueta>-<n>.jsonl
#   collection-scale.sh db <etiqueta>        planes y tiempos de las consultas en la base (EXPLAIN ANALYZE)
#   collection-scale.sh migrate | unmigrate  aplica / revierte la 0074 EN LA BASE DE QA
#   collection-scale.sh security | concurrency
#   collection-scale.sh ui [tamaño] [idiomas]   pantallas reales en Chrome con la cuenta grande
#   collection-scale.sh cleanup              borra las cuentas sintéticas y el ayudante de medida
#
# Nunca toca producción: usa los contenedores vrqa_* y sus secretos propios. Las cuentas son sintéticas
# (@example.invalid) y su contraseña se genera aquí y no sale del VPS.
# Necesita en $W: _collection-scale-qa.mjs, _collection-scale-ui.ts, cards.txt (ids de carta del catálogo),
# 0074_collection_scale.sql y su ROLLBACK.
# =============================================================================
set -euo pipefail
QA=/opt/nexus/projects/valorosters-i18n-qa
W=${RC_WORK:-/tmp/coll-rc}
SIZES=${SIZES:-"0 100 999 1000 1001 5000 10000 50000 60000"}
mkdir -p "$W/scale"
set -a; . "$QA/secrets/qa.env"; set +a
[ -s "$W/coll.pw" ] || { umask 077; openssl rand -hex 16 > "$W/coll.pw"; }
export COLL_PW; COLL_PW=$(cat "$W/coll.pw")
psqlq() { docker exec -i vrqa_db psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 "$@"; }
probe() { docker exec -i -e QA_ANON_KEY -e QA_SERVICE_KEY -e COLL_PW vrqa_app node --input-type=module - "$@" < "$W/_collection-scale-qa.mjs"; }
uid_of() { psqlq -c "select id from auth.users where email = 'coll-$1@example.invalid'" < /dev/null; }
mem() { docker stats --no-stream --format '{{.Name}} {{.MemUsage}} cpu={{.CPUPerc}}' vrqa_app vrqa_db vrqa_rest | tr '\n' ' '; }

case "${1:?seed|measure|db|migrate|unmigrate|security|concurrency|ui|cleanup}" in
  seed)
    # Ayudante de medida (solo QA): cuántas sentencias sobre la colección ha ejecutado la base.
    psqlq <<'SQL'
create extension if not exists pg_stat_statements;
create or replace function public._qa_stmt_calls() returns bigint language sql security definer set search_path = public, extensions as $$
  select coalesce(sum(calls), 0)::bigint from pg_stat_statements
   where query ilike '%user_cards%' or query ilike '%app_collection_summary%' or query ilike '%duel_decks%' or query ilike '%card_mints%'
$$;
revoke all on function public._qa_stmt_calls() from public, anon, authenticated;
grant execute on function public._qa_stmt_calls() to service_role;
notify pgrst, 'reload schema';
SQL
    sleep 2
    probe setup "$(echo $SIZES | tr ' ' ',')" | tee "$W/scale/users.json"
    idx=0
    for n in $SIZES; do
      idx=$((idx + 1)); u=$(uid_of "$n")
      [ -n "$u" ] || { echo "sin cuenta para $n"; exit 1; }
      # 40 % de las copias en UNA carta (para probar «las copias de una carta»); el resto repartido por el catálogo.
      # Una de cada 97 lleva número de serie (único por carta: desplazado por cuenta).
      { echo "begin;"; echo "create temp table _c (n serial primary key, id text) on commit drop;"; echo "copy _c (id) from stdin;"; cat "$W/cards.txt"; echo '\.';
        cat <<SQL
delete from public.user_cards where user_id = '$u';
insert into public.user_cards (user_id, card_id, serial, origin, locked, obtained_at)
select '$u', c.id, case when g % 97 = 0 then 1000000 + $idx * 100000 + g else null end, 'pack', false, now() - make_interval(secs => g)
  from generate_series(1, $n) g
  join _c c on c.n = case when g % 10 < 4 then 1 else 2 + (g % ((select count(*) from _c) - 1)) end;
update public.profiles set credits = 5000000 where id = '$u';
commit;
SQL
      } | psqlq -q > /dev/null
      echo "sembrada coll-$n: $(psqlq -c "select count(*) || ' cartas, ' || count(distinct card_id) || ' distintas' from public.user_cards where user_id = '$u'" < /dev/null)"
    done
    psqlq -c "analyze public.user_cards" < /dev/null
    echo "user_cards total: $(psqlq -c 'select count(*) from public.user_cards' < /dev/null) · tabla $(psqlq -c "select pg_size_pretty(pg_total_relation_size('public.user_cards'))" < /dev/null)"
    ;;
  measure)
    L="${2:?etiqueta}"
    echo "app: $(docker exec vrqa_app cat /app/.next/BUILD_ID) · 0074: $(psqlq -c "select case when to_regprocedure('public.app_collection_summary(uuid)') is null then 'NO aplicada' else 'aplicada' end" < /dev/null) · antes: $(mem)"
    for n in $SIZES; do
      real=$(psqlq -c "select count(*) from public.user_cards where user_id = '$(uid_of "$n")'" < /dev/null)
      probe run "$n" "$real" > "$W/scale/$L-$n.jsonl" 2> "$W/scale/$L-$n.err" || { echo "FALLO $n"; tail -3 "$W/scale/$L-$n.err"; }
      echo "coll-$n ($real cartas): $(grep -c '"ok":true' "$W/scale/$L-$n.jsonl") OK · $(grep -c '"ok":false' "$W/scale/$L-$n.jsonl" || true) FALLO · $(mem)"
    done
    ;;
  db)
    L="${2:?etiqueta}"; u=$(uid_of "${3:-50000}")
    {
      echo "### índices de user_cards"; psqlq -c "select indexrelname || ' · ' || pg_size_pretty(pg_relation_size(indexrelid)) from pg_stat_user_indexes where relname = 'user_cards' order by 1" < /dev/null
      echo "### página por cursor (1.000 filas a mitad de colección)"
      psqlq -c "explain (analyze, buffers, costs off, timing on) select uid, card_id, serial, origin, locked, obtained_at, minted_version from public.user_cards where user_id = '$u' and uid > (select uid from public.user_cards where user_id = '$u' order by uid offset 25000 limit 1) order by uid limit 1000" < /dev/null
      echo "### página por DESPLAZAMIENTO equivalente (lo que se evita)"
      psqlq -c "explain (analyze, buffers, costs off, timing on) select uid, card_id from public.user_cards where user_id = '$u' order by uid offset 25000 limit 1000" < /dev/null
      echo "### copias de una carta, primera página por uid"
      psqlq -c "explain (analyze, buffers, costs off, timing on) select uid from public.user_cards where user_id = '$u' and card_id = (select card_id from public.user_cards where user_id = '$u' group by 1 order by count(*) desc limit 1) order by uid limit 49" < /dev/null
      echo "### resumen por carta (agregación completa)"
      psqlq -c "explain (analyze, buffers, costs off, timing on) select card_id, count(*), count(*) filter (where locked), count(serial), min(obtained_at) from public.user_cards where user_id = '$u' group by card_id" < /dev/null
      if [ "$(psqlq -c "select to_regprocedure('public.app_collection_summary(uuid)') is not null" < /dev/null)" = "t" ]; then
        echo "### app_collection_summary (5 llamadas)"
        { echo '\timing on'; for i in 1 2 3 4 5; do echo "select length(public.app_collection_summary('$u')::text) || ' B';"; done; } | psqlq
      fi
    } > "$W/scale/db-$L.txt" 2>&1
    grep -E "^###|Execution Time|^Time:| B$|· [0-9]" "$W/scale/db-$L.txt"
    ;;
  migrate)
    f="$W/0074_collection_scale.sql"; [ -f "$f" ] || f="$W/gate/supabase/migrations/0074_collection_scale.sql"
    psqlq -1 -q -f - < "$f" && psqlq -c "insert into public._qa_migrations (name) values ('0074_collection_scale.sql') on conflict do nothing; notify pgrst, 'reload schema'" < /dev/null
    sleep 2; echo "0074 aplicada en la base de QA · índices: $(psqlq -c "select string_agg(indexname, ', ' order by indexname) from pg_indexes where tablename = 'user_cards'" < /dev/null)"
    echo "ejecutable por: $(psqlq -c "select string_agg(grantee, ', ' order by grantee) from information_schema.routine_privileges where routine_name = 'app_collection_summary'" < /dev/null)"
    ;;
  unmigrate)
    psqlq -q -f - < "$W/0074_collection_scale.ROLLBACK.sql" && psqlq -c "delete from public._qa_migrations where name = '0074_collection_scale.sql'; notify pgrst, 'reload schema'" < /dev/null
    sleep 2; echo "0074 revertida · función: $(psqlq -c "select coalesce(to_regprocedure('public.app_collection_summary(uuid)')::text, 'no existe')" < /dev/null) · índices: $(psqlq -c "select string_agg(indexname, ', ' order by indexname) from pg_indexes where tablename = 'user_cards'" < /dev/null)"
    ;;
  security)
    psqlq -c "delete from public.api_rate_limits where true" < /dev/null > /dev/null 2>&1 || true
    probe security "${2:-10000}" "${3:-1001}" | tee "$W/scale/security.jsonl" | sed 's/^/  /'
    echo "seguridad: $(grep -c '"ok":true' "$W/scale/security.jsonl") OK · $(grep -c '"ok":false' "$W/scale/security.jsonl" || true) FALLO"
    ;;
  concurrency)
    n="${2:-5000}"; u=$(uid_of "$n")
    before=$(psqlq -c "select count(*) || ' cartas · ' || (select credits from public.profiles where id = '$u') || ' créditos' from public.user_cards where user_id = '$u'" < /dev/null)
    probe concurrency "$n" | tee "$W/scale/concurrency.jsonl" | sed 's/^/  /'
    echo "base antes: $before"
    echo "base después: $(psqlq -c "select count(*) || ' cartas · ' || count(distinct card_id) || ' distintas · ' || (select credits from public.profiles where id = '$u') || ' créditos · uid repetidos: ' || (count(*) - count(distinct uid)) from public.user_cards where user_id = '$u'" < /dev/null)"
    echo "libro: $(psqlq -c "select count(*) || ' asientos · suma ' || coalesce(sum(delta), 0) from public.credit_transactions where user_id = '$u' and reason like 'salvage%'" < /dev/null)"
    ;;
  ui)
    # Pantallas reales en un navegador (contenedor con Chrome en la red de la app de QA). No compra ni desguaza.
    n="${2:-50000}"; G=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}' vrqa_app)
    mkdir -p "$W/scale/ui"; chmod 777 "$W/scale/ui"
    docker run --rm --name vrqa_coll_ui --memory 4g --cpus 4 --shm-size 1g --network container:vrqa_app       -e BASE_URL=http://127.0.0.1:3027 -e QA_ANON_KEY -e COLL_PW -e UI_OUT=logs/ui -e QA_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage" -e HOME=/tmp       -v "$G:/app:ro" -v "$W/_collection-scale-ui.ts:/qa/_collection-scale-ui.ts:ro" -v "$W/scale/ui:/work/logs/ui" -w /work vrqa-chrome:2       bash -c "ln -sfn /app/node_modules /work/node_modules; mkdir -p /work/scripts/lib; cp /app/scripts/lib/cdp.ts /work/scripts/lib/; cp /qa/_collection-scale-ui.ts /work/scripts/; cp /app/tsconfig.json /work/; exec node node_modules/tsx/dist/cli.mjs scripts/_collection-scale-ui.ts $n ${3:-es,ja}" 2>&1 | tee "$W/scale/ui-$n.log" | grep -E "^(FAIL|RESULTADO|cuenta)" || true
    ;;
  cleanup)
    psqlq -c "delete from auth.users where email like 'coll-%@example.invalid'" -c "drop function if exists public._qa_stmt_calls()" -c "notify pgrst, 'reload schema'" < /dev/null
    rm -f "$W/coll.pw"
    echo "cuentas sintéticas borradas · user_cards: $(psqlq -c 'select count(*) from public.user_cards' < /dev/null)"
    ;;
esac
