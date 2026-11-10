#!/usr/bin/env bash
# =============================================================================
# COLECCIONES ILIMITADAS · EQUIPOS GUARDADOS ENTRE VERSIONES (solo stack de QA aislado; se ejecuta en el VPS)
# =============================================================================
#   collection-compat-teams.sh <carpeta build NUEVA> <carpeta build ANTERIOR>
#
# Con la build ANTERIOR crea un equipo legal cuyas cartas son, a propósito, copias que NO son el mejor ejemplar de su
# carta (el caso delicado: la build nueva solo trae un ejemplar por carta en el estado). Después comprueba que la build
# NUEVA lo ve igual —mismas cartas, misma validez—, que el servidor lo revalida al marcarlo activo, y lo mismo a la
# inversa. Sale ≠ 0 si algo no cuadra.
# =============================================================================
set -uo pipefail
NEW="${1:?carpeta de la build nueva}"; OLD="${2:?carpeta de la build anterior}"
QA=/opt/nexus/projects/valorosters-i18n-qa; W=${RC_WORK:-/tmp/coll-rc}
set -a; . "$QA/secrets/qa.env"; set +a
COLL_PW=$(cat "$W/coll.pw"); C=coll-10000@example.invalid; fail=0
q() { docker exec vrqa_db psql -U postgres -d postgres -X -At -c "$1" < /dev/null; }
probe() { docker exec -i -e QA_ANON_KEY -e PROBE_PW="$COLL_PW" vrqa_app node --input-type=module - "$@" < "$W/_collection-compat-probe.mjs"; }
ok() { echo "OK    $*"; }
ko() { echo "FALLO $*"; fail=1; }
deck() { echo "$1" | sed 's/.*"equiposDetalle":\(\[.*\]\),"desguace".*/\1/'; }
U=$(q "select id from auth.users where email = '$C'")
q "delete from public.duel_decks where user_id = '$U' and name like 'Compat%'" > /dev/null
q "delete from public.api_rate_limits where true" > /dev/null

echo "##### ANTERIOR crea el equipo"
bash /tmp/i18n-rc/app-swap.sh "$OLD" | tail -1
T=$(probe team "$C" Compat); echo "$T"
if echo "$T" | grep -q '"crear":200' && echo "$T" | grep -q '"valido":true' && echo "$T" | grep -q '"activar":200'; then ok "equipo creado, válido y activo con la anterior"; else ko "no se pudo crear el equipo con la anterior"; fi
# ¿Cuántas de sus cartas NO son el mejor ejemplar (serie más baja; sin serie, uid más bajo)?
NONREP=$(q "with d as (select unnest(card_uids) uid from public.duel_decks where user_id = '$U' and name = 'Compat'), best as (select distinct on (card_id) card_id, uid from public.user_cards where user_id = '$U' order by card_id, serial asc nulls last, uid asc) select count(*) filter (where b.uid is distinct from d.uid) || ' de ' || count(*) from d join public.user_cards uc on uc.uid = d.uid join best b on b.card_id = uc.card_id")
echo "cartas del equipo que NO son el mejor ejemplar de su carta: $NONREP"
if [ "${NONREP%% *}" -ge 1 ]; then ok "el equipo usa copias que la build nueva no trae en el estado (caso delicado cubierto)"; else ko "el equipo no cubre el caso delicado"; fi
OLD_R=$(probe read "$C")

echo "##### NUEVA lo lee y lo revalida"
bash /tmp/i18n-rc/app-swap.sh "$NEW" | tail -1
NEW_R=$(probe read "$C")
if [ "$(deck "$OLD_R")" = "$(deck "$NEW_R")" ]; then ok "mismo equipo, mismas cartas, misma validez en las dos versiones"; else ko "el equipo difiere"; echo "   anterior: $(deck "$OLD_R" | cut -c1-300)"; echo "   nueva   : $(deck "$NEW_R" | cut -c1-300)"; fi
echo "   $(deck "$NEW_R" | sed 's/"uids":"[^"]*"/"uids":"…"/g' | cut -c1-220)"
A=$(probe activate "$C" Compat); echo "$A"
if echo "$A" | grep -q '"valido":true' && echo "$A" | grep -q '"activar":200' && echo "$A" | grep -q '"cartas":10'; then ok "la nueva lo revalida entero al marcarlo activo (10 cartas, legal, propio)"; else ko "la nueva no revalida el equipo"; fi

echo "##### y de vuelta: un equipo guardado con la NUEVA, leído por la ANTERIOR"
N=$(probe team "$C" Compat2); echo "$N"
if echo "$N" | grep -q '"crear":200' && echo "$N" | grep -q '"valido":true'; then ok "la nueva crea un equipo válido"; else ko "la nueva no pudo crear el equipo"; fi
NEW_R2=$(probe read "$C")
bash /tmp/i18n-rc/app-swap.sh "$OLD" | tail -1
OLD_R2=$(probe read "$C")
if [ "$(deck "$OLD_R2")" = "$(deck "$NEW_R2")" ]; then ok "la anterior ve los dos equipos igual que la nueva (rollback del código: equipos intactos y válidos)"; else ko "difieren tras volver a la anterior"; echo "   anterior: $(deck "$OLD_R2" | cut -c1-300)"; echo "   nueva   : $(deck "$NEW_R2" | cut -c1-300)"; fi
echo "   válidos según la anterior: $(deck "$OLD_R2" | grep -o '"valido":true' | wc -l) de $(deck "$OLD_R2" | grep -o '"id"' | wc -l)"
bash /tmp/i18n-rc/app-swap.sh "$NEW" | tail -1
if [ "$fail" = 0 ]; then echo "EQUIPOS_OK"; else echo "EQUIPOS_CON_FALLOS"; fi
exit "$fail"
