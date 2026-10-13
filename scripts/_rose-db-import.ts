/**
 * INSTRUMENTO (fuera de CI) · ALTA DE LAS 2 CARTAS DE ROSÉ EN BD — genera UN fichero SQL de UNA transacción.
 *
 *   npx tsx scripts/_rose-db-import.ts --entries <pool_id|card_id|weight.psv> --pools <ids.txt> --out <f.sql> [--commit]
 *
 * Aditivo sobre el catálogo diseñado ya publicado (329 cartas): no borra nada. En orden:
 *   1. Guardas: la BD está en el estado esperado (329 cartas, huella = la del código SIN Rosé, 0 cartas de Rosé).
 *   2. `ordinal` de las cartas existentes = su índice en `CARDS` (el pool de un sobre se recorre por ordinal:
 *      servidor y código deben ver el mismo orden). Columna sin versión ni trigger.
 *   3. Las 2 cartas nuevas con `toCardRow` + versión 1 (mismas funciones que `cartas-db-replace.ts`).
 *   4. `_bump_catalog()` (versión y huella en SQL).
 *   5. Pools que cambian (misma deducción que `cartas-db-pools.ts`) por `app_content_pool_set_entries`.
 *   6. Verificaciones dentro de la transacción; cualquier fallo la deshace entera.
 * Sin `--commit` termina en ROLLBACK (ensayo). No toca propiedad, economía, precios, pesos ni sobres de usuarios.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CARDS } from "../src/data/catalog";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { DEFAULT_WEIGHT } from "../src/domain/packs/weighted";
import { DESIGNED_EDITIONS } from "../src/domain/cards/variants";
import { toCardRow, cardChecksum, catalogChecksum } from "../src/server/catalog/rows";
import { isTeamPackCard } from "../src/data/teamIdentities";
import { TEAM_BOOST_WEIGHT } from "../src/data/teamPackCatalog";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("--out"), ENTRIES = arg("--entries"), POOLS = arg("--pools");
const COMMIT = process.argv.includes("--commit");
if (!OUT || !ENTRIES || !POOLS) { console.error("Uso: --entries <psv> --pools <txt> --out <sql> [--commit]"); process.exit(1); }

const NEW_IDS = ["rosa__base", "rosa__masters-sdc"];
const REASON = "Alta de las 2 cartas de Rosé (BBL), reevaluadas: solo estaban fuera por mojibake (2026-09-21)";
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const jlit = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

// ── Catálogo ──
const rows = CARDS.map((c, i) => toCardRow(c, i));
const nuevas = rows.filter((r) => NEW_IDS.includes(r.card_id));
if (nuevas.length !== NEW_IDS.length) throw new Error(`faltan cartas nuevas en CARDS: ${nuevas.map((r) => r.card_id)}`);
for (const r of nuevas) if (!DESIGNED_EDITIONS.has(r.variant_id as never)) throw new Error(`${r.card_id}: edición fuera del catálogo`);
const existentes = rows.filter((r) => !NEW_IDS.includes(r.card_id));
const expectedChecksum = catalogChecksum(CARDS.map((c) => ({ cardId: c.id, checksum: cardChecksum(c) })));
const oldChecksum = catalogChecksum(CARDS.filter((c) => !NEW_IDS.includes(c.id)).map((c) => ({ cardId: c.id, checksum: cardChecksum(c) })));

// ── Pools: esperado (código) frente a persistido (BD) ──
type Entry = { card_id: string; weight: number; mode: "INCLUDE" };
const registry = new CardRegistry(CARDS);
const expected = new Map<string, { entries: Entry[]; why: string }>();
for (const pack of PACKS) {
  const flat = buildPool(registry, pack).flat;
  expected.set(`pack-${pack.id}`, { entries: flat.map((c) => ({ card_id: c.id, weight: DEFAULT_WEIGHT, mode: "INCLUDE" })), why: `pool de ${pack.id}: ${flat.length} cartas elegibles` });
  if (pack.team) {
    const del = flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), pack.team));
    expected.set(`boost-${pack.id}`, { entries: del.map((c) => ({ card_id: c.id, weight: TEAM_BOOST_WEIGHT, mode: "INCLUDE" })), why: `sesgo de ${pack.id}: ${del.length} cartas con el equipo impreso` });
  }
}
const persisted = new Map<string, Map<string, number>>();
for (const line of readFileSync(ENTRIES, "utf8").split(/\r?\n/).filter(Boolean)) {
  const [pool, card, w] = line.split("|");
  if (!persisted.has(pool)) persisted.set(pool, new Map());
  persisted.get(pool)!.set(card, Number(w));
}
const poolIds = new Set(readFileSync(POOLS, "utf8").split(/\r?\n/).filter(Boolean));
for (const id of expected.keys()) if (!poolIds.has(id)) throw new Error(`pool ${id} no existe en la BD: este instrumento no crea pools`);
for (const id of poolIds) if (!expected.has(id)) throw new Error(`pool ${id} de la BD no lo deduce el juego`);
const changes: { poolId: string; entries: Entry[]; why: string; before: number }[] = [];
for (const [poolId, exp] of expected) {
  const cur = persisted.get(poolId) ?? new Map();
  const same = cur.size === exp.entries.length && exp.entries.every((e) => cur.get(e.card_id) === e.weight);
  if (same) continue;
  // Aditivo: un pool solo puede GANAR cartas de Rosé, nunca perder ni cambiar el peso de otra.
  for (const [card, w] of cur) {
    const e = exp.entries.find((x) => x.card_id === card);
    if (!e || e.weight !== w) throw new Error(`${poolId}: cambiaría ${card} (${w} → ${e?.weight ?? "fuera"})`);
  }
  const added = exp.entries.filter((e) => !cur.has(e.card_id)).map((e) => e.card_id);
  if (added.some((id) => !NEW_IDS.includes(id))) throw new Error(`${poolId}: añadiría cartas que no son de Rosé: ${added}`);
  changes.push({ poolId, entries: exp.entries, why: exp.why, before: cur.size });
}
const total = [...expected.values()].reduce((s, e) => s + e.entries.length, 0);

// ── SQL ──
const L: string[] = [];
L.push(`-- Generado por scripts/_rose-db-import.ts · ${new Date().toISOString()} · ${COMMIT ? "COMMIT" : "ENSAYO (ROLLBACK)"}`);
L.push(`-- ${rows.length} cartas (+${nuevas.length}) · ${changes.length} pools cambian · ${total} entradas · huella ${expectedChecksum}`);
L.push(`\\set ON_ERROR_STOP on`);
L.push(`BEGIN;`);
L.push(`SET LOCAL lock_timeout = '30s';`);
L.push(`CREATE TEMP TABLE _antes ON COMMIT DROP AS SELECT (SELECT count(*) FROM user_cards) AS uc, (SELECT count(*) FROM card_mints) AS mints, (SELECT count(*) FROM user_packs) AS up, (SELECT coalesce(sum(credits),0) FROM profiles) AS creditos;`);
L.push(`DO $guard$
DECLARE v int; v_txt text;
BEGIN
  SELECT count(*) INTO v FROM content_cards; IF v <> ${existentes.length} THEN RAISE EXCEPTION 'guarda: content_cards = % (esperado ${existentes.length})', v; END IF;
  SELECT count(*) INTO v FROM content_cards WHERE player_id = 'rosa'; IF v <> 0 THEN RAISE EXCEPTION 'guarda: ya hay % cartas de Rosé', v; END IF;
  SELECT count(*) INTO v FROM content_players WHERE id = 'rosa'; IF v <> 1 THEN RAISE EXCEPTION 'guarda: jugador rosa ausente'; END IF;
  SELECT catalog_checksum INTO v_txt FROM content_catalog_version WHERE id; IF v_txt <> ${lit(oldChecksum)} THEN RAISE EXCEPTION 'guarda: huella % ≠ la del catálogo de 329', v_txt; END IF;
END
$guard$;`);
L.push(`-- 2 · ordinal = índice en CARDS`);
// `content_cards_ordinal_uniq` no es diferible: primero se apartan los que se mueven y luego se colocan.
L.push(`CREATE TEMP TABLE _ord ON COMMIT DROP AS SELECT * FROM (VALUES\n${existentes.map((r) => `  (${lit(r.card_id)}, ${r.ordinal})`).join(",\n")}\n) AS v(id, o);`);
L.push(`UPDATE content_cards c SET ordinal = v.o + 1000000 FROM _ord v WHERE c.card_id = v.id AND c.ordinal <> v.o;`);
L.push(`UPDATE content_cards c SET ordinal = v.o FROM _ord v WHERE c.card_id = v.id AND c.ordinal >= 1000000;`);
L.push(`-- 3 · cartas nuevas + versión 1`);
const cols = "card_id, player_id, variant_id, ordinal, ovr, stats, combat, stat_boost, rarity_rank, rarity_bucket, data_version, source, generated_at, origin, lifecycle, definition_version, checksum";
L.push(`INSERT INTO content_cards (${cols}) VALUES\n${nuevas.map((r) => `  (${[lit(r.card_id), lit(r.player_id), lit(r.variant_id), r.ordinal, r.ovr, jlit(r.stats), jlit(r.combat), r.stat_boost, r.rarity_rank, lit(r.rarity_bucket), lit(r.data_version), lit(r.source), `${lit(r.generated_at)}::timestamptz`, lit(r.origin), lit(r.lifecycle), r.definition_version, lit(r.checksum)].join(", ")})`).join(",\n")};`);
const vcols = "card_id, version, player_id, variant_id, ovr, combat, stats, stat_boost, rarity_rank, rarity_bucket, data_version, source, generated_at, checksum, effective_from";
L.push(`INSERT INTO content_card_versions (${vcols}) VALUES\n${nuevas.map((r) => `  (${[lit(r.card_id), 1, lit(r.player_id), lit(r.variant_id), r.ovr, jlit(r.combat), jlit(r.stats), r.stat_boost, r.rarity_rank, lit(r.rarity_bucket), lit(r.data_version), lit(r.source), `${lit(r.generated_at)}::timestamptz`, lit(r.checksum), `${lit(r.generated_at)}::timestamptz`].join(", ")})`).join(",\n")};`);
L.push(`SET CONSTRAINTS ALL IMMEDIATE;`);
L.push(`SELECT 'catálogo' AS fase, public._bump_catalog() AS version_catalogo;`);
L.push(`-- 5 · pools`);
for (const c of changes) {
  L.push(`-- ${c.poolId}: ${c.before} → ${c.entries.length}`);
  L.push(`SELECT public.app_content_pool_set_entries(${lit(c.poolId)}, ${jlit(c.entries)}, ${lit(`${REASON}: ${c.why}`)}, NULL) IS NOT NULL AS ok_${c.poolId.replace(/[^a-z0-9]/g, "_")};`);
}
const ordinals = Object.fromEntries(rows.map((r) => [r.card_id, r.ordinal]));
const exp = Object.fromEntries([...expected].map(([k, v]) => [k, v.entries.length]));
L.push(`DO $verify$
DECLARE v int; v_txt text; r record; esperado jsonb := ${jlit(exp)}; ords jsonb := ${jlit(ordinals)};
BEGIN
  SELECT count(*) INTO v FROM content_cards;                IF v <> ${rows.length} THEN RAISE EXCEPTION 'content_cards = %', v; END IF;
  SELECT count(*) INTO v FROM content_card_versions;        IF v <> ${rows.length} THEN RAISE EXCEPTION 'content_card_versions = %', v; END IF;
  SELECT count(*) INTO v FROM content_cards WHERE lifecycle <> 'PUBLISHED'; IF v <> 0 THEN RAISE EXCEPTION '% no PUBLISHED', v; END IF;
  SELECT count(*) INTO v FROM content_cards c WHERE (ords ->> c.card_id)::int IS DISTINCT FROM c.ordinal; IF v <> 0 THEN RAISE EXCEPTION '% ordinales ≠ código', v; END IF;
  SELECT catalog_checksum INTO v_txt FROM content_catalog_version WHERE id; IF v_txt <> ${lit(expectedChecksum)} THEN RAISE EXCEPTION 'huella % ≠ TypeScript', v_txt; END IF;
  SELECT cards_count INTO v FROM content_catalog_version WHERE id; IF v <> ${rows.length} THEN RAISE EXCEPTION 'cards_count = %', v; END IF;
  SELECT count(*) INTO v FROM content_cards c LEFT JOIN content_card_versions x ON x.card_id = c.card_id AND x.version = c.definition_version WHERE x.card_id IS NULL; IF v <> 0 THEN RAISE EXCEPTION '% sin versión', v; END IF;
  SELECT count(*) INTO v FROM v_content_card_orphans; IF v <> 0 THEN RAISE EXCEPTION '% huérfanos', v; END IF;
  FOR r IN SELECT key, value::int AS n FROM jsonb_each_text(esperado) LOOP
    SELECT count(*) INTO v FROM content_pool_entries WHERE pool_id = r.key;
    IF v <> r.n THEN RAISE EXCEPTION 'pool %: % entradas (esperado %)', r.key, v, r.n; END IF;
  END LOOP;
  SELECT count(*) INTO v FROM content_pool_entries; IF v <> ${total} THEN RAISE EXCEPTION 'entradas % (esperado ${total})', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries e LEFT JOIN content_cards c USING (card_id) WHERE c.card_id IS NULL; IF v <> 0 THEN RAISE EXCEPTION '% entradas rotas', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries WHERE weight <= 0; IF v <> 0 THEN RAISE EXCEPTION '% pesos no positivos', v; END IF;
  SELECT entries_count INTO v FROM content_distribution_version WHERE id; IF v <> ${total} THEN RAISE EXCEPTION 'entries_count = %', v; END IF;
  -- Nada de usuarios: ni cartas, ni acuñaciones, ni sobres, ni créditos.
  IF (SELECT uc FROM _antes) <> (SELECT count(*) FROM user_cards) OR (SELECT mints FROM _antes) <> (SELECT count(*) FROM card_mints)
     OR (SELECT up FROM _antes) <> (SELECT count(*) FROM user_packs) OR (SELECT creditos FROM _antes) <> (SELECT coalesce(sum(credits),0) FROM profiles)
  THEN RAISE EXCEPTION 'se ha tocado propiedad o economía de usuarios'; END IF;
  SELECT count(*) INTO v FROM user_cards WHERE card_id LIKE 'rosa\\_\\_%'; IF v <> 0 THEN RAISE EXCEPTION 'Rosé concedida a % usuarios', v; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: ${rows.length} cartas, ${changes.length} pools actualizados, ${total} entradas, 0 rotas';
END
$verify$;`);
L.push(`SELECT 'después' AS fase, (SELECT count(*) FROM content_cards) AS cartas, (SELECT version FROM content_catalog_version) AS version_catalogo, (SELECT version FROM content_distribution_version) AS version_distribucion, (SELECT count(*) FROM content_pool_entries) AS entradas;`);
L.push(COMMIT ? `COMMIT;` : `ROLLBACK;`);
writeFileSync(OUT, L.join("\n") + "\n", "utf8");
console.log(`${OUT} · ${COMMIT ? "COMMIT" : "ENSAYO"} · ${rows.length} cartas · ${changes.length} pools cambian · ${total} entradas · huella ${expectedChecksum}`);
console.log(`  ordinales que se desplazan: ${existentes.filter((r) => r.ordinal !== CARDS.filter((c) => !NEW_IDS.includes(c.id)).findIndex((c) => c.id === r.card_id)).length}`);
for (const c of changes) console.log(`  ${c.poolId.padEnd(22)} ${String(c.before).padStart(3)} → ${String(c.entries.length).padStart(3)}`);
