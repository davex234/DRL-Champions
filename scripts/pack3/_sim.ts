/**
 * PACK OPENING 3.0 · SIMULADOR (instrumento, fuera de CI y de la release).
 *
 *   npx tsx scripts/pack3/_sim.ts [--n=200000] [--plan=current|proposed|both] [--out=docs/product/qa/pack3/sim.json]
 *
 * ACTUAL = el motor real (`PackEngine.draw` → `openPack` → `openByClass`), con el catálogo de código (en producción los
 * pools `pack-*` son el catálogo entero con peso 1: idéntico). PROPUESTO = el mismo cálculo por ranuras con la tabla
 * de `scripts/pack3/plans.ts` (antes de implementarlo) o, si `--engine`, el motor real ya implementado.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { freshPity } from "@/domain/packs/pity";
import { classPool } from "@/domain/packs/openPack";
import { packCardClass, MAIN_PACK_LINE, PACK_CLASS_ORDER, type PackCardClass } from "@/domain/packs/packClass";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { makeRng } from "@/sim/rng";
import { pickWeighted, DEFAULT_WEIGHT } from "@/domain/packs/weighted";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import type { CardDef } from "@/domain/cards/types";
import { PLANS, type SlotPlan } from "./plans";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const N = Number(arg("n") ?? 200_000);
const WHICH = arg("plan") ?? "both";
const OUT = arg("out") ?? "docs/product/qa/pack3/sim.json";
const USE_ENGINE = process.argv.includes("--engine");

const engine = new PackEngine();
const reg = engine.registry;

function rollFrom(table: Record<PackCardClass, number>, r: number): PackCardClass {
  let total = 0; for (const c of PACK_CLASS_ORDER) total += Math.max(0, table[c]);
  let roll = r * total; let last: PackCardClass = "base";
  for (const c of PACK_CLASS_ORDER) { if (table[c] <= 0) continue; last = c; roll -= table[c]; if (roll < 0) return c; }
  return last;
}
/** Prototipo del sorteo por ranuras (misma aritmética que `openByClass`: una tirada de clase + una de carta por hueco). */
function protoDraw(packId: string, plan: SlotPlan, seed: number): CardDef[] {
  const pack = getPack(packId)!;
  const pools = classPool(reg as never, pack, null);
  const rng = makeRng(seed);
  const out: CardDef[] = [];
  for (let i = 0; i < pack.cardCount; i++) {
    const table = plan.featured && i === pack.cardCount - 1 ? plan.featured : plan.regular;
    const k = rollFrom(table, rng.next());
    const tilt = plan.tilt ?? 0;
    out.push(pickWeighted(pools[k], tilt ? (c: CardDef) => Math.exp(-tilt * (c.ovr - 70)) : () => DEFAULT_WEIGHT, rng));
  }
  return out;
}
const engineDraw = (packId: string, seed: number): CardDef[] =>
  engine.draw(getPack(packId)!, { seed, owned: [], mintCounts: {}, pity: freshPity(), now: 0 }).instances.map((i) => reg.card(i.cardId)!);

const pct = (x: number, n: number) => +((x / n) * 100).toFixed(3);
function stats(packId: string, draw: (seed: number) => CardDef[], n: number) {
  const pack = getPack(packId)!;
  const ovrs: number[] = [], bests: number[] = [], evs: number[] = [];
  const cls: Record<string, number> = {}, bucket: Record<string, number> = {}, edition: Record<string, number> = {};
  let specials = 0, dups = 0, salvage = 0;
  const ge = { b90: 0, b93: 0, b95: 0, two90: 0, three90: 0, two88: 0, specials2: 0, jackpot: 0, absurd: 0, refLike: 0 };
  for (let i = 0; i < n; i++) {
    const cards = draw((i * 2654435761 + 12345) >>> 0);
    let best = 0, ev = 0, n90 = 0, n88 = 0, n86 = 0, sp = 0, top = 0;
    const seen = new Set<string>();
    for (const c of cards) {
      ovrs.push(c.ovr); best = Math.max(best, c.ovr);
      const k = packCardClass(c)!; cls[k] = (cls[k] ?? 0) + 1;
      const b = bucketForRank(getVariant(c.variantId as never).rank); bucket[b] = (bucket[b] ?? 0) + 1;
      edition[c.variantId] = (edition[c.variantId] ?? 0) + 1;
      ev += marketValue(c); salvage += salvageValue(c as never);
      if (c.ovr >= 90) n90++; if (c.ovr >= 88) n88++; if (c.ovr >= 86) n86++;
      if (c.variantId !== "base") { sp++; specials++; }
      if (k === "prime" || k === "icon") top++;
      if (seen.has(c.id)) dups++; else seen.add(c.id);
    }
    bests.push(best); evs.push(ev);
    if (best >= 90) ge.b90++; if (best >= 93) ge.b93++; if (best >= 95) ge.b95++;
    if (n90 >= 2) ge.two90++; if (n90 >= 3) ge.three90++; if (n88 >= 2) ge.two88++; if (sp >= 2) ge.specials2++;
    if (top >= 1) ge.jackpot++;
    // «Sobre absurdo»: el patrón del Plata de referencia — un jackpot (Prime/Icon) Y al menos otras 3 cartas ≥ 86.
    if (top >= 1 && n86 - 1 >= 3) ge.absurd++;
    // Parecido al de referencia: mejor ≥ 95 y ≥ 4 cartas ≥ 86 en total.
    if (best >= 95 && n86 >= 5) ge.refLike++;
  }
  const s = [...ovrs].sort((a, b) => a - b), bs = [...bests].sort((a, b) => a - b), es = [...evs].sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))];
  const mean = (arr: number[]) => +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
  const tot = s.length;
  const share = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v, tot)]));
  const evMean = mean(evs);
  return {
    pack: packId, name: pack.name, price: pack.price, cards: pack.cardCount, packs: n,
    ovr: { mean: mean(ovrs), median: q(s, 0.5) },
    best: { mean: mean(bests), p50: q(bs, 0.5), p90: q(bs, 0.9), p95: q(bs, 0.95), p99: q(bs, 0.99) },
    specialsPerPack: +(specials / n).toFixed(3),
    pPackBest: { ge90: pct(ge.b90, n), ge93: pct(ge.b93, n), ge95: pct(ge.b95, n) },
    pMulti: { two90: pct(ge.two90, n), three90: pct(ge.three90, n), two88: pct(ge.two88, n), twoSpecials: pct(ge.specials2, n) },
    jackpotRate: pct(ge.jackpot, n), absurdRate: pct(ge.absurd, n), refLikeRate: pct(ge.refLike, n),
    ev: { mean: evMean, p50: q(es, 0.5), p90: q(es, 0.9), perCredit: pack.price ? +(evMean / pack.price).toFixed(3) : null, salvagePerPack: +(salvage / n).toFixed(1) },
    dupCardsInPackPct: pct(dups, tot),
    classPct: share(cls), bucketPct: share(bucket), editionPct: share(edition),
  };
}

const report: Record<string, unknown> = { generated: new Date().toISOString(), n: N };
for (const which of WHICH === "both" ? ["current", "proposed"] : [WHICH]) {
  const rows: unknown[] = [];
  for (const id of MAIN_PACK_LINE) {
    const draw = which === "current" ? (seed: number) => engineDraw(id, seed)
      : USE_ENGINE ? (seed: number) => engineDraw(id, seed) : (seed: number) => protoDraw(id, PLANS[id], seed);
    const r = stats(id, draw, N);
    rows.push(r);
    const x = r as any;
    console.log(`${which.padEnd(8)} ${id.padEnd(9)} best p50/p90/p99 ${x.best.p50}/${x.best.p90}/${x.best.p99} mean ${x.best.mean} · ovr ${x.ovr.mean} · ≥90 ${x.pPackBest.ge90}% ≥95 ${x.pPackBest.ge95}% · 2×≥90 ${x.pMulti.two90}% 3×≥90 ${x.pMulti.three90}% · jackpot ${x.jackpotRate}% absurdo ${x.absurdRate}% ref ${x.refLikeRate}% · EV ${x.ev.mean} (${x.ev.perCredit}/cr) · esp ${x.specialsPerPack}`);
  }
  report[which] = rows;
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log("→", OUT);
