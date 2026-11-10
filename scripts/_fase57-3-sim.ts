/**
 * FASE 57.3 · SIMULACIÓN PURA (sin BD, sin cuentas) de la PACK CLASS DISTRIBUTION con el motor real (`PackEngine`).
 *
 *   · Bronce, Plata, Oro, Masters, Champions: 200.000 CARTAS cada uno.   · Icon: 200.000 APERTURAS (= 200.000 cartas).
 *
 * Por producto: esperado vs observado por clase (y desviación), OVR (mín, media, mediana, P90, P95, P99, máx), cartas por
 * sobre, clases imposibles observadas, y la probabilidad individual de cada carta dentro de su clase. Además comprueba que
 * el simulador de economía (`drawPackIndices`) sortea IGUAL que `openPack` en los sobres de la línea que modela.
 *
 *   npx tsx scripts/_fase57-3-sim.ts [--cards 200000] [--out ruta.json]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CardRegistry } from "@/collection";
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { freshPity } from "@/domain/packs/pity";
import { openPack } from "@/domain/packs/openPack";
import { makeRng } from "@/sim/rng";
import { buildSimCatalog, drawPackIndices } from "@/domain/economy/simulator";
import { MAIN_PACK_LINE, PACK_CLASS_ORDER, mainPackDistribution, packCardClass, type PackCardClass } from "@/domain/packs/packClass";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const TARGET = Number(arg("cards") ?? 200_000);
const OUT = arg("out") ?? join("docs", "product", "qa", "fase57-3-pack-class", "sim.json");

const reg = new CardRegistry();
const engine = new PackEngine(reg);
const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

const report: Record<string, unknown> = { generated: new Date().toISOString(), cardsPerProduct: TARGET, iconOpenings: TARGET };
const classSize = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, reg.cards.filter((c) => packCardClass(c) === k).length])) as Record<PackCardClass, number>;
report.classSize = classSize;

for (const id of MAIN_PACK_LINE) {
  const pack = getPack(id)!;
  const table = mainPackDistribution(id)!;
  const n = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, 0])) as Record<PackCardClass, number>;
  const perCard = new Map<string, number>();
  const ovr: number[] = [];
  let opens = 0, badCount = 0;
  const t0 = Date.now();
  while (ovr.length < TARGET) {
    const r = engine.draw(pack, { seed: (opens * 2654435761 + 97) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
    opens++;
    if (r.instances.length !== pack.cardCount) badCount++;
    for (const ins of r.instances) {
      const c = reg.card(ins.cardId)!;
      n[packCardClass(c)!]++;
      perCard.set(c.id, (perCard.get(c.id) ?? 0) + 1);
      ovr.push(c.ovr);
    }
  }
  const total = ovr.length;
  const sorted = [...ovr].sort((a, b) => a - b);
  const byClass = PACK_CLASS_ORDER.map((k) => {
    const observed = (n[k] / total) * 100;
    // Dentro de la clase, selección uniforme: 1/|clase|. Se compara con lo observado para la carta más y menos sacada.
    const ids = reg.cards.filter((c) => packCardClass(c) === k).map((c) => c.id);
    const shares = ids.map((cid) => (perCard.get(cid) ?? 0) / Math.max(1, n[k]));
    return {
      class: k, expected: table[k], observed: Number(observed.toFixed(3)), deviationPP: Number((observed - table[k]).toFixed(3)),
      count: n[k], cardsInClass: ids.length,
      perCardWithinClassExpected: table[k] > 0 ? Number((100 / ids.length).toFixed(3)) : 0,
      perCardWithinClassObserved: table[k] > 0 ? { min: Number((Math.min(...shares) * 100).toFixed(3)), max: Number((Math.max(...shares) * 100).toFixed(3)) } : null,
      perCardPerCardExpected: table[k] > 0 ? Number((table[k] / ids.length).toFixed(4)) : 0,
    };
  });
  const impossibleSeen = byClass.filter((b) => b.expected === 0 && b.count > 0).map((b) => b.class);
  const stats = {
    min: sorted[0], mean: Number((ovr.reduce((a, b) => a + b, 0) / total).toFixed(2)), median: q(sorted, 0.5),
    p90: q(sorted, 0.9), p95: q(sorted, 0.95), p99: q(sorted, 0.99), max: sorted[sorted.length - 1],
  };
  report[id] = { name: pack.name, price: pack.price, cardCount: pack.cardCount, opens, cards: total, incompletePacks: badCount, impossibleSeen, byClass, ovr: stats, ms: Date.now() - t0 };
  console.log(`${pack.name.padEnd(16)} ${String(opens).padStart(7)} sobres · ${total} cartas · incompletos ${badCount} · imposibles ${impossibleSeen.length}`);
  for (const b of byClass) if (b.expected > 0 || b.count > 0) console.log(`   ${b.class.padEnd(10)} esperado ${String(b.expected).padStart(3)} %  observado ${b.observed.toFixed(3).padStart(7)} %  Δ ${b.deviationPP >= 0 ? "+" : ""}${b.deviationPP.toFixed(3)} pp`);
  console.log(`   OVR mín ${stats.min} · media ${stats.mean} · mediana ${stats.median} · P90 ${stats.p90} · P95 ${stats.p95} · P99 ${stats.p99} · máx ${stats.max}`);
}

/* Icon con la colección ENTERA: qué pasa cuando el usuario ya lo tiene todo (política del sobre, sin inventar nada). */
{
  const icon = getPack("icon")!;
  const all = reg.cards.map((c, i) => ({ uid: `o${i}`, cardId: c.id, variantId: c.variantId, obtainedAt: 0 }) as never);
  let dup = 0, compensated = 0; const k = 20_000;
  for (let i = 0; i < k; i++) {
    const r = engine.draw(icon, { seed: i + 1, owned: all, mintCounts: {}, pity: freshPity(), now: 0 });
    if (r.instances.length !== 1) throw new Error("Icon entregó ≠ 1 carta");
    if (!r.instances[0].isNew) dup++;
    if ((r.instances[0] as { compensated?: boolean }).compensated) compensated++;
  }
  report.iconOwnsAll = { openings: k, antiDuplicate: icon.antiDuplicate ?? "allow", duplicates: dup, compensated };
  console.log(`Icon con TODO poseído: ${dup}/${k} duplicadas (política «${icon.antiDuplicate ?? "allow"}»), compensadas ${compensated}`);
}

/* El simulador de economía sortea igual que `openPack` en los sobres de la línea que modela (estandar, premium, champions). */
{
  const cat = buildSimCatalog(reg);
  const eq: Record<string, { seeds: number; mismatches: number }> = {};
  for (const id of ["estandar", "premium", "champions"]) {
    let mism = 0;
    for (let s = 1; s <= 5000; s++) {
      const out: number[] = [];
      drawPackIndices(cat, id, makeRng(s), out, null);
      const a = out.map((i) => reg.cards[i].id);
      const b = openPack(reg, getPack(id)!, { seed: s, owned: new Set(), pity: freshPity() }).decisions.map((d) => d.card.id);
      if (JSON.stringify(a) !== JSON.stringify(b)) mism++;
    }
    eq[id] = { seeds: 5000, mismatches: mism };
  }
  report.simulatorEquivalence = eq;
  console.log("simulador ≡ openPack:", JSON.stringify(eq));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`→ ${OUT}`);
