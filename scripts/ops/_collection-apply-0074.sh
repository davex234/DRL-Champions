#!/usr/bin/env bash
# =============================================================================
# COLECCIONES ILIMITADAS · 0074 EN PRODUCCIÓN — ensayo (BEGIN…ROLLBACK) y aplicado (UNA transacción), con huellas.
# =============================================================================
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0074> bash /tmp/coll-rc/_collection-apply-0074.sh ensayo'
#   ssh nexusadmin@VPS 'EXPECT_SHA=<sha256 de 0074> bash /tmp/coll-rc/_collection-apply-0074.sh aplicar'
#   Ensayo del guion fuera de producción: DB=vrqa_db [DBNAME=<copia>] … ensayo | aplicar
#
# Mismo patrón que `_f872-apply-0073.sh`. Se PARA sin tocar nada si el fichero no es el revisado o si ya hay rastro de
# la 0074. La 0074 solo crea dos índices y una función: no escribe ni una fila. Imprime recuentos y huellas, nunca
# correos ni secretos. Las huellas se toman en modo de solo lectura.
# =============================================================================
set -uo pipefail
DB=${DB:-supabase_db_DRLCards}       # el ensayo del propio guion usa DB=vrqa_db (stack de QA)
DBNAME=${DBNAME:-postgres}           # y DBNAME=<copia restaurada del backup> para probarlo sobre datos reales copiados
F=${F:-/tmp/coll-rc/0074_collection_scale.sql}
EXPECT_SHA="${EXPECT_SHA:?falta EXPECT_SHA}"
MODE="${1:?ensayo|aplicar}"
q() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d "$DBNAME" -X -Atq -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>&1; }
stop() { echo "APPLY_STOP $*"; exit 1; }
check_eq() { [ "$2" = "$3" ] && echo "OK $1 ($2)" || stop "$1: esperado «$3», obtenido «$2»"; }

echo "== 1. fichero"
GOT=$(sha256sum "$F" | cut -d' ' -f1)
[ "$GOT" = "$EXPECT_SHA" ] || stop "sha256 distinto ($GOT)"
echo "sha256 OK $GOT"

echo "== 2. estado: sin rastro de 0074"
[ "$(q "select to_regprocedure('public.app_collection_summary(uuid)') is null")" = "t" ] || stop "la función ya existe"
[ "$(q "select count(*) from pg_indexes where schemaname = 'public' and indexname in ('user_cards_user_uid_idx','user_cards_user_card_uid_idx')")" = "0" ] || stop "ya hay índices de la 0074"
TABLES="auth.users public.profiles public.user_cards public.user_packs public.user_game public.duel_decks public.credit_transactions public.economy_ops public.craft_recipes public.content_pools public.content_pool_entries public.content_pack_pools public.card_mints"
fp() { for t in $TABLES; do printf '%s %s\n' "$t" "$(q "select count(*)||':'||coalesce(md5(string_agg(t::text, '|' order by t::text)),'-') from $t t")"; done; }
FNS_BEFORE=$(q "select count(*)||':'||md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")
IDX_BEFORE=$(q "select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'user_cards'")
T_BEFORE=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)
fp > /tmp/coll-rc/0074-before.fp
echo "huellas de $(wc -l < /tmp/coll-rc/0074-before.fp) tablas · funciones public: ${FNS_BEFORE%%:*} · índices de user_cards: $IDX_BEFORE"
echo "cuentas $(q "select count(*) from public.profiles") · créditos $(q "select sum(credits) from public.profiles") · cartas $(q "select count(*) from public.user_cards") · sobres $(q "select coalesce(sum(qty),0) from public.user_packs") · equipos $(q "select count(*) from public.duel_decks")"

# Comprobaciones que se hacen DENTRO de la transacción del ensayo y otra vez tras aplicar.
VERIFY=$(cat <<'SQL'
select 'indices=' || count(*) || ' validos=' || count(*) filter (where i.indisvalid and i.indisready) from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname in ('user_cards_user_uid_idx','user_cards_user_card_uid_idx');
select 'funcion=' || p.oid::regprocedure::text || ' volatilidad=' || p.provolatile::text || ' definer=' || p.prosecdef::text from pg_proc p where p.proname = 'app_collection_summary';
select 'ejecutable_por_clientes=' || bool_or(has_function_privilege(r, 'public.app_collection_summary(uuid)', 'EXECUTE'))::text from unnest(array['anon','authenticated']) r;
select 'ejecutable_por_servidor=' || has_function_privilege('service_role', 'public.app_collection_summary(uuid)', 'EXECUTE')::text;
-- La función frente a una consulta de referencia independiente (funciones de ventana), cuenta a cuenta.
with ref as (
  select u.id, coalesce(jsonb_agg(jsonb_build_object('card_id', r.card_id, 'n', r.n, 'locked', r.locked_n, 'numbered', r.numbered_n, 'first_at', r.first_at,
           'rep', jsonb_build_object('uid', r.uid, 'serial', r.serial, 'minted_version', r.minted_version, 'obtained_at', r.obtained_at, 'origin', r.origin, 'locked', r.locked)) order by r.card_id) filter (where r.card_id is not null), '[]'::jsonb) as cards
    from auth.users u left join lateral (
      select * from (
        select uc.*, row_number() over (partition by uc.card_id order by uc.serial asc nulls last, uc.uid asc) rn,
               count(*) over (partition by uc.card_id) n, count(*) filter (where uc.locked) over (partition by uc.card_id) locked_n,
               count(uc.serial) over (partition by uc.card_id) numbered_n, min(uc.obtained_at) over (partition by uc.card_id) first_at
          from public.user_cards uc where uc.user_id = u.id) x where rn = 1) r on true
   group by u.id)
select 'resumen_igual_a_la_referencia=' || count(*) filter (where f.s->'cards' = ref.cards and (f.s->>'total')::int = (select count(*) from public.user_cards where user_id = ref.id)) || '_de_' || count(*) || ' copias=' || sum((f.s->>'total')::int)
  from ref cross join lateral (select public.app_collection_summary(ref.id) as s) f;
SQL
)
EXPECT_VERIFY() {
  echo "$1" | grep -q '^indices=2 validos=2$' || stop "índices: $(echo "$1" | grep '^indices')"
  echo "$1" | grep -q '^funcion=app_collection_summary(uuid) volatilidad=s definer=false$' || stop "función: $(echo "$1" | grep '^funcion')"
  echo "$1" | grep -q '^ejecutable_por_clientes=false$' || stop "la función es ejecutable por roles de cliente"
  echo "$1" | grep -q '^ejecutable_por_servidor=true$' || stop "service_role no puede ejecutar la función"
  local n; n=$(q "select count(*) from auth.users")
  echo "$1" | grep -q "^resumen_igual_a_la_referencia=${n}_de_${n} " || stop "resumen ≠ referencia: $(echo "$1" | grep '^resumen')"
  echo "$1" | sed 's/^/   /'
}

docker cp "$F" "$DB:/tmp/0074.sql" >/dev/null || stop "docker cp"
if [ "$MODE" = "ensayo" ]; then
  echo "== 3. ENSAYO: aplicar dentro de una transacción, comprobar y ROLLBACK"
  OUT=$( { echo "begin;"; echo '\i /tmp/0074.sql'; echo "$VERIFY"; echo "rollback;"; } | docker exec -i "$DB" psql -U postgres -d "$DBNAME" -X -Atq -v ON_ERROR_STOP=1 2>&1 ); RC=$?
  docker exec "$DB" rm -f /tmp/0074.sql </dev/null
  [ "$RC" = 0 ] || { echo "$OUT" | tail -8; stop "el ensayo falló (nada quedó aplicado)"; }
  EXPECT_VERIFY "$OUT"
  check_eq "TRAS_EL_ENSAYO_SIN_FUNCION" "$(q "select to_regprocedure('public.app_collection_summary(uuid)') is null")" "t"
  check_eq "TRAS_EL_ENSAYO_INDICES_COMO_ANTES" "$(q "select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'user_cards'")" "$IDX_BEFORE"
  fp > /tmp/coll-rc/0074-after.fp
  diff /tmp/coll-rc/0074-before.fp /tmp/coll-rc/0074-after.fp >/dev/null && echo "DATOS_INTACTOS (el ensayo no cambió ninguna fila)" || { diff /tmp/coll-rc/0074-before.fp /tmp/coll-rc/0074-after.fp | head; stop "huellas distintas tras el ensayo"; }
  echo "ENSAYO_OK 0074 (ROLLBACK)"
  exit 0
fi

[ "$MODE" = "aplicar" ] || stop "modo desconocido"
echo "== 3. APLICAR (una transacción)"
T0=$(date +%s%N)
OUT=$(docker exec "$DB" psql -U postgres -d "$DBNAME" -X -v ON_ERROR_STOP=1 -1 -f /tmp/0074.sql </dev/null 2>&1); RC=$?
T1=$(date +%s%N)
docker exec "$DB" rm -f /tmp/0074.sql </dev/null
echo "exit=$RC en $(( (T1-T0)/1000000 )) ms · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$RC" != 0 ]; then echo "$OUT" | tail -8; stop "la transacción falló (y se revirtió entera): NO se improvisa nada"; fi

echo "== 4. después"
fp > /tmp/coll-rc/0074-after.fp
if diff /tmp/coll-rc/0074-before.fp /tmp/coll-rc/0074-after.fp >/dev/null; then echo "DATOS_INTACTOS (0074 no cambió ninguna fila)"; else
  diff /tmp/coll-rc/0074-before.fp /tmp/coll-rc/0074-after.fp | head; echo "AVISO_HUELLAS_DISTINTAS — actividad real durante el aplicado:"
  q "select 'libro', left(user_id::text,8), reason, count(*) from public.credit_transactions where created_at >= '$T_BEFORE' group by 2,3"
fi
V=$(echo "$VERIFY" | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" psql -U postgres -d "$DBNAME" -X -Atq -v ON_ERROR_STOP=1 2>&1) || stop "verificación: $V"
EXPECT_VERIFY "$V"
FNS_AFTER=$(q "select count(*)||':'||md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'app_collection_summary'")
check_eq "FUNCIONES_ANTERIORES_INTACTAS" "$FNS_AFTER" "$FNS_BEFORE"
check_eq "INDICES_ANTERIORES_CONSERVADOS" "$(q "select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'user_cards' and indexname not in ('user_cards_user_uid_idx','user_cards_user_card_uid_idx')")" "$IDX_BEFORE"
echo "índices de user_cards: $(q "select string_agg(indexrelname || ' ' || pg_size_pretty(pg_relation_size(indexrelid)), ' · ' order by indexrelname) from pg_stat_user_indexes where relname = 'user_cards'")"
# PostgREST debe ver la función nueva: recarga de su caché de esquema (el mismo aviso que se usó en el ensayo de QA).
docker exec "$DB" psql -U postgres -d "$DBNAME" -X -Atq -c "notify pgrst, 'reload schema'" </dev/null && echo "caché de esquema de PostgREST: recarga pedida"
echo "APPLY_OK 0074"
