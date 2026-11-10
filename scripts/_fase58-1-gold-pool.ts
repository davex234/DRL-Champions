/**
 * F58.1 · POOL DEL SOBRE ORO — prueba de equivalencia (pura; instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase58-1-gold-pool.ts [--snapshot <json>] [--label before|after] [--n 200000]
 *
 * Abre N sobres Oro con el motor REAL (`PackEngine`, mismo camino que el servidor) con DOS distribuciones y las MISMAS
 * semillas:
 *   · A = la de la BD del snapshot (antes de F58.1: Oro sin pool → `null`);
 *   · B = Oro con el pool `pack-oro` que crea F58.1: EXPLICIT, `buildPool(oro).flat`, peso 1, prioridad 100.
 * Compara apertura a apertura (ids de carta en orden) y la distribución por clase. Además comprueba que los miembros
 * de `pack-oro` son exactamente los de los otros cinco sobres de la línea principal.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "@/collection";
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { freshPity } from "@/domain/packs/pity";
import { buildPool } from "@/domain/packs/pool";
import { DEFAULT_WEIGHT } from "@/domain/packs/weighted";
import { composeDistribution, type PackDistribution, type PoolDef } from "@/domain/packs/distribution";
import { PACK_CLASS_ORDER, packCardClass, mainPackDistribution } from "@/domain/packs/packClass";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const N = Number(arg("n") ?? 200_000);
const LABEL = arg("label") ?? "before";
const OUT = join("docs", "product", "qa", "fase58-1-gold-pool");
mkdirSync(OUT, { recursive: true });
const SNAP = arg("snapshot") ?? join(OUT, "pool-snapshot-before.json");

type Snap = { version: number; pools: { id: string; mode: PoolDef["mode"]; rules: PoolDef["rules"]; available_from: string | null; available_to: string | null }[];
  entries: { pool_id: string; card_id: string; weight: string | number; mode: "INCLUDE" | "EXCLUDE" }[]; packPools: { pack_id: string; pool_id: string; priority: number }[] };
function distributionsFrom(s: Snap): Map<string, PackDistribution> {
  const pools = new Map<string, PoolDef>();
  for (const p of s.pools) pools.set(p.id, { id: p.id, mode: p.mode, rules: p.rules ?? {}, entries: [], availableFrom: null, availableTo: null });
  for (const e of s.entries) pools.get(e.pool_id)?.entries.push({ cardId: e.card_id, weight: Number(e.weight), mode: e.mode });
  const lists = new Map<string, { pool: PoolDef; priority: number }[]>();
  for (const pp of s.packPools) { const pool = pools.get(pp.pool_id); if (pool) lists.set(pp.pack_id, [...(lists.get(pp.pack_id) ?? []), { pool, priority: pp.priority }]); }
  const out = new Map<string, PackDistribution>();
  for (const [id, l] of lists) { const d = composeDistribution(l, Date.now()); if (d) out.set(id, d); }
  return out;
}

const snap = JSON.parse(readFileSync(SNAP, "utf8")) as Snap;
const reg = new CardRegistry();
const oro = getPack("oro")!;
const flat = buildPool(reg, oro, null).flat;
const members = new Set(flat.map((c) => c.id));
const others = ["estandar", "premium", "masters", "champions", "icon"].map((id) => ({ id, ids: new Set(snap.entries.filter((e) => e.pool_id === `pack-${id}`).map((e) => e.card_id)) }));
const sameAsOthers = others.map((o) => ({ pack: o.id, size: o.ids.size, same: o.ids.size === members.size && [...members].every((m) => o.ids.has(m)) }));

const dbDist = distributionsFrom(snap);
const proposedPool: PoolDef = { id: "pack-oro", mode: "EXPLICIT", rules: {}, entries: flat.map((c) => ({ cardId: c.id, weight: DEFAULT_WEIGHT, mode: "INCLUDE" as const })), availableFrom: null, availableTo: null };
const proposed = composeDistribution([{ pool: proposedPool, priority: 100 }], Date.now())!;

const engineA = new PackEngine(reg, (id) => dbDist.get(id) ?? null);
const engineB = new PackEngine(reg, (id) => (id === "oro" ? proposed : dbDist.get(id) ?? null));
let identical = 0, diff = 0;
const byClassA: Record<string, number> = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, 0]));
const byClassB: Record<string, number> = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, 0]));
let firstDiff: string | null = null;
for (let i = 0; i < N; i++) {
  const ctx = () => ({ seed: (i * 2246822519 + 13) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
  const a = engineA.draw(oro, ctx()).instances.map((x) => x.cardId);
  const b = engineB.draw(oro, ctx()).instances.map((x) => x.cardId);
  for (const id of a) byClassA[packCardClass(reg.card(id)!)!]++;
  for (const id of b) byClassB[packCardClass(reg.card(id)!)!]++;
  if (a.join() === b.join()) identical++; else { diff++; firstDiff ??= `${i}: ${a.join()} ≠ ${b.join()}`; }
}
const cards = N * oro.cardCount;
const pct = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round((v / cards) * 1e5) / 1e3]));
const table = mainPackDistribution("oro");
const report = {
  label: LABEL, snapshotVersion: snap.version, samples: N,
  oroBoundInSnapshot: snap.packPools.filter((p) => p.pack_id === "oro"),
  proposedPool: { id: "pack-oro", mode: "EXPLICIT", weight: DEFAULT_WEIGHT, priority: 100, members: flat.length },
  sameMembersAsOtherMainPacks: sameAsOthers,
  identicalOpenings: identical, differentOpenings: diff, firstDiff,
  classPctWithoutPool: pct(byClassA), classPctWithPool: pct(byClassB), classTableF573: table,
};
writeFileSync(join(OUT, `equivalence-${LABEL}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
