/**
 * HOTFIX 57.2 · simulación masiva de la gama base con el MOTOR REAL (`PackEngine` → `openPack` → pool), sin BD.
 *
 *   npx tsx scripts/_fase57-2-sim.ts [--n=100000] [--out=docs/product/qa/fase57-2-pack-power/sim.json]
 *
 * Por sobre (Bronce, Plata, Oro, Icon) y en dos versiones —con la regla de poder (`PACK_POWER_RULES`) y «antes» (el mismo
 * sobre con otro id, que no tiene regla)—: OVR mín/medio/mediana/P90/P95/P99/máx, reparto por rareza y por edición,
 * duplicados dentro del sobre, P(≥80/85/90/95) por carta y «≥1 por sobre», y que cada sobre entrega todas sus cartas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { freshPity } from "@/domain/packs/pity";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { PACK_POWER_RULES, BASE_LINE } from "@/domain/packs/power";
import type { PackDef } from "@/domain/packs/types";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const N = Number(arg("n") ?? 100_000);
const OUT = arg("out") ?? join("docs", "product", "qa", "fase57-2-pack-power", "sim.json");

function simulate(pack: PackDef, n: number) {
  const engine = new PackEngine();
  const ovrs: number[] = [];
  const rarity: Record<string, number> = {};
  const edition: Record<string, number> = {};
  let dupCards = 0, short = 0, packsGe = { 80: 0, 85: 0, 90: 0, 95: 0 } as Record<number, number>;
  for (let i = 0; i < n; i++) {
    const r = engine.draw(pack, { seed: (i * 2654435761) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
    if (r.instances.length !== pack.cardCount) short++;
    const seen = new Set<string>();
    let best = 0;
    for (const ins of r.instances) {
      const card = engine.registry.card(ins.cardId)!;
      ovrs.push(card.ovr);
      best = Math.max(best, card.ovr);
      const b = bucketForRank(getVariant(card.variantId as never).rank);
      rarity[b] = (rarity[b] ?? 0) + 1;
      edition[card.variantId] = (edition[card.variantId] ?? 0) + 1;
      if (seen.has(card.id)) dupCards++; else seen.add(card.id);
    }
    for (const t of [80, 85, 90, 95]) if (best >= t) packsGe[t]++;
  }
  const s = [...ovrs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const tot = s.length;
  const share = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / tot * 100).toFixed(2)]));
  return {
    packs: n, cards: tot, incompletePacks: short,
    ovr: { min: s[0], mean: +(s.reduce((a, b) => a + b, 0) / tot).toFixed(2), median: q(0.5), p90: q(0.9), p95: q(0.95), p99: q(0.99), max: s[tot - 1] },
    perCardAtLeast: Object.fromEntries([80, 85, 90, 95].map((t) => [`>=${t}`, +(s.filter((x) => x >= t).length / tot * 100).toFixed(3)])),
    perPackAtLeastOne: Object.fromEntries([80, 85, 90, 95].map((t) => [`>=${t}`, +(packsGe[t] / n * 100).toFixed(3)])),
    rarityPct: share(rarity), editionPct: share(edition), dupCardsPct: +(dupCards / tot * 100).toFixed(3),
  };
}

const report: Record<string, unknown> = { generated: new Date().toISOString(), n: N, rules: PACK_POWER_RULES };
for (const id of BASE_LINE) {
  const pack = getPack(id)!;
  const t0 = Date.now();
  const after = simulate(pack, N);
  const before = simulate({ ...pack, id: `${id}__sin-regla` }, N);
  report[id] = { name: pack.name, price: pack.price, cardCount: pack.cardCount, rule: PACK_POWER_RULES[id], after, before, ms: Date.now() - t0 };
  const a = after.ovr, b = before.ovr;
  console.log(`${pack.name.padEnd(12)} techo ${PACK_POWER_RULES[id].maxOvr ?? "—"} | AHORA mín ${a.min} media ${a.mean} med ${a.median} P95 ${a.p95} P99 ${a.p99} MÁX ${a.max} · ≥90 ${after.perCardAtLeast[">=90"]}%/carta · incompletos ${after.incompletePacks} | ANTES máx ${b.max} media ${b.mean} ≥90 ${before.perCardAtLeast[">=90"]}%`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log("→", OUT);
