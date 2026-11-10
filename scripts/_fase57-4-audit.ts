/**
 * FASE 57.4 · AUDITORÍA ECONÓMICA DE LA LÍNEA PRINCIPAL (pura: sin BD, sin cuentas). Fuera de CI.
 *
 * Valor de una carta = las DOS fuentes de verdad que ya existen (no se inventa ninguna):
 *   · `marketValue(card)`  (domain/economy/pricing)  — referencia de valor; la que usa `economy:model` → `packStats`.
 *   · `salvageValue(card)` (domain/economy/salvage)  — créditos reales por desguace (único canje con el mercado OFF).
 * Probabilidades = `mainPackDistribution` (F57.3), tal cual. Selección uniforme dentro de la clase (pools con peso 1).
 *
 *   npx tsx scripts/_fase57-4-audit.ts [--n 200000] [--out ruta.json]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CardRegistry } from "@/collection";
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { freshPity } from "@/domain/packs/pity";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { MAIN_PACK_LINE, PACK_CLASS_ORDER, mainPackDistribution, packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { packEconomy, classValueStats } from "@/domain/packs/packEconomy";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const N = Number(arg("n") ?? 200_000);
const OUT = arg("out") ?? join("docs", "product", "qa", "fase57-4-pack-economy", "audit.json");

const reg = new CardRegistry();
const engine = new PackEngine(reg);
const q = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
const r2 = (x: number) => Math.round(x * 100) / 100;

const report: Record<string, unknown> = { generated: new Date().toISOString(), openingsPerProduct: N, cards: reg.cards.length };

/* 2 · valor por clase */
const byClass: Record<string, unknown> = {};
for (const k of PACK_CLASS_ORDER) {
  const cs = reg.cards.filter((c) => packCardClass(c) === k);
  byClass[k] = { ...classValueStats(cs.map(marketValue)), ovrMean: r2(cs.reduce((a, c) => a + c.ovr, 0) / cs.length), salvage: classValueStats(cs.map(salvageValue)) };
}
report.byClass = byClass;
console.log("CLASE        n    mín   P25   med  media   P75   P90    máx  OVR  desguace");
for (const k of PACK_CLASS_ORDER) {
  const s = byClass[k] as { n: number; min: number; p25: number; median: number; mean: number; p75: number; p90: number; max: number; ovrMean: number; salvage: { mean: number } };
  console.log(`${k.padEnd(10)} ${String(s.n).padStart(3)} ${[s.min, s.p25, s.median, Math.round(s.mean), s.p75, s.p90, s.max].map((x) => String(x).padStart(6)).join("")} ${String(s.ovrMean).padStart(5)} ${String(s.salvage.mean).padStart(6)}`);
}

/* 3–4, 8 · analítico + simulación por producto */
const products: Record<string, unknown> = {};
for (const id of MAIN_PACK_LINE) {
  const pack = getPack(id)!;
  const eco = packEconomy(id, reg.cards);
  const totals: number[] = []; const salv: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = engine.draw(pack, { seed: (i * 2246822519 + 13) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
    let v = 0, s = 0;
    for (const ins of r.instances) { const c = reg.card(ins.cardId)!; v += marketValue(c); s += salvageValue(c); }
    totals.push(v); salv.push(s);
  }
  totals.sort((a, b) => a - b);
  const simMean = totals.reduce((a, b) => a + b, 0) / N;
  const sim = {
    mean: Math.round(simMean), diffPct: r2(((simMean - eco.evPerPack) / eco.evPerPack) * 100),
    min: totals[0], p10: q(totals, 0.1), p25: q(totals, 0.25), p50: q(totals, 0.5), p75: q(totals, 0.75),
    p90: q(totals, 0.9), p95: q(totals, 0.95), p99: q(totals, 0.99), max: totals[N - 1],
    salvageMean: Math.round(salv.reduce((a, b) => a + b, 0) / N),
  };
  products[id] = { name: pack.name, table: mainPackDistribution(id), ...eco, sim };
  console.log(`\n${pack.name} · ${pack.price} cr · ${pack.cardCount} cartas`);
  console.log(`  EV/carta ${Math.round(eco.evPerCard)} · EV/sobre analítico ${Math.round(eco.evPerPack)} · simulado ${sim.mean} (Δ ${sim.diffPct} %) · ratio ${r2(eco.ratio)}× · desguace ${Math.round(eco.salvagePerPack)} (${r2(eco.salvageRatio * 100)} %)`);
  console.log(`  valor total: mín ${sim.min} P10 ${sim.p10} P25 ${sim.p25} P50 ${sim.p50} P75 ${sim.p75} P90 ${sim.p90} P95 ${sim.p95} P99 ${sim.p99} máx ${sim.max}`);
  console.log(`  P(≥1 Prime) ${r2(eco.topTier.prime.pAtLeastOne * 100)} % → ${Math.round(eco.topTier.prime.expectedCost)} cr · P(≥1 Icon) ${r2(eco.topTier.icon.pAtLeastOne * 100)} % → ${Math.round(eco.topTier.icon.expectedCost)} cr · P(≥1 Prime o Icon) ${r2(eco.topTier.primeOrIcon.pAtLeastOne * 100)} % → ${Math.round(eco.topTier.primeOrIcon.expectedCost)} cr`);
}
report.products = products;

/* 9 · duplicados: con selección uniforme dentro de la clase, P(dup | carta de clase k) = f_k (fracción poseída de k). */
const dup: Record<string, unknown> = {};
for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  dup[`${f * 100}%`] = Object.fromEntries(MAIN_PACK_LINE.map((id) => {
    const t = mainPackDistribution(id)!;
    const n = getPack(id)!.cardCount;
    // Misma fracción poseída en todas las clases (supuesto explícito). Por carta = f; ≥1 duplicado en el sobre = 1-(1-f)^n.
    return [id, { perCard: f, packHasDup: r2((1 - Math.pow(1 - f, n)) * 100) / 100, primeOrIconDup: t.prime + t.icon > 0 ? f : null }];
  }));
}
const H = (n: number) => Array.from({ length: n }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0);
dup.couponCollector = {
  primeClassDraws: r2(20 * H(20)), iconClassDraws: r2(3 * H(3)),
  // Cartas de la clase por Sobre Icon = cartas × p (Fase 57.4: 3 × 0,7 Prime y 3 × 0,3 Icon).
  iconPacksToCompletePrime: r2((20 * H(20)) / (getPack("icon")!.cardCount * 0.7)), iconPacksToCompleteIcon: r2((3 * H(3)) / (getPack("icon")!.cardCount * 0.3)),
};
report.duplicates = dup;
console.log("\nColeccionista (sobres Icon esperados): Prime completo", (dup.couponCollector as { iconPacksToCompletePrime: number }).iconPacksToCompletePrime, "· Icon completo", (dup.couponCollector as { iconPacksToCompleteIcon: number }).iconPacksToCompleteIcon);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`→ ${OUT}`);
