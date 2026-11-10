/**
 * F58.1 · REGRESIÓN DEL POOL DEL SOBRE ORO.
 *
 * El Sobre Oro nació (F57.x) después de provisionar los pools `pack-<id>` y se quedó sin el suyo. No cambiaba lo que
 * salía (sin pool, la elegibilidad cae a las reglas del PackDef, que hoy son las mismas 331 cartas), pero lo dejaba fuera
 * de la administración de pools. Estas pruebas fijan:
 *   · la regla del panel (`drawSourceOf`): distribución por clase ≠ sobre por rareza, y la ausencia del pool se detecta;
 *   · el CONTRATO DE DATOS sobre la foto real de la BD tras F58.1 (`pool-snapshot-after.json`): todos los sobres públicos
 *     tienen su `pack-<id>`, y `pack-oro` es idéntico a los otros cinco de la línea principal (EXPLICIT, peso 1, @100);
 *   · la EQUIVALENCIA: con ese pool, Oro reparte exactamente lo mismo que sin él (mismas semillas, mismas cartas).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKS, getPack } from "@/data/packs";
import { CardRegistry } from "@/collection/registry";
import { PackEngine } from "@/pack/engine";
import { buildPool } from "@/domain/packs/pool";
import { freshPity } from "@/domain/packs/pity";
import { composeDistribution, type PackDistribution, type PoolDef } from "@/domain/packs/distribution";
import { MAIN_PACK_LINE, mainPackDistribution } from "@/domain/packs/packClass";
import { drawSourceOf, packsMissingEligibilityPool, type PackBinding } from "./packAdmin";

type Snap = { version: number; pools: { id: string; mode: PoolDef["mode"]; rules: PoolDef["rules"] }[]; entries: { pool_id: string; card_id: string; weight: number | string; mode: "INCLUDE" | "EXCLUDE" }[]; packPools: { pack_id: string; pool_id: string; priority: number }[] };
const SNAP = JSON.parse(readFileSync(join(process.cwd(), "docs/product/qa/fase58-1-gold-pool/pool-snapshot-after.json"), "utf8")) as Snap;
const bindings: PackBinding[] = SNAP.packPools.map((p) => ({ ...p, enabled: true }));
const members = (poolId: string) => new Set(SNAP.entries.filter((e) => e.pool_id === poolId).map((e) => e.card_id));

test("REGLA · el panel distingue sobres por clase de sobres por rareza y detecta el pool de elegibilidad que falta", () => {
  const oro = getPack("oro")!, emea = getPack("emea")!, th = getPack("team-heretics")!;
  const withPool = drawSourceOf(oro, [{ pack_id: "oro", pool_id: "pack-oro", priority: 100, enabled: true }]);
  assert.equal(withPool.mode, "class-distribution");
  assert.equal(withPool.missingEligibilityPool, false);
  assert.match(withPool.probability, /F57\.3/);
  const without = drawSourceOf(oro, []);
  assert.equal(without.missingEligibilityPool, true, "Oro sin pool (lo que había antes de F58.1) se marca");
  assert.equal(drawSourceOf(emea, bindings).mode, "rarity-weights");
  const team = drawSourceOf(th, bindings);
  assert.deepEqual(team.pools.map((p) => p.role).sort(), ["boost", "eligibility"]);
  assert.deepEqual(packsMissingEligibilityPool([oro], []), ["oro"]);
});

test("DATOS (BD real tras F58.1) · todos los sobres públicos tienen su pool pack-<id>; el Sobre Oro incluido", () => {
  // ICON (2026-10-09): el Sobre ICON nuevo (`icon-single`) aún NO tiene su pool en la foto de la BD: se crea en el despliegue
  // con `scripts/_icon-odds/pool-sql.ts` (mismo mecanismo que F58.1). Hasta entonces el admin lo marca, y solo a él.
  assert.deepEqual(packsMissingEligibilityPool(PACKS, bindings), ["icon-single"]);
  assert.deepEqual(SNAP.packPools.filter((p) => p.pack_id === "oro"), [{ pack_id: "oro", pool_id: "pack-oro", priority: 100 }]);
  const oroPool = SNAP.pools.find((p) => p.id === "pack-oro");
  assert.ok(oroPool && oroPool.mode === "EXPLICIT");
});

test("DATOS · pack-oro = buildPool(oro) = los pools de los otros cinco sobres de la línea principal; peso 1 en todas", () => {
  const reg = new CardRegistry();
  const flat = new Set(buildPool(reg, getPack("oro")!, null).flat.map((c) => c.id));
  const oro = members("pack-oro");
  assert.equal(oro.size, flat.size);
  for (const id of flat) assert.ok(oro.has(id), id);
  for (const id of MAIN_PACK_LINE.filter((x) => x !== "oro" && x !== "icon-single")) {
    const m = members(`pack-${id}`);
    assert.equal(m.size, oro.size, id);
    for (const c of oro) assert.ok(m.has(c), `${id} sin ${c}`);
  }
  assert.ok(SNAP.entries.filter((e) => e.pool_id === "pack-oro").every((e) => Number(e.weight) === 1 && e.mode === "INCLUDE"));
});

test("EQUIVALENCIA · con el pool real de la BD, Oro reparte EXACTAMENTE lo mismo que sin pool (mismas semillas)", () => {
  const pools = new Map<string, PoolDef>();
  for (const p of SNAP.pools) pools.set(p.id, { id: p.id, mode: p.mode, rules: p.rules ?? {}, entries: [], availableFrom: null, availableTo: null });
  for (const e of SNAP.entries) pools.get(e.pool_id)?.entries.push({ cardId: e.card_id, weight: Number(e.weight), mode: e.mode });
  const dist = composeDistribution(SNAP.packPools.filter((p) => p.pack_id === "oro").map((p) => ({ pool: pools.get(p.pool_id)!, priority: p.priority })), Date.now()) as PackDistribution;
  assert.ok(dist);
  const reg = new CardRegistry();
  const withPool = new PackEngine(reg, (id) => (id === "oro" ? dist : null));
  const noPool = new PackEngine(reg, () => null);
  const oro = getPack("oro")!;
  for (let i = 0; i < 3000; i++) {
    const ctx = () => ({ seed: (i * 2246822519 + 13) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
    assert.deepEqual(withPool.draw(oro, ctx()).instances.map((x) => x.cardId), noPool.draw(oro, ctx()).instances.map((x) => x.cardId), `semilla ${i}`);
  }
  // Pack Opening 3.0 · Oro: 4 normales (Oro 70 % · Masters 27 % · Champions 3 %) + destacada; media exacta por carta.
  // Icon por sobre (2026-10-09): Icon 10 % en la destacada y el resto de la destacada (920 ‰ sin Icon) escalado al 90 %.
  const d = mainPackDistribution("oro")!;
  assert.ok(Math.abs(d.oro - (4 * 700 + 900 * 200 / 920) / 50) < 1e-9 && Math.abs(d.prime - (900 * 150 / 920) / 50) < 1e-9 && Math.abs(d.icon - 100 / 50) < 1e-9, JSON.stringify(d));
  assert.equal(oro.price, 12000); assert.equal(oro.cardCount, 5); // F80: 4.000 → 12.000
});
