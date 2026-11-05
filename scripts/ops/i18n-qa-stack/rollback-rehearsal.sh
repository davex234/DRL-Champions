#!/usr/bin/env bash
# =============================================================================
# ICON · ENSAYO COMPLETO DEL ROLLBACK SIN PÉRDIDAS (solo stack de QA aislado; se ejecuta en el VPS)
# =============================================================================
#   rollback-rehearsal.sh <carpeta build NUEVA> <carpeta build VIEJA> > acta.txt
#
# Recorre, con una cuenta sintética y la base de QA: compras con la release nueva → BARRERA + CUSTODIA → intentos de
# compra/apertura/crafteo rechazados sin cobrar → release vieja → retirar barrera → release nueva → devolución →
# los sobres devueltos entregan lo comprado. Sale ≠ 0 si algún paso pierde créditos, sobres o cartas.
# Necesita en /tmp/i18n-rc: rb.sh, app-swap.sh, rollback-probe.mjs y los tres SQL de scripts/_icon-odds/.
# =============================================================================
set -uo pipefail
NEW="${1:?carpeta de la build nueva}"; OLD="${2:?carpeta de la build vieja}"
W=/tmp/i18n-rc; cd "$W"
BATCH="ensayo-$(date -u +%H%M%S)"
psqlf() { docker exec -i vrqa_db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v batch="$BATCH" "$@"; }
q() { docker exec vrqa_db psql -U postgres -d postgres -X -At -c "$1"; }
fail=0; step() { echo; echo "##### $*"; }
must() { "$@" || { echo "!!! FALLO: $*"; fail=1; }; }
# Recuento EXACTO en la base (la foto de la API corta `ownedCards` en 1.000 filas y no vería una carta de más o de menos).
QA_EMAIL=$(grep -E '^QA_PLAYER_EMAIL=' /opt/nexus/projects/valorosters-i18n-qa/secrets/qa.env | cut -d= -f2-)
dbsnap() { q "select 'creditos=' || p.credits || ' cartas=' || (select count(*) from public.user_cards c where c.user_id = u.id) || ' sobres=' || coalesce((select string_agg(pack_id || ':' || qty, ',' order by pack_id) from public.user_packs k where k.user_id = u.id and qty > 0 and (pack_id like 'icon%' or pack_id = 'champions')), '-') from auth.users u join public.profiles p on p.id = u.id where u.email = '$QA_EMAIL'"; }
# frozen_exact: la ventana con la barrera, comparando además la base antes y después.
frozen_exact() { local a b; a=$(dbsnap); must ./rb.sh frozen; b=$(dbsnap); echo "base antes  : $a"; echo "base después: $b"; [ "$a" = "$b" ] && echo "SIN PÉRDIDAS (base, recuento exacto)" || { echo "!!! FALLO: la base cambió en la ventana"; fail=1; }; }
# open_exact <packId> <n>: abre una unidad y exige que la base gane exactamente n cartas.
open_exact() { local a b; a=$(q "select count(*) from public.user_cards c join auth.users u on u.id = c.user_id where u.email = '$QA_EMAIL'"); ./rb.sh open "$1"; b=$(q "select count(*) from public.user_cards c join auth.users u on u.id = c.user_id where u.email = '$QA_EMAIL'"); [ $((b - a)) = "$2" ] && echo "base: +$2 cartas (exacto)" || { echo "!!! FALLO: $1 entregó $((b - a)) cartas, se esperaban $2"; fail=1; }; }

step "0 · release NUEVA $(cat "$NEW/.next/BUILD_ID") · compras sintéticas (1 icon-single, 2 icon, 3 champions)"
must ./app-swap.sh "$NEW"; q "drop trigger if exists ops_icon_pack_freeze on public.user_packs" >/dev/null
must ./rb.sh buy

step "1 · barrera + custodia: ENSAYO (no debe escribir nada)"
must psqlf -f - < rollback-hold.sql | grep -E "antes|custodia|ENSAYO|VERIFIC|ERROR"
echo "barrera tras el ensayo: $(q "select count(*) from pg_trigger where tgname='ops_icon_pack_freeze'") (esperado 0)"
./rb.sh probe | grep "^estado:"

step "2 · barrera + custodia: COMMIT, con la release NUEVA todavía sirviendo"
must psqlf -v commit=1 -f - < rollback-hold.sql | grep -E "antes|custodia|COMMIT|VERIFIC|ERROR"
step "2b · repetir (idempotencia)"
must psqlf -v commit=1 -f - < rollback-hold.sql | grep -E "custodia|COMMIT|VERIFIC|ERROR"
q "select 'custodia', batch, pack_id, qty, released_at is null from ops_pack_escrow where batch='$BATCH' order by id"

step "3 · LA VENTANA: release NUEVA + barrera. Comprar, abrir y craftear ICON debe rechazarse SIN cobrar ni consumir"
frozen_exact

step "4 · release VIEJA $(cat "$OLD/.next/BUILD_ID") con la barrera todavía puesta"
must ./app-swap.sh "$OLD"
frozen_exact
./rb.sh probe | grep -E "^estado|página /(inventario|packs|tienda) "

step "5 · retirar la barrera (release vieja sirviendo)"
must psqlf -v commit=1 -f - < rollback-unfreeze.sql | grep -E "barrera|custodia|COMMIT|ERROR"
./rb.sh probe | grep "^estado:"

step "6 · vuelve la release NUEVA · devolución: ensayo, commit, repetir"
must ./app-swap.sh "$NEW"
must psqlf -f - < rollback-release.sql | grep -E "antes|despues|ENSAYO|VERIFIC|ERROR"
./rb.sh probe | grep "^estado:"
must psqlf -v commit=1 -f - < rollback-release.sql | grep -E "antes|despues|COMMIT|VERIFIC|ERROR"
must psqlf -v commit=1 -f - < rollback-release.sql | grep -E "despues|COMMIT|VERIFIC|ERROR"
./rb.sh probe | grep "^estado:"
echo "custodia sin devolver: $(q "select coalesce(sum(qty),0) from ops_pack_escrow where released_at is null") (esperado 0) · barrera: $(q "select count(*) from pg_trigger where tgname='ops_icon_pack_freeze'") (esperado 0)"

step "7 · los sobres devueltos entregan lo comprado (1 ICON, 3 ICON, 3 ICON) y el crafteo 3:1 funciona"
open_exact icon-single 1; open_exact icon 3; open_exact icon 3; ./rb.sh craft; open_exact icon 3

echo; [ "$fail" = 0 ] && echo "ENSAYO_OK lote=$BATCH" || echo "ENSAYO_CON_FALLOS lote=$BATCH"
exit "$fail"
