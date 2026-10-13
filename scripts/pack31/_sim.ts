/**
 * PACK OPENING 3.1 · SIMULACIÓN DE SOBRES ESPECIALES (instrumento, fuera de CI/release). Motor real + distribución de
 * PRODUCCIÓN (pools y boosts de equipo de la BD).
 *
 *   npx tsx scripts/pack31/_sim.ts [--n=200000] [--ids=a,b] [--out=…] [--with-main]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PACKS, getPack } from "@/data/packs";
import { isPurchasable } from "@/domain/packs/lifecycle";
import { MAIN_PACK_LINE, packCardClass } from "@/domain/packs/packClass";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import type { CardDef } from "@/domain/cards/types";
import { drawCards } from "./_lib";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const N = Number(arg("n") ?? 200_000);
const OUT = arg("out") ?? "docs/product/qa/pack31/sim-before.json";
const special = PACKS.filter((p) => !MAIN_PACK_LINE.includes(p.id) && p.id !== "inicial" && p.id !== "prime");
const IDS = arg("ids")?.split(",") ?? [...(process.argv.includes("--with-main") ? MAIN_PACK_LINE : []), ...special.map((p) => p.id)];

export function stats(packId: string, n: number, draw: (seed: number) => CardDef[] = (s) => drawCards(packId, s)) {
  const p = getPack(packId)!;
  const bests: number[] = [], evs: number[] = []; const freq = new Map<string, number>();
  let ovrSum = 0, cards = 0, specials = 0, top = 0, salv = 0, dups = 0;
  const ge = { b90: 0, b93: 0, b95: 0, two90: 0, three90: 0 };
  for (let i = 0; i < n; i++) {
    const cs = draw((i * 2654435761 + 4242) >>> 0);
    let best = 0, ev = 0, n90 = 0; const seen = new Set<string>(); let jack = false;
    for (const c of cs) {
      ovrSum += c.ovr; cards++; best = Math.max(best, c.ovr); ev += marketValue(c); salv += salvageValue(c);
      if (c.ovr >= 90) n90++; if (c.variantId !== "base") specials++;
      const k = packCardClass(c); if (k === "prime" || k === "icon") jack = true;
      freq.set(c.id, (freq.get(c.id) ?? 0) + 1); if (seen.has(c.id)) dups++; else seen.add(c.id);
    }
    if (jack) top++;
    bests.push(best); evs.push(ev);
    if (best >= 90) ge.b90++; if (best >= 93) ge.b93++; if (best >= 95) ge.b95++; if (n90 >= 2) ge.two90++; if (n90 >= 3) ge.three90++;
  }
  bests.sort((a, b) => a - b);
  const q = (pp: number) => bests[Math.min(bests.length - 1, Math.floor(pp * (bests.length - 1)))];
  const ev = evs.reduce((a, b) => a + b, 0) / n;
  let hhi = 0; for (const v of freq.values()) hhi += (v / cards) ** 2;
  const pct = (x: number) => +((x / n) * 100).toFixed(3);
  return {
    pack: packId, name: p.name, price: p.price, cards: p.cardCount, purchasable: isPurchasable(p) && p.price > 0, lifecycle: p.lifecycle ?? (p.retired ? "RETIRED" : "ACTIVE"),
    ovrMean: +(ovrSum / cards).toFixed(2), best: { p50: q(0.5), p90: q(0.9), p99: q(0.99) },
    pBest: { ge90: pct(ge.b90), ge93: pct(ge.b93), ge95: pct(ge.b95) }, pMulti: { two90: pct(ge.two90), three90: pct(ge.three90) },
    specialsPerPack: +(specials / n).toFixed(3), primeIconRate: pct(top), ev: Math.round(ev), evPerCredit: p.price ? +(ev / p.price).toFixed(3) : null,
    salvagePerPack: Math.round(salv / n), salvageOverPrice: p.price ? +((salv / n) / p.price).toFixed(4) : null,
    distinctSeen: freq.size, effectiveCards: +(1 / hhi).toFixed(1), dupInPackPct: +((dups / cards) * 100).toFixed(2),
  };
}

if (process.argv[1]?.includes("_sim")) {
  const rows = IDS.map((id) => {
    const r = stats(id, N);
    console.log(`${id.padEnd(15)} ${String(r.price).padStart(6)} ${r.lifecycle.padEnd(7)} EV ${String(r.ev).padStart(6)} (${r.evPerCredit}/cr) best ${r.best.p50}/${r.best.p90}/${r.best.p99} ≥90 ${r.pBest.ge90}% ≥93 ${r.pBest.ge93}% ≥95 ${r.pBest.ge95}% 2×90 ${r.pMulti.two90}% 3×90 ${r.pMulti.three90}% P/I ${r.primeIconRate}% esp ${r.specialsPerPack} salv ${(r.salvageOverPrice ?? 0) * 100}% eff ${r.effectiveCards} dup ${r.dupInPackPct}%`);
    return r;
  });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), n: N, rows }, null, 2));
  console.log("→", OUT);
}
