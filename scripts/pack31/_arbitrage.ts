/** PACK OPENING 3.1 · BÚSQUEDA DE ARBITRAJE (instrumento): desguace, Forja de cartas con TODOS los sobres comprables como fuente. */
import { PACKS, getPack } from "@/data/packs";
import { isPurchasable } from "@/domain/packs/lifecycle";
import { packPlan, PACK_CLASS_ORDER, type PackCardClass } from "@/domain/packs/packClass";
import { packEconomyReport } from "@/domain/packs/economyGate";
import { classEconomy } from "@/domain/crafting/floors";
const buyable = PACKS.filter((p) => p.price > 0 && isPurchasable(p) && packPlan(p.id));
// Coste por carta de cada clase en cada sobre = precio / cartas esperadas de esa clase (media exacta del plan).
const costs: Record<string, { pack: string; cost: number }> = {};
for (const k of PACK_CLASS_ORDER) {
  let best = { pack: "-", cost: Infinity };
  for (const p of buyable) { const pl = packPlan(p.id)!; const n = pl.cards; const tot = (t: typeof pl.regular) => PACK_CLASS_ORDER.reduce((a, c) => a + t[c], 0) || 1; const exp = (n - 1) * pl.regular[k] / tot(pl.regular) + pl.featured[k] / tot(pl.featured); if (exp > 0 && p.price / exp < best.cost) best = { pack: p.id, cost: p.price / exp }; }
  costs[k] = best;
}
console.log("coste mínimo por carta de cada clase (todos los sobres comprables):"); for (const k of PACK_CLASS_ORDER) console.log(`  ${k.padEnd(10)} ${Math.round(costs[k].cost)} (${costs[k].pack}) — solo línea: ${Math.round(classEconomy()[k].directCostPerCard ?? 0)}`);
const recipes: [string, PackCardClass, PackCardClass, number][] = [["card-base-plata", "base", "plata", 7], ["card-plata-oro", "plata", "oro", 3], ["card-oro-masters", "oro", "masters", 8], ["card-masters-champions", "masters", "champions", 14], ["card-champions-prime", "champions", "prime", 10]];
console.log("recetas de cartas: coste de entradas (vía más barata) vs coste directo de la salida (vía más barata):");
for (const [id, a, b, q] of recipes) { const cin = q * costs[a].cost, cout = costs[b].cost; console.log(`  ${id.padEnd(24)} ${Math.round(cin)} vs ${Math.round(cout)} → ${cin >= cout ? "OK (craftear no es más barato)" : "ARBITRAJE"}`); }
console.log("desguace/precio máximo entre comprables:", Math.max(...buyable.map((p) => packEconomyReport(p).salvageOverPrice ?? 0)).toFixed(4));
void getPack;
