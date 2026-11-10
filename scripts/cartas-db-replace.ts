/**
 * REEMPLAZO TOTAL DEL CATÁLOGO EN BD — genera UN fichero SQL que se ejecuta como UNA transacción.
 *
 *   npx tsx scripts/cartas-db-replace.ts --out <fichero.sql> [--commit]
 *
 * Sin `--commit` el fichero termina en ROLLBACK (ensayo): hace todo el trabajo, ejecuta todas las
 * verificaciones y deshace. Con `--commit` termina en COMMIT. Se ejecuta con
 * `psql -v ON_ERROR_STOP=1 -1`: cualquier error —incluida una verificación que falle— aborta la
 * transacción entera, así que no existe un estado a medias.
 *
 * Por qué SQL y no supabase-js: el cliente HTTP no tiene transacciones. Un reemplazo hecho con
 * llamadas sueltas podría quedarse a medias (el requisito es «sin importación parcial»).
 *
 * Qué hace, en orden (decisiones del usuario, 2026-09-21):
 *   1. Propiedad y mazos antiguos: se BORRAN (con backup verificado previo, fuera de este script).
 *      Sin mapeo viejo→nuevo. La vitrina del perfil se vacía (la fila se conserva: guarda logros).
 *   2. Catálogo: se borran entradas de pools, anclas, versiones y cartas; se insertan las cartas del
 *      catálogo diseñado (`CARDS`, que sale de `src/data/cardCatalog.ts`) con su versión 1, con las
 *      MISMAS funciones del juego (`toCardRow`, `cardChecksum`) — nada se transcribe a mano.
 *   3. `_bump_catalog()` sube la versión y recalcula la huella en SQL.
 *   4. Pools: cada pool existente recibe su pertenencia nueva por `app_content_pool_set_entries`
 *      (la RPC oficial: audita y sube la distribución), con la misma lógica que
 *      `content-pools:migrate` (EXPLICIT, peso 1) y `content-pools:boost` (RULE, peso 5).
 *   5. Verificaciones (dentro de la transacción): huella del catálogo = la de TypeScript, recuentos,
 *      cero huérfanos, cero instancias, pertenencia de cada pool = la esperada.
 *
 * Lo que NO toca: `content_players` (los jugadores siguen; los que ya no tienen carta no se borran),
 * los registros de auditoría (`content_audit_log`, `market_audit`, `transactions`: son historia),
 * las partidas terminadas (`duel_matches` guarda su propia foto; sus `deck_id` pasan a NULL por la
 * clave ajena ON DELETE SET NULL), economía, pase, misiones y Tactical Coach.
 */
import { writeFileSync } from "node:fs";
import { CARDS, getPlayer } from "../src/data/catalog";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { DEFAULT_WEIGHT } from "../src/domain/packs/weighted";
import { DESIGNED_EDITIONS } from "../src/domain/cards/variants";
import { CARD_MANIFEST } from "../src/data/cardCatalog";
import { toCardRow, cardChecksum, catalogChecksum } from "../src/server/catalog/rows";
import { isTeamPackCard } from "../src/data/teamIdentities";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("--out");
const COMMIT = process.argv.includes("--commit");
if (!OUT) { console.error("Uso: npx tsx scripts/cartas-db-replace.ts --out <fichero.sql> [--commit]"); process.exit(1); }

/** Mismo valor que `TEAM_BOOST_WEIGHT` de `content-pools-boost.ts` (lo comprueba `teamPackCatalog.test`). */
const TEAM_BOOST_WEIGHT = 5;
const REASON = "Reemplazo total del catálogo por las cartas diseñadas (Cartas\\, 2026-09-21)";

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const jlit = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

// ── Catálogo: exactamente el del juego. ──
if (CARDS.length !== CARD_MANIFEST.length) throw new Error(`CARDS (${CARDS.length}) ≠ manifiesto (${CARD_MANIFEST.length})`);
for (const c of CARDS) {
  if (!DESIGNED_EDITIONS.has(c.variantId)) throw new Error(`${c.id}: edición fuera del catálogo diseñado`);
  if (!getPlayer(c.playerId)) throw new Error(`${c.id}: jugador desconocido`);
}
const rows = CARDS.map((c, i) => toCardRow(c, i));
const expectedChecksum = catalogChecksum(CARDS.map((c) => ({ cardId: c.id, checksum: cardChecksum(c) })));

// ── Pools: la misma deducción que content-pools:migrate / :boost, sobre el catálogo nuevo. ──
const registry = new CardRegistry(CARDS);
const pools: { poolId: string; entries: { card_id: string; weight: number; mode: "INCLUDE" }[]; note: string }[] = [];
for (const pack of PACKS) {
  const { flat } = buildPool(registry, pack);
  pools.push({ poolId: `pack-${pack.id}`, entries: flat.map((c) => ({ card_id: c.id, weight: DEFAULT_WEIGHT, mode: "INCLUDE" })), note: `${flat.length} cartas elegibles` });
  if (pack.team) {
    const del = flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), pack.team));
    pools.push({ poolId: `boost-${pack.id}`, entries: del.map((c) => ({ card_id: c.id, weight: TEAM_BOOST_WEIGHT, mode: "INCLUDE" })), note: `${del.length} cartas de ${pack.team}` });
  }
}
const totalEntries = pools.reduce((s, p) => s + p.entries.length, 0);

// ── SQL ──
const L: string[] = [];
L.push(`-- Generado por scripts/cartas-db-replace.ts · ${new Date().toISOString()} · ${COMMIT ? "COMMIT" : "ENSAYO (ROLLBACK)"}`);
L.push(`-- ${rows.length} cartas · ${pools.length} pools · ${totalEntries} entradas · huella ${expectedChecksum}`);
L.push(`\\set ON_ERROR_STOP on`);
L.push(`BEGIN;`);
L.push(`SET LOCAL statement_timeout = 0;`);
L.push(`SET LOCAL lock_timeout = '30s';`);
L.push(`SELECT 'antes' AS fase, (SELECT count(*) FROM content_cards) AS cartas, (SELECT count(*) FROM user_cards) AS instancias, (SELECT count(*) FROM duel_decks) AS mazos, (SELECT count(*) FROM content_pool_entries) AS entradas;`);
L.push(``);
L.push(`-- 1 · Propiedad y mazos antiguos (decisión: borrar con backup).`);
L.push(`DELETE FROM duel_active_deck;`);
L.push(`DELETE FROM duel_decks;  -- cascada: duel_pvp_queue (cerradas); SET NULL en duel_matches / duel_challenges`);
L.push(`UPDATE player_profile_customization SET showcase_card_uids = '{}', version = version + 1, updated_at = now() WHERE cardinality(showcase_card_uids) > 0;`);
for (const t of ["market_listings", "market_offers", "market_flags", "user_card_favorites", "user_cards", "card_mints", "card_reference", "card_price_daily", "card_price_stats", "collection_items", "inventory", "player_cards", "special_cards"]) {
  L.push(`DELETE FROM ${t};`);
}
L.push(``);
L.push(`-- 2 · Catálogo antiguo fuera.`);
L.push(`DELETE FROM content_pool_entries;`);
L.push(`DELETE FROM content_card_market_anchor;`);
L.push(`DELETE FROM content_card_versions;`);
L.push(`DELETE FROM content_cards;`);
L.push(``);
L.push(`-- 3 · Catálogo diseñado dentro (toCardRow + versión 1).`);
const cols = "card_id, player_id, variant_id, ordinal, ovr, stats, combat, stat_boost, rarity_rank, rarity_bucket, data_version, source, generated_at, origin, lifecycle, definition_version, checksum";
L.push(`INSERT INTO content_cards (${cols}) VALUES`);
L.push(rows.map((r) => `  (${[lit(r.card_id), lit(r.player_id), lit(r.variant_id), r.ordinal, r.ovr, jlit(r.stats), jlit(r.combat), r.stat_boost, r.rarity_rank, lit(r.rarity_bucket), lit(r.data_version), lit(r.source), `${lit(r.generated_at)}::timestamptz`, lit(r.origin), lit(r.lifecycle), r.definition_version, lit(r.checksum)].join(", ")})`).join(",\n") + ";");
const vcols = "card_id, version, player_id, variant_id, ovr, combat, stats, stat_boost, rarity_rank, rarity_bucket, data_version, source, generated_at, checksum, effective_from";
L.push(`INSERT INTO content_card_versions (${vcols}) VALUES`);
L.push(rows.map((r) => `  (${[lit(r.card_id), 1, lit(r.player_id), lit(r.variant_id), r.ovr, jlit(r.combat), jlit(r.stats), r.stat_boost, r.rarity_rank, lit(r.rarity_bucket), lit(r.data_version), lit(r.source), `${lit(r.generated_at)}::timestamptz`, lit(r.checksum), `${lit(r.generated_at)}::timestamptz`].join(", ")})`).join(",\n") + ";");
L.push(`SET CONSTRAINTS ALL IMMEDIATE;`);
L.push(`SELECT 'catálogo' AS fase, public._bump_catalog() AS version_catalogo;`);
L.push(``);
L.push(`-- 4 · Pools: pertenencia nueva por la RPC oficial.`);
for (const p of pools) {
  L.push(`SELECT public.app_content_pool_set_entries(${lit(p.poolId)}, ${jlit(p.entries)}, ${lit(`${REASON}: ${p.note}`)}, NULL) IS NOT NULL AS ${`ok_${p.poolId.replace(/[^a-z0-9]/g, "_")}`};`);
}
L.push(``);
L.push(`-- 5 · Verificaciones. Cualquier fallo lanza una excepción y la transacción entera se deshace.`);
const expectedPools = Object.fromEntries(pools.map((p) => [p.poolId, p.entries.length]));
L.push(`DO $verify$
DECLARE v int; v_txt text; r record; esperado jsonb := ${jlit(expectedPools)};
BEGIN
  SELECT count(*) INTO v FROM content_cards;                          IF v <> ${rows.length} THEN RAISE EXCEPTION 'content_cards = % (esperado ${rows.length})', v; END IF;
  SELECT count(*) INTO v FROM content_card_versions;                  IF v <> ${rows.length} THEN RAISE EXCEPTION 'content_card_versions = % (esperado ${rows.length})', v; END IF;
  SELECT count(*) INTO v FROM content_cards WHERE lifecycle <> 'PUBLISHED'; IF v <> 0 THEN RAISE EXCEPTION '% cartas no PUBLISHED', v; END IF;
  SELECT count(*) INTO v FROM content_cards WHERE variant_id NOT IN (${[...DESIGNED_EDITIONS].map(lit).join(", ")}); IF v <> 0 THEN RAISE EXCEPTION '% cartas de ediciones antiguas', v; END IF;
  SELECT catalog_checksum INTO v_txt FROM content_catalog_version WHERE id;  IF v_txt <> ${lit(expectedChecksum)} THEN RAISE EXCEPTION 'huella del catálogo % ≠ TypeScript ${expectedChecksum}', v_txt; END IF;
  SELECT cards_count INTO v FROM content_catalog_version WHERE id;    IF v <> ${rows.length} THEN RAISE EXCEPTION 'cards_count = %', v; END IF;
  SELECT count(*) INTO v FROM content_cards c LEFT JOIN content_card_versions x ON x.card_id = c.card_id AND x.version = c.definition_version WHERE x.card_id IS NULL;
  IF v <> 0 THEN RAISE EXCEPTION '% cartas sin su versión vigente', v; END IF;
  SELECT count(*) INTO v FROM content_cards c LEFT JOIN content_players p ON p.id = c.player_id WHERE p.id IS NULL; IF v <> 0 THEN RAISE EXCEPTION '% cartas sin jugador', v; END IF;
  SELECT count(*) INTO v FROM v_content_card_orphans;                 IF v <> 0 THEN RAISE EXCEPTION '% huérfanos (v_content_card_orphans)', v; END IF;
  SELECT count(*) INTO v FROM v_instance_version_gaps;                IF v <> 0 THEN RAISE EXCEPTION '% instancias con hueco de versión', v; END IF;
  SELECT count(*) INTO v FROM user_cards;                             IF v <> 0 THEN RAISE EXCEPTION 'user_cards = %', v; END IF;
  SELECT count(*) INTO v FROM card_mints;                             IF v <> 0 THEN RAISE EXCEPTION 'card_mints = %', v; END IF;
  SELECT count(*) INTO v FROM duel_decks;                             IF v <> 0 THEN RAISE EXCEPTION 'duel_decks = %', v; END IF;
  SELECT count(*) INTO v FROM duel_active_deck;                       IF v <> 0 THEN RAISE EXCEPTION 'duel_active_deck = %', v; END IF;
  SELECT count(*) INTO v FROM player_profile_customization WHERE cardinality(showcase_card_uids) > 0; IF v <> 0 THEN RAISE EXCEPTION '% vitrinas con cartas', v; END IF;
  SELECT count(*) INTO v FROM market_listings;                        IF v <> 0 THEN RAISE EXCEPTION 'market_listings = %', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries e LEFT JOIN content_cards c ON c.card_id = e.card_id WHERE c.card_id IS NULL; IF v <> 0 THEN RAISE EXCEPTION '% entradas de pool a cartas inexistentes', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries;                   IF v <> ${totalEntries} THEN RAISE EXCEPTION 'content_pool_entries = % (esperado ${totalEntries})', v; END IF;
  SELECT count(*) INTO v FROM content_pools;                          IF v <> ${pools.length} THEN RAISE EXCEPTION 'content_pools = % (esperado ${pools.length}): hay pools que el reemplazo no conoce', v; END IF;
  FOR r IN SELECT key, value::int AS n FROM jsonb_each_text(esperado) LOOP
    SELECT count(*) INTO v FROM content_pool_entries WHERE pool_id = r.key;
    IF v <> r.n THEN RAISE EXCEPTION 'pool %: % entradas (esperado %)', r.key, v, r.n; END IF;
  END LOOP;
  SELECT entries_count INTO v FROM content_distribution_version WHERE id; IF v <> ${totalEntries} THEN RAISE EXCEPTION 'entries_count = %', v; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: ${rows.length} cartas, ${pools.length} pools, ${totalEntries} entradas, 0 huérfanos, 0 instancias antiguas';
END
$verify$;`);
L.push(`SELECT 'después' AS fase, (SELECT count(*) FROM content_cards) AS cartas, (SELECT version FROM content_catalog_version) AS version_catalogo, (SELECT version FROM content_distribution_version) AS version_distribucion, (SELECT count(*) FROM content_pool_entries) AS entradas;`);
L.push(COMMIT ? `COMMIT;` : `ROLLBACK;`);
L.push(``);

writeFileSync(OUT, L.join("\n"), "utf8");
console.log(`${OUT}\n  ${COMMIT ? "COMMIT" : "ENSAYO (ROLLBACK)"} · ${rows.length} cartas · ${pools.length} pools · ${totalEntries} entradas`);
console.log(`  huella esperada ${expectedChecksum}`);
for (const p of pools.filter((x) => x.entries.length === 0)) console.log(`  AVISO: ${p.poolId} queda VACÍO (${p.note})`);
