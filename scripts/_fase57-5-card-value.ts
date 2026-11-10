/**
 * FASE 57.5 · AUDITORÍA DE VALOR DE CARTA Y PROPUESTA (pura: sin BD, sin cuentas, sin tocar runtime). Fuera de CI.
 *
 * Valor ACTUAL = `marketValue` (domain/economy/pricing). Valor PROPUESTO = `proposedCardValue`
 * (domain/economy/cardValueProposal, no conectado al producto). Sobres = motor real, F57.3 y precios F57.4 tal cual.
 *
 *   npx tsx scripts/_fase57-5-card-value.ts [--n 200000]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "@/collection";
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { freshPity } from "@/domain/packs/pity";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
// F57.5B: la propuesta ya ES `marketValue`. «Actual» pasa a ser la fórmula anterior (`legacyRankValue`), para que el
// análisis de la auditoría se pueda repetir y dé las mismas cifras.
import { legacyRankValue as marketValue, marketValue as proposedCardValue, classValue as proposedValueFor, VALUE_CLASS_MULT as PROPOSAL_CLASS_MULT, VALUE_GROWTH as PROPOSAL_GROWTH, VALUE_SCALE as PROPOSAL_SCALE } from "@/domain/economy/pricing";
import { MAIN_PACK_LINE, PACK_CLASS_ORDER, mainPackDistribution, packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { packEconomy } from "@/domain/packs/packEconomy";
import type { CardDef } from "@/domain/cards/types";
import { PACK_STATS } from "@/data/packStats";
/** Tabla de desguace anterior a F57.5B (por bucket de rareza): la que estaba vigente durante la auditoría. */
const SALVAGE_BY_BUCKET = { common: 30, uncommon: 70, rare: 200, epic: 600, legendary: 1600 } as const;
import { BASE_LINE } from "@/domain/packs/power";
import { ANCHOR_BAND } from "@/domain/economy/marketReadiness";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const N = Number(arg("n") ?? 200_000);
const OUT = join("docs", "product", "qa", "fase57-5-card-value");
mkdirSync(OUT, { recursive: true });
const save = (f: string, d: unknown) => writeFileSync(join(OUT, f), JSON.stringify(d, null, 2));
const r2 = (x: number) => Math.round(x * 100) / 100;

const reg = new CardRegistry();
const cards = reg.cards;
const cur = (c: CardDef) => marketValue(c);
const prop = (c: CardDef) => proposedCardValue(c)!;
const clsOf = (c: CardDef) => packCardClass(c)! as PackCardClass;

/* ───────── 4 · snapshot de las 331 ───────── */
const rankBy = (f: (c: CardDef) => number) => {
  const s = [...cards].sort((a, b) => f(b) - f(a) || b.ovr - a.ovr || (a.id < b.id ? -1 : 1));
  return new Map(s.map((c, i) => [c.id, i + 1]));
};
const rCur = rankBy(cur), rProp = rankBy(prop);
const rows = cards.map((c) => ({
  cardId: c.id, player: reg.player(c.playerId)?.nick ?? c.playerId, edition: c.variantId, packClass: clsOf(c),
  rarity: bucketForRank(getVariant(c.variantId).rank), rank: getVariant(c.variantId).rank, ovr: c.ovr,
  currentValue: cur(c), currentPosition: rCur.get(c.id)!, proposedValue: prop(c), proposedPosition: rProp.get(c.id)!,
  changePct: r2((prop(c) / cur(c) - 1) * 100),
}));
save("current-values.json", rows.map(({ proposedValue: _p, proposedPosition: _q, changePct: _x, ...r }) => r).sort((a, b) => a.currentPosition - b.currentPosition));
save("proposed-values.json", [...rows].sort((a, b) => a.proposedPosition - b.proposedPosition));
writeFileSync(join(OUT, "values.csv"), ["cardId,player,edition,packClass,rarity,ovr,currentValue,currentPosition,proposedValue,proposedPosition,changePct",
  ...rows.map((r) => [r.cardId, r.player, r.edition, r.packClass, r.rarity, r.ovr, r.currentValue, r.currentPosition, r.proposedValue, r.proposedPosition, r.changePct].join(","))].join("\n"));

/* ───────── 5–7 · distribución, solapes, correlación ───────── */
const q = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
function dist(vals: number[], ovrs: number[]) {
  const s = [...vals].sort((a, b) => a - b), n = s.length, mean = s.reduce((a, b) => a + b, 0) / n;
  return {
    n, min: s[0], p10: q(s, 0.1), p25: q(s, 0.25), median: q(s, 0.5), mean: r2(mean), p75: q(s, 0.75), p90: q(s, 0.9), p95: q(s, 0.95), max: s[n - 1],
    sd: r2(Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / n)),
    ovrMin: Math.min(...ovrs), ovrMean: r2(ovrs.reduce((a, b) => a + b, 0) / ovrs.length), ovrMax: Math.max(...ovrs),
  };
}
function pearson(x: number[], y: number[]) {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? r2(sxy / Math.sqrt(sxx * syy) * 1000) / 1000 : null;
}
const inClass = (k: PackCardClass) => cards.filter((c) => clsOf(c) === k);
const classDist: Record<string, unknown> = {};
const corr: Record<string, unknown> = {};
for (const [label, f] of [["current", cur], ["proposed", prop]] as const) {
  classDist[label] = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, dist(inClass(k).map(f), inClass(k).map((c) => c.ovr))]));
  corr[label] = {
    global: { value: pearson(cards.map((c) => c.ovr), cards.map(f)), logValue: pearson(cards.map((c) => c.ovr), cards.map((c) => Math.log(f(c)))) },
    withinClass: Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, pearson(inClass(k).map((c) => c.ovr), inClass(k).map(f))])),
  };
}
const medOf = (k: PackCardClass, f: (c: CardDef) => number) => q([...inClass(k).map(f)].sort((a, b) => a - b), 0.5);
const pct = (xs: CardDef[], pred: (c: CardDef) => boolean) => r2((xs.filter(pred).length / xs.length) * 100);
function overlaps(f: (c: CardDef) => number) {
  const sup: Record<string, number> = {};
  for (let i = 0; i < PACK_CLASS_ORDER.length; i++) for (let j = i + 1; j < PACK_CLASS_ORDER.length; j++) {
    const A = inClass(PACK_CLASS_ORDER[i]), B = inClass(PACK_CLASS_ORDER[j]);
    let w = 0; for (const a of A) for (const b of B) w += f(a) > f(b) ? 1 : f(a) === f(b) ? 0.5 : 0;
    sup[`P(${PACK_CLASS_ORDER[i]} > ${PACK_CLASS_ORDER[j]})`] = r2((w / (A.length * B.length)) * 100);
  }
  return {
    named: {
      "% Prime < mediana Champions": pct(inClass("prime"), (c) => f(c) < medOf("champions", f)),
      "% Champions > mediana Prime": pct(inClass("champions"), (c) => f(c) > medOf("prime", f)),
      "% Masters > mediana Prime": pct(inClass("masters"), (c) => f(c) > medOf("prime", f)),
      "% Masters > mínimo Prime": pct(inClass("masters"), (c) => f(c) > Math.min(...inClass("prime").map(f))),
      "% Oro > mediana Masters": pct(inClass("oro"), (c) => f(c) > medOf("masters", f)),
      "% Champions > mediana Icon": pct(inClass("champions"), (c) => f(c) > medOf("icon", f)),
      "% Prime > mínimo Icon": pct(inClass("prime"), (c) => f(c) > Math.min(...inClass("icon").map(f))),
    },
    pairwiseSuperiority: sup,
  };
}
save("class-distribution.json", { classes: classDist, correlation: corr, overlaps: { current: overlaps(cur), proposed: overlaps(prop) } });

/* ───────── 20–21 · top 25, subidas/bajadas, comprobaciones ───────── */
const view = (r: (typeof rows)[number]) => ({ player: r.player, edition: r.edition, class: r.packClass, ovr: r.ovr, currentValue: r.currentValue, proposedValue: r.proposedValue, currentPosition: r.currentPosition, proposedPosition: r.proposedPosition });
save("top25-comparison.json", {
  currentTop25: [...rows].sort((a, b) => a.currentPosition - b.currentPosition).slice(0, 25).map(view),
  proposedTop25: [...rows].sort((a, b) => a.proposedPosition - b.proposedPosition).slice(0, 25).map(view),
});
const checks: Record<string, unknown> = {};
checks.nonPositive = rows.filter((r) => !(r.proposedValue > 0)).map((r) => r.cardId);
checks.nonFinite = rows.filter((r) => !Number.isFinite(r.proposedValue)).map((r) => r.cardId);
checks.maxValue = Math.max(...rows.map((r) => r.proposedValue));
checks.overflowRisk = checks.maxValue as number > 2 ** 31 - 1;
// Saltos por 1 punto de OVR dentro de cada clase (curva teórica 60..99): debe subir siempre y como mucho ~×1,25.
const steps: Record<string, { min: number; max: number; nonIncreasing: number[] }> = {};
for (const k of PACK_CLASS_ORDER) {
  let mn = Infinity, mx = 0; const bad: number[] = [];
  for (let o = 60; o < 99; o++) { const a = proposedValueFor(k, o), b = proposedValueFor(k, o + 1); const r = b / a; mn = Math.min(mn, r); mx = Math.max(mx, r); if (!(b > a)) bad.push(o); }
  steps[k] = { min: r2(mn), max: r2(mx), nonIncreasing: bad };
}
checks.perOvrStepRatio = steps;
// Discontinuidad en los cortes de la edición base (81→82, 85→86): mismo multiplicador, así que el paso es el de 1 OVR.
checks.baseEditionCuts = { "81→82": r2(proposedValueFor("plata", 82) / proposedValueFor("base", 81)), "85→86": r2(proposedValueFor("oro", 86) / proposedValueFor("plata", 85)) };
// Inversiones entre cartas casi idénticas: misma clase, OVR a ≤1 punto y la de más OVR vale MENOS.
const inv: string[] = [];
for (const a of cards) for (const b of cards) if (clsOf(a) === clsOf(b) && b.ovr - a.ovr >= 1 && b.ovr - a.ovr <= 1 && prop(b) < prop(a)) inv.push(`${a.id}(${a.ovr}) > ${b.id}(${b.ovr})`);
checks.nearIdenticalInversions = inv;
// Saltos extremos: cambios de más de ×5 o de menos de ×0,2 respecto al valor actual.
checks.extremeChanges = rows.filter((r) => r.proposedValue / r.currentValue > 5 || r.proposedValue / r.currentValue < 0.2).map((r) => `${r.cardId} ${r.currentValue}→${r.proposedValue}`);
save("outliers.json", {
  top20Increases: [...rows].sort((a, b) => b.changePct - a.changePct).slice(0, 20).map((r) => ({ ...view(r), changePct: r.changePct })),
  top20Decreases: [...rows].sort((a, b) => a.changePct - b.changePct).slice(0, 20).map((r) => ({ ...view(r), changePct: r.changePct })),
  checks,
});

/* ───────── 22 · sensibilidad por OVR ───────── */
const OVRS = [70, 75, 80, 85, 90, 92, 95];
const RANK_OF: Record<PackCardClass, string> = { base: "base", plata: "base", oro: "base", masters: "masters-l", champions: "champions-s", prime: "future-star", icon: "record-breaker" };
save("ovr-sensitivity.json", {
  formula: { scale: PROPOSAL_SCALE, growth: PROPOSAL_GROWTH, classMult: PROPOSAL_CLASS_MULT },
  note: "Base/Plata/Oro son la misma edición con el mismo multiplicador: su fila es la misma curva (cada clase solo tiene sus OVR reales en su tramo). OVR fuera del rango real de una clase = simulación matemática.",
  proposed: Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, Object.fromEntries(OVRS.map((o) => [o, proposedValueFor(k, o)]))])),
  current: Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, Object.fromEntries(OVRS.map((o) => [o, marketValue({ ...cards[0], variantId: RANK_OF[k] as never, ovr: o })]))])),
  realOvrRange: Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, [Math.min(...inClass(k).map((c) => c.ovr)), Math.max(...inClass(k).map((c) => c.ovr))]])),
  matchups: {
    "Masters 95 vs Champions 87": [proposedValueFor("masters", 95), proposedValueFor("champions", 87)],
    "Champions 95 vs Prime 87": [proposedValueFor("champions", 95), proposedValueFor("prime", 87)],
    "Prime 95 vs Icon 92": [proposedValueFor("prime", 95), proposedValueFor("icon", 92)],
    "Champions 95 vs Icon 87": [proposedValueFor("champions", 95), proposedValueFor("icon", 87)],
    "Icon 87 vs Champions 95 (actual)": [marketValue({ ...cards[0], variantId: "record-breaker" as never, ovr: 87 }), marketValue({ ...cards[0], variantId: "champions-s" as never, ovr: 95 })],
  },
});

/* ───────── 15–19 · impacto en los sobres (precios F57.4, F57.3, motor real) ───────── */
const engine = new PackEngine(reg);
const meanBy = (f: (c: CardDef) => number) => Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, inClass(k).reduce((a, c) => a + f(c), 0) / inClass(k).length])) as Record<PackCardClass, number>;
const mCur = meanBy(cur), mProp = meanBy(prop);
const packs: Record<string, unknown> = {};
for (const id of MAIN_PACK_LINE) {
  const pack = getPack(id)!, t = mainPackDistribution(id)!;
  const ev = (m: Record<PackCardClass, number>) => PACK_CLASS_ORDER.reduce((a, k) => a + (t[k] / 100) * m[k], 0) * pack.cardCount;
  const tc: number[] = [], tp: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = engine.draw(pack, { seed: (i * 2246822519 + 13) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
    let a = 0, b = 0; for (const ins of r.instances) { const c = reg.card(ins.cardId)!; a += cur(c); b += prop(c); }
    tc.push(a); tp.push(b);
  }
  const summary = (arr: number[], evA: number) => {
    const s = arr.sort((x, y) => x - y), mean = s.reduce((x, y) => x + y, 0) / N;
    return { evAnalytic: Math.round(evA), evSimulated: Math.round(mean), diffPct: r2(((mean - evA) / evA) * 100), ratio: r2(evA / pack.price),
      min: s[0], p10: q(s, 0.1), p25: q(s, 0.25), p50: q(s, 0.5), p75: q(s, 0.75), p90: q(s, 0.9), p95: q(s, 0.95), p99: q(s, 0.99), max: s[N - 1] };
  };
  const eco = packEconomy(id, cards);
  packs[id] = {
    name: pack.name, price: pack.price, cardCount: pack.cardCount,
    current: summary(tc, ev(mCur)), proposed: summary(tp, ev(mProp)),
    // El coste de conseguir Prime/Icon depende de precio y probabilidades, NO del valor: no cambia con la propuesta.
    topTierCost: { prime: Math.round(eco.topTier.prime.expectedCost), icon: Math.round(eco.topTier.icon.expectedCost), primeOrIcon: Math.round(eco.topTier.primeOrIcon.expectedCost), perPrimeCard: Math.round(eco.topTier.prime.costPerCard), perIconCard: Math.round(eco.topTier.icon.costPerCard) },
  };
  const p = packs[id] as { current: { ratio: number }; proposed: { ratio: number; evAnalytic: number; p50: number } };
  console.log(`${pack.name.padEnd(16)} ratio actual ${p.current.ratio}× → propuesto ${p.proposed.ratio}× · EV ${p.proposed.evAnalytic} · P50 ${p.proposed.p50}`);
}
const five = MAIN_PACK_LINE.filter((x) => x !== "icon").map((id) => (packs[id] as { proposed: { ratio: number } }).proposed.ratio);
const median = [...five].sort((a, b) => a - b)[2];
const iconVals = inClass("prime").map(prop).concat(inClass("icon").map(prop));
save("pack-impact.json", {
  prices: Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, getPack(id)!.price])),
  packs,
  band: { median, maxDeviationPct: r2(Math.max(...five.map((x) => Math.abs(x / median - 1))) * 100), iconVsMedian: r2((packs.icon as { proposed: { ratio: number } }).proposed.ratio / median) },
  iconPack: { minPossible: 3 * Math.min(...iconVals), maxPossible: 3 * Math.max(...iconVals) },
});
console.log(`banda de los cinco: mediana ${median}× · desviación máx ${r2(Math.max(...five.map((x) => Math.abs(x / median - 1))) * 100)} % · Icon ${r2((packs.icon as { proposed: { ratio: number } }).proposed.ratio / median)}× mediana`);
console.log(`→ ${OUT}`);

/* ───────── 24 · cerrojos de `marketReadiness` (ancla y desguace) con cada valoración ───────── */
{
  const BUCKETS = ["common", "uncommon", "rare", "epic", "legendary"] as const;
  const bucketOf = (c: CardDef) => bucketForRank(getVariant(c.variantId).rank);
  const ladder = BASE_LINE.map((id) => (PACK_STATS as Record<string, { costPerRarity: Record<string, number | undefined> } | undefined>)[id]).filter((r) => !!r);
  const gate = (f: (c: CardDef) => number) => Object.fromEntries(BUCKETS.map((b) => {
    const xs = cards.filter((c) => bucketOf(c) === b), v = xs.map(f), cost = ladder.map((r) => r!.costPerRarity[b]).find((c) => c !== undefined && c > 0);
    const mean = v.reduce((a, x) => a + x, 0) / v.length, cheapest = Math.min(...v);
    return [b, { editions: [...new Set(xs.map((c) => c.variantId))], n: v.length, meanValue: Math.round(mean), entryCost: cost && Math.round(cost),
      anchorRatio: cost ? r2(mean / cost) : null, cheapest, salvage: SALVAGE_BY_BUCKET[b], salvageRatio: r2(SALVAGE_BY_BUCKET[b] / cheapest) }];
  }));
  const cg = gate(cur), pg = gate(prop);
  const ok = (g: typeof cg) => Object.values(g).every((x) => (x.anchorRatio === null || (x.anchorRatio >= ANCHOR_BAND.min && x.anchorRatio <= ANCHOR_BAND.max)) && x.salvageRatio < 1);
  save("market-readiness-impact.json", { anchorBand: ANCHOR_BAND, current: cg, proposed: pg, currentPasses: ok(cg), proposedPasses: ok(pg) });
  console.log(`marketReadiness: actual ${ok(cg) ? "PASA" : "FALLA"} · propuesto ${ok(pg) ? "PASA" : "FALLA"}`);
}
