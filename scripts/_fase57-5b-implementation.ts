/**
 * FASE 57.5B · EVIDENCIA DE LA IMPLEMENTACIÓN (pura: sin BD, sin cuentas). Fuera de CI.
 *
 * «Antes» = `legacyRankValue` (la fórmula anterior) y la tabla de desguace por rareza anterior.
 * «Después» = `marketValue` y `salvageValue` de producción. Sobres = motor real, F57.3 y precios F57.4 tal cual.
 *
 *   npx tsx scripts/_fase57-5b-implementation.ts [--n 200000]
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "@/collection";
import { PackEngine } from "@/pack/engine";
import { PACKS, getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { freshPity } from "@/domain/packs/pity";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { marketValue, legacyRankValue, instanceValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { anchorRatios, salvageBelowReference, evaluateReadiness, ANCHOR_BAND } from "@/domain/economy/marketReadiness";
import { MAIN_PACK_LINE, PACK_CLASS_ORDER, mainPackDistribution, packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { packEconomy } from "@/domain/packs/packEconomy";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { PAYMENTS_ENABLED } from "@/config/monetization";
import type { CardDef } from "@/domain/cards/types";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const N = Number(arg("n") ?? 200_000);
const OUT = join("docs", "product", "qa", "fase57-5-card-value-implementation");
mkdirSync(OUT, { recursive: true });
const save = (f: string, d: unknown) => writeFileSync(join(OUT, f), JSON.stringify(d, null, 2));
const r2 = (x: number) => Math.round(x * 100) / 100;

const LEGACY_SALVAGE = { common: 30, uncommon: 70, rare: 200, epic: 600, legendary: 1600 } as const;
const reg = new CardRegistry();
const cards = reg.cards;
const before = (c: CardDef) => legacyRankValue(c);
const after = (c: CardDef) => marketValue(c);
const svBefore = (c: CardDef) => LEGACY_SALVAGE[bucketForRank(getVariant(c.variantId).rank)];
const svAfter = (c: CardDef) => salvageValue(c);
const clsOf = (c: CardDef) => packCardClass(c)! as PackCardClass;
const inClass = (k: PackCardClass) => cards.filter((c) => clsOf(c) === k);
const q = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];

/* ── before/after por carta ── */
const rankBy = (f: (c: CardDef) => number) => new Map([...cards].sort((a, b) => f(b) - f(a) || b.ovr - a.ovr || (a.id < b.id ? -1 : 1)).map((c, i) => [c.id, i + 1]));
const rB = rankBy(before), rA = rankBy(after);
const rows = cards.map((c) => ({
  cardId: c.id, player: reg.player(c.playerId)?.nick ?? c.playerId, edition: c.variantId, packClass: clsOf(c),
  rarity: bucketForRank(getVariant(c.variantId).rank), ovr: c.ovr,
  valueBefore: before(c), valueAfter: after(c), positionBefore: rB.get(c.id)!, positionAfter: rA.get(c.id)!,
  changePct: r2((after(c) / before(c) - 1) * 100), instanceValue: instanceValue(c),
  salvageBefore: svBefore(c), salvageAfter: svAfter(c),
}));
save("before-after-values.json", [...rows].sort((a, b) => a.positionAfter - b.positionAfter));

/* ── distribución por clase ── */
function dist(vals: number[], ovrs: number[]) {
  const s = [...vals].sort((a, b) => a - b), n = s.length, mean = s.reduce((a, b) => a + b, 0) / n;
  return { n, min: s[0], p10: q(s, 0.1), p25: q(s, 0.25), median: q(s, 0.5), mean: r2(mean), p75: q(s, 0.75), p90: q(s, 0.9), p95: q(s, 0.95), max: s[n - 1],
    sd: r2(Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / n)), ovrMin: Math.min(...ovrs), ovrMean: r2(ovrs.reduce((a, b) => a + b, 0) / ovrs.length), ovrMax: Math.max(...ovrs) };
}
const byClass = (f: (c: CardDef) => number) => Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, dist(inClass(k).map(f), inClass(k).map((c) => c.ovr))]));
const dA = byClass(after), dB = byClass(before);
const ordered = (d: Record<string, { median: number; mean: number }>, key: "median" | "mean") => PACK_CLASS_ORDER.every((k, i) => i === 0 || d[k][key] > d[PACK_CLASS_ORDER[i - 1]][key]);
const sup = (A: CardDef[], B: CardDef[], f: (c: CardDef) => number) => { let w = 0; for (const a of A) for (const b of B) w += f(a) > f(b) ? 1 : f(a) === f(b) ? 0.5 : 0; return r2((w / (A.length * B.length)) * 100); };
save("class-distribution-after.json", {
  before: dB, after: dA,
  orderAfter: { medians: ordered(dA, "median"), means: ordered(dA, "mean") },
  championsVsPrime: {
    before: { championsMedian: dB.champions.median, primeMedian: dB.prime.median, ratioPrimeOverChampions: r2(dB.prime.median / dB.champions.median), pChampionsBeatsPrime: sup(inClass("champions"), inClass("prime"), before) },
    after: { championsMedian: dA.champions.median, primeMedian: dA.prime.median, ratioPrimeOverChampions: r2(dA.prime.median / dA.champions.median), pChampionsBeatsPrime: sup(inClass("champions"), inClass("prime"), after) },
  },
  // Contraste con la auditoría: las cifras por clase deben coincidir con `proposed` de F57.5.
  matchesF575Audit: (() => {
    const audit = JSON.parse(readFileSync(join("docs", "product", "qa", "fase57-5-card-value", "class-distribution.json"), "utf8")).classes.proposed;
    return PACK_CLASS_ORDER.every((k) => JSON.stringify(audit[k]) === JSON.stringify(dA[k]));
  })(),
});

/* ── top 25 y subidas/bajadas ── */
const view = (r: (typeof rows)[number]) => ({ player: r.player, edition: r.edition, class: r.packClass, ovr: r.ovr, valueBefore: r.valueBefore, valueAfter: r.valueAfter, positionBefore: r.positionBefore, positionAfter: r.positionAfter, changePct: r.changePct });
save("top25-after.json", {
  top25After: [...rows].sort((a, b) => a.positionAfter - b.positionAfter).slice(0, 25).map(view),
  top20Increases: [...rows].sort((a, b) => b.changePct - a.changePct).slice(0, 20).map(view),
  top20Decreases: [...rows].sort((a, b) => a.changePct - b.changePct).slice(0, 20).map(view),
});

/* ── sobres: EV/percentiles de valor Y de desguace (200.000 aperturas por sobre de la línea principal) ── */
const engine = new PackEngine(reg);
const audit = JSON.parse(readFileSync(join("docs", "product", "qa", "fase57-5-card-value", "pack-impact.json"), "utf8")).packs;
const pct = (s: number[]) => ({ p10: q(s, 0.1), p25: q(s, 0.25), p50: q(s, 0.5), p75: q(s, 0.75), p90: q(s, 0.9), p95: q(s, 0.95), p99: q(s, 0.99) });
const packsOut: Record<string, unknown> = {}, loop: Record<string, unknown> = {};
for (const id of MAIN_PACK_LINE) {
  const pack = getPack(id)!;
  const v: number[] = [], s: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = engine.draw(pack, { seed: (i * 2246822519 + 13) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
    let a = 0, b = 0; for (const ins of r.instances) { const c = reg.card(ins.cardId)!; a += after(c); b += svAfter(c); }
    v.push(a); s.push(b);
  }
  v.sort((x, y) => x - y); s.sort((x, y) => x - y);
  const ev = v.reduce((x, y) => x + y, 0) / N, sev = s.reduce((x, y) => x + y, 0) / N;
  const eco = packEconomy(id, cards);
  packsOut[id] = {
    name: pack.name, price: pack.price, cardCount: pack.cardCount,
    evSimulated: Math.round(ev), evPackStats: PACK_STATS[id].meanValue, evF575Audit: audit[id].proposed.evSimulated,
    evOverPrice: r2(ev / pack.price), evOverPriceF575Audit: audit[id].proposed.ratio, ...pct(v), min: v[0], max: v[N - 1],
    topTierCost: { prime: Math.round(eco.topTier.prime.expectedCost), icon: Math.round(eco.topTier.icon.expectedCost), primeOrIcon: Math.round(eco.topTier.primeOrIcon.expectedCost) },
  };
  loop[id] = {
    price: pack.price, salvageEV: Math.round(sev), salvageEVOverPrice: r2(sev / pack.price), ...pct(s), max: s[N - 1],
    pSalvageAtLeastPrice: r2((s.filter((x) => x >= pack.price).length / N) * 100),
    salvageBeforeEVOverPrice: null as number | null,
  };
}
const five = MAIN_PACK_LINE.filter((x) => x !== "icon").map((id) => (packsOut[id] as { evOverPrice: number }).evOverPrice);
const med = [...five].sort((a, b) => a - b)[2];
const iconCards = [...inClass("prime"), ...inClass("icon")].map(after);
save("pack-economy-after.json", {
  samplesPerPack: N, packs: packsOut,
  band: { medianOfFive: med, maxDeviationPct: r2(Math.max(...five.map((x) => Math.abs(x / med - 1))) * 100), iconVsMedian: r2((packsOut.icon as { evOverPrice: number }).evOverPrice / med) },
  iconPack: { minPossible: 3 * Math.min(...iconCards), maxPossible: 3 * Math.max(...iconCards) },
  allPacksPackStats: Object.fromEntries(PACKS.filter((p) => PACK_STATS[p.id]).map((p) => [p.id, { price: p.price, meanValue: PACK_STATS[p.id].meanValue, evOverPrice: p.price ? r2(PACK_STATS[p.id].meanValue / p.price) : null }])),
});

/* ── desguace ── */
const sd = (f: (c: CardDef) => number) => Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, dist(inClass(k).map(f), inClass(k).map((c) => c.ovr))]));
const sA = sd(svAfter), sB = sd(svBefore);
save("salvage-values.json", {
  formula: "salvageValue = max(5, redondeo(6 % × marketValue)); redondeo a 5 bajo 100, a 10 bajo 1.000, a 50 por encima",
  byClassBefore: sB, byClassAfter: sA, orderAfter: { medians: ordered(sA, "median"), means: ordered(sA, "mean") },
  maxSalvageOverValue: r2(Math.max(...cards.map((c) => svAfter(c) / after(c)))),
  nonPositive: cards.filter((c) => !(svAfter(c) > 0)).map((c) => c.id),
  atOrAboveValue: cards.filter((c) => svAfter(c) >= after(c)).map((c) => c.id),
  cards: rows.map((r) => ({ cardId: r.cardId, class: r.packClass, ovr: r.ovr, marketValue: r.valueAfter, salvageBefore: r.salvageBefore, salvageAfter: r.salvageAfter })),
});
const allPacksSalvage = Object.fromEntries(PACKS.filter((p) => p.price > 0 && PACK_STATS[p.id]).map((p) => [p.id, { price: p.price, meanSalvage: PACK_STATS[p.id].meanSalvage, overPrice: r2(PACK_STATS[p.id].meanSalvage / p.price) }]));
save("salvage-pack-loop-analysis.json", {
  rule: "comprar → abrir → desguazar TODO → comprar: EV de créditos recuperados / precio < 0,70 en TODOS los sobres de pago",
  mainLineSimulated: loop, allPaidPacksPackStats: allPacksSalvage,
  worstPaidPack: Object.entries(allPacksSalvage).sort((a, b) => b[1].overPrice - a[1].overPrice)[0],
  marketFloorBand: { min_price_mult: 0.2, maxSalvageOverValue: r2(Math.max(...cards.map((c) => svAfter(c) / after(c)))) },
  note: "Solo se desguazan DUPLICADOS (se conserva una copia): la recuperación real es menor que este peor caso.",
});

/* ── marketReadiness ── */
save("market-readiness-after.json", {
  GLOBAL_MARKET_ENABLED, PAYMENTS_ENABLED, anchorBand: ANCHOR_BAND,
  anchorRatios: Object.fromEntries(Object.entries(anchorRatios()).map(([k, v]) => [k, r2(v as number)])),
  salvageBelowReference: salvageBelowReference(),
  criteria: evaluateReadiness().map((r) => ({ id: r.criterion.id, status: r.status, detail: r.detail })),
});

for (const id of MAIN_PACK_LINE) {
  const p = packsOut[id] as { name: string; evOverPrice: number; evOverPriceF575Audit: number }, l = loop[id] as { salvageEVOverPrice: number };
  console.log(`${p.name.padEnd(16)} EV/precio ${p.evOverPrice}× (F57.5 ${p.evOverPriceF575Audit}×) · desguace ${Math.round(l.salvageEVOverPrice * 100)} %`);
}
console.log(`→ ${OUT}`);
