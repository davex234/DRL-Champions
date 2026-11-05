#!/usr/bin/env bash
# =============================================================================
# COLECCIONES ILIMITADAS · COMPATIBILIDAD Y ROLLBACK (solo stack de QA aislado; se ejecuta en el VPS)
# =============================================================================
#   collection-compat.sh <carpeta build NUEVA> <carpeta build ANTERIOR>
#
# Antes de desplegar, demuestra en QA —con la 0074 ya aplicada— que:
#   1 · la release ANTERIOR funciona con la migración puesta (lecturas y una operación económica real),
#   2 · cambiar de build (ida y vuelta) no cambia ni una fila: cartas, créditos, sobres, equipos y libro,
#   3 · el endpoint nuevo es de solo lectura (recorrerlo no escribe nada),
#   4 · los equipos guardados son los mismos y con la misma validez en las dos versiones,
#   5 · los ejemplares numerados conservan su identidad (serie ↔ uid) tras quitar y volver a poner la migración,
#   6 · quitar la 0074 y volver a ponerla no cambia ninguna fila, y la build nueva funciona también sin ella.
# Sale ≠ 0 si algo no cuadra. Necesita en $W: _collection-compat-probe.mjs, coll.pw, 0074 y su ROLLBACK.
# =============================================================================
set -uo pipefail
NEW="${1:?carpeta de la build nueva}"; OLD="${2:?carpeta de la build anterior}"
QA=/opt/nexus/projects/valorosters-i18n-qa; W=${RC_WORK:-/tmp/coll-rc}
set -a; . "$QA/secrets/qa.env"; set +a
COLL_PW=$(cat "$W/coll.pw")
fail=0
q() { docker exec vrqa_db psql -U postgres -d postgres -X -At -c "$1" < /dev/null; }
psqlf() { docker exec -i vrqa_db psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 "$@"; }
probe() { local pw="$1"; shift; docker exec -i -e QA_ANON_KEY -e PROBE_PW="$pw" vrqa_app node --input-type=module - "$@" < "$W/_collection-compat-probe.mjs"; }
build() { docker exec vrqa_app cat /app/.next/BUILD_ID; }
step() { echo; echo "##### $*"; }
ok() { echo "OK    $*"; }
ko() { echo "FALLO $*"; fail=1; }
same() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1"; echo "   antes  : $2"; echo "   después: $3"; fi; }
# Huella de TODO lo que no puede cambiar: cada carta (con su serie y su dueño), créditos, sobres, equipos y libro.
fp() {
  q "select 'cartas ' || count(*) || ' ' || md5(coalesce(string_agg(uid::text || user_id::text || card_id || coalesce(serial::text,'-') || coalesce(minted_version::text,'-') || locked::text || origin || obtained_at::text, '|' order by uid), '')) from public.user_cards"
  q "select 'creditos ' || sum(credits) || ' ' || md5(string_agg(id::text || credits::text, '|' order by id)) from public.profiles"
  q "select 'sobres ' || coalesce(sum(qty),0) || ' ' || md5(coalesce(string_agg(user_id::text || pack_id || qty::text, '|' order by user_id, pack_id), '')) from public.user_packs"
  q "select 'equipos ' || count(*) || ' ' || md5(coalesce(string_agg(id::text || user_id::text || name || array_to_string(card_uids, ','), '|' order by id), '')) from public.duel_decks"
  q "select 'libro ' || count(*) || ' ' || coalesce(sum(delta),0) from public.credit_transactions"
  q "select 'operaciones ' || count(*) from public.economy_ops"
}
P="$QA_PLAYER_EMAIL"; C=coll-10000@example.invalid

step "0 · punto de partida"
bash /tmp/i18n-rc/app-swap.sh "$NEW" | tail -1
echo "0074: $(q "select coalesce(to_regprocedure('public.app_collection_summary(uuid)')::text, 'NO aplicada')") · índices: $(q "select count(*) from pg_indexes where indexname in ('user_cards_user_uid_idx','user_cards_user_card_uid_idx')")"
q "delete from public.api_rate_limits where true" > /dev/null
FP0=$(fp); echo "$FP0" | sed 's/^/   /'
NEW_P=$(probe "$QA_PLAYER_PASSWORD" read "$P"); NEW_C=$(probe "$COLL_PW" read "$C")
echo "$NEW_P" | cut -c1-260
TOP=$(q "select card_id from public.user_cards uc join auth.users u on u.id = uc.user_id where u.email = '$C' and serial is not null group by 1 order by count(*) desc, 1 limit 1")
SER_API0=$(probe "$COLL_PW" serials "$C" "$TOP")
SER_DB0=$(q "select string_agg(serial || ':' || uid, ',' order by serial) from public.user_cards uc join auth.users u on u.id = uc.user_id where u.email = '$C' and card_id = '$TOP' and serial is not null")

step "3 · el endpoint nuevo es de SOLO LECTURA"
probe "$COLL_PW" walk "$C" 30 | cut -c1-200
same "recorrer /api/game/cards (30 páginas + consulta por uid) no escribe ni una fila" "$FP0" "$(fp)"

step "5 · ejemplares numerados: la API devuelve exactamente serie↔uid de la base"
same "numeradas de $TOP (API = base)" "$SER_DB0" "$(echo "$SER_API0" | sed 's/.*"lista":"\([^"]*\)".*/\1/')"
echo "   $(echo "$SER_API0" | sed 's/"lista":"[^"]*",//' | cut -c1-200)"

step "1 y 2 · release ANTERIOR ($(cat "$OLD/.next/BUILD_ID")) con la 0074 APLICADA"
bash /tmp/i18n-rc/app-swap.sh "$OLD" | tail -1
same "cambiar a la build anterior no cambia ninguna fila" "$FP0" "$(fp)"
OLD_P=$(probe "$QA_PLAYER_PASSWORD" read "$P"); OLD_C=$(probe "$COLL_PW" read "$C")
echo "$OLD_P" | cut -c1-260
for r in "$OLD_P" "$OLD_C"; do
  echo "$r" | grep -q '"estado":200' && echo "$r" | grep -q '"equipos":200' && echo "$r" | grep -q '"desguace":200' && ! echo "$r" | grep -o '"lecturas":{[^}]*}' | grep -qE ':(4[0-9][0-9]|5[0-9][0-9])' \
    && ok "la anterior lee estado, equipos, desguace, crafteo, forja, misiones, tienda y temporada con la migración puesta" || ko "la anterior falla alguna lectura: $(echo "$r" | cut -c1-300)"
done
CARDS_B=$(q "select count(*) from public.user_cards uc join auth.users u on u.id = uc.user_id where u.email = '$C'"); CRED_B=$(q "select credits from public.profiles p join auth.users u on u.id = p.id where u.email = '$C'")
OPEN=$(probe "$COLL_PW" open "$C"); echo "$OPEN" | cut -c1-220
CARDS_A=$(q "select count(*) from public.user_cards uc join auth.users u on u.id = uc.user_id where u.email = '$C'"); CRED_A=$(q "select credits from public.profiles p join auth.users u on u.id = p.id where u.email = '$C'")
[ $((CARDS_A - CARDS_B)) = 5 ] && [ $((CRED_B - CRED_A)) = 2500 ] && ok "la anterior compra y abre un sobre con la migración puesta: +5 cartas, −2.500 créditos (base)" || ko "apertura en la anterior: cartas $CARDS_B→$CARDS_A, créditos $CRED_B→$CRED_A"

step "4 · equipos guardados: los mismos y con la misma validez en las dos versiones"
deck() { echo "$1" | sed 's/.*"equiposDetalle":\(\[.*\]\),"desguace".*/\1/'; }
same "equipos del jugador de QA (anterior = nueva)" "$(deck "$OLD_P")" "$(deck "$NEW_P")"
echo "   equipos: $(deck "$NEW_P" | grep -o '"id"' | wc -l) · válidos: $(deck "$NEW_P" | grep -o '"valido":true' | wc -l) · uids en equipos que existen en la base: $(q "select count(*) filter (where exists (select 1 from public.user_cards uc where uc.uid = x.uid and uc.user_id = d.user_id)) || ' de ' || count(*) from public.duel_decks d cross join lateral unnest(d.card_uids) as x(uid)")"

step "2 · vuelta a la NUEVA: el rollback y el rollforward del código no tocan datos"
FP1=$(fp)
bash /tmp/i18n-rc/app-swap.sh "$NEW" | tail -1
same "volver a la build nueva no cambia ninguna fila" "$FP1" "$(fp)"
NEW_C2=$(probe "$COLL_PW" read "$C")
echo "$NEW_C2" | grep -q "\"total\":$CARDS_A" && ok "la nueva ve las $CARDS_A cartas, incluidas las 5 abiertas con la anterior" || ko "total tras volver: $(echo "$NEW_C2" | cut -c1-200)"

step "6 · quitar la 0074, usar la nueva sin ella, y volver a ponerla"
psqlf -q -f - < "$W/0074_collection_scale.ROLLBACK.sql" > /dev/null && q "notify pgrst, 'reload schema'" > /dev/null; sleep 2
echo "0074: $(q "select coalesce(to_regprocedure('public.app_collection_summary(uuid)')::text, 'no existe')") · índices: $(q "select count(*) from pg_indexes where indexname in ('user_cards_user_uid_idx','user_cards_user_card_uid_idx')")"
same "revertir la 0074 no cambia ninguna fila" "$FP1" "$(fp)"
NEW_C3=$(probe "$COLL_PW" read "$C")
echo "$NEW_C3" | grep -q "\"total\":$CARDS_A" && echo "$NEW_C3" | grep -q '"estado":200' && ok "la nueva funciona SIN la migración (mismo total: $CARDS_A)" || ko "nueva sin 0074: $(echo "$NEW_C3" | cut -c1-200)"
psqlf -1 -q -f - < "$W/0074_collection_scale.sql" > /dev/null 2>&1 && q "notify pgrst, 'reload schema'" > /dev/null; sleep 2
echo "0074: $(q "select coalesce(to_regprocedure('public.app_collection_summary(uuid)')::text, 'no existe')") · índices: $(q "select count(*) from pg_indexes where indexname in ('user_cards_user_uid_idx','user_cards_user_card_uid_idx')") · ejecutable por: $(q "select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges where routine_name = 'app_collection_summary'")"
same "volver a aplicar la 0074 no cambia ninguna fila" "$FP1" "$(fp)"
same "numeradas de $TOP tras quitar y poner la migración (serie↔uid idénticos)" "$SER_DB0" "$(q "select string_agg(serial || ':' || uid, ',' order by serial) from public.user_cards uc join auth.users u on u.id = uc.user_id where u.email = '$C' and card_id = '$TOP' and serial is not null")"
SER_API1=$(probe "$COLL_PW" serials "$C" "$TOP")
same "y la API las devuelve igual que antes" "$(echo "$SER_API0" | sed 's/.*"lista":"\([^"]*\)".*/\1/')" "$(echo "$SER_API1" | sed 's/.*"lista":"\([^"]*\)".*/\1/')"

echo; echo "sirviendo: $(build)"
[ "$fail" = 0 ] && echo "COMPAT_OK" || echo "COMPAT_CON_FALLOS"
exit "$fail"
