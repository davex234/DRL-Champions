/** PACK OPENING 3.0 · sobres fuera de la línea principal (sin cambios): valor/crédito y techo (instrumento). */
import { PackEngine } from "@/pack/engine";
import { PACKS } from "@/data/packs";
import { freshPity } from "@/domain/packs/pity";
import { marketValue } from "@/domain/economy/pricing";
import { MAIN_PACK_LINE } from "@/domain/packs/packClass";
const engine = new PackEngine(); const N = 20000;
for (const p of PACKS) {
  if (MAIN_PACK_LINE.includes(p.id) || !p.price) continue;
  let ev = 0, b90 = 0, b95 = 0;
  for (let i = 0; i < N; i++) {
    const cs = engine.draw(p, { seed: (i * 2654435761 + 7) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 }).instances.map((x) => engine.registry.card(x.cardId)!);
    let best = 0; for (const c of cs) { ev += marketValue(c); best = Math.max(best, c.ovr); }
    if (best >= 90) b90++; if (best >= 95) b95++;
  }
  console.log(`${p.id.padEnd(22)} ${String((p as { lifecycle?: string }).lifecycle ?? "ACTIVE").padEnd(8)} price ${String(p.price).padStart(6)} EV/cr ${(ev / N / p.price).toFixed(3)} ≥90 ${(b90 / N * 100).toFixed(1)}% ≥95 ${(b95 / N * 100).toFixed(2)}%`);
}
