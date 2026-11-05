/**
 * ICON POR SOBRE (2026-10-09) · SIMULACIÓN REPRODUCIBLE con el motor REAL (`openPack`), sin BD ni usuarios.
 *
 *   npx tsx scripts/_icon-odds/simulate.ts [N=100000] [out.json]
 *
 * Semillas fijas (i · 2654435761 + 90210): dos ejecuciones dan exactamente lo mismo. Por sobre: P(≥ 1 Icon) observada
 * frente a la configurada (z y IC 99,99 %), máximo de Icon en un sobre, posición de la Icon, cartas por sobre, valor medio;
 * en el Sobre Icon, la frecuencia de cada Icon. Instrumento fuera de CI (método de las fases).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CardRegistry } from "@/collection/registry";
import { getPack } from "@/data/packs";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import { MAIN_PACK_LINE, iconChanceOf, packCardClass } from "@/domain/packs/packClass";
import { marketValue } from "@/domain/economy/pricing";

const N = Number(process.argv[2] ?? 100_000);
const OUT = process.argv[3] ?? "docs/product/qa/icon-odds/simulation-100k.json";
const REG = new CardRegistry();
const out: Record<string, unknown> = {};

for (const id of MAIN_PACK_LINE) {
  const pack = getPack(id)!;
  const p = iconChanceOf(id)!;
  let hit = 0, maxIcons = 0, notFeatured = 0, cards = 0, value = 0, top95 = 0, iconCards = 0;
  const perIcon: Record<string, number> = {};
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const d = openPack(REG, pack, { seed: (i * 2654435761 + 90210) >>> 0, owned: new Set(), pity: freshPity() }).decisions;
    cards += d.length;
    let n = 0;
    d.forEach((x, k) => {
      value += marketValue(x.card);
      if (packCardClass(x.card) !== "icon") return;
      n++; iconCards++; perIcon[x.card.id] = (perIcon[x.card.id] ?? 0) + 1;
      if (k !== d.length - 1) notFeatured++;
    });
    if (n) hit++;
    if (d.some((x) => packCardClass(x.card) === "icon" && x.card.ovr >= 95)) top95++;
    maxIcons = Math.max(maxIcons, n);
  }
  const obs = hit / N, sigma = Math.sqrt((p * (1 - p)) / N);
  out[id] = {
    packs: N, cardsPerPack: cards / N, configured: p, observed: obs,
    z: sigma > 0 ? (obs - p) / sigma : 0,
    ci9999: [Math.max(0, p - 3.89 * sigma), Math.min(1, p + 3.89 * sigma)],
    compatible: Math.abs(obs - p) <= 3.89 * sigma + 1e-12,
    maxIconsInAPack: maxIcons, iconsOutsideFeatured: notFeatured, // en los sobres ICON todas sus cartas son Icon

    meanValuePerPack: Math.round(value / N), valuePerCredit: +(value / N / pack.price).toFixed(4),
    iconsPerPack: iconCards / N,
    // Frecuencia de cada Icon POR CARTA ICON obtenida (en los sobres ICON = la tabla 65 / 17,5 / 17,5).
    iconShareOfIconCards: Object.fromEntries(Object.entries(perIcon).sort().map(([k, v]) => [k, +(v / Math.max(1, iconCards)).toFixed(5)])),
    packsWithAnIcon95: +(top95 / N).toFixed(5),
    ms: Date.now() - t0,
  };
  console.log(id.padEnd(10), `configurada ${(p * 100).toFixed(2)} % · observada ${(obs * 100).toFixed(3)} % · z ${(out[id] as { z: number }).z.toFixed(2)} · máx/sobre ${maxIcons} · ≥1 Icon 95: ${(top95 / N * 100).toFixed(2)} %`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), seedFormula: "(i * 2654435761 + 90210) >>> 0", n: N, packs: out }, null, 2) + "\n");
console.log(`→ ${OUT}`);
