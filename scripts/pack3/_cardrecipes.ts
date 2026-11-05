/** PACK OPENING 3.0 · recetas de CARTAS frente al rebalance (instrumento). */
import { recipeFloor, classEconomy } from "@/domain/crafting/floors";
const recipes: [string, string, string, number][] = [["card-base-plata", "base", "plata", 7], ["card-plata-oro", "plata", "oro", 3], ["card-oro-masters", "oro", "masters", 8], ["card-masters-champions", "masters", "champions", 14], ["card-champions-prime", "champions", "prime", 10]];
const ce = classEconomy();
for (const [id, a, b, q] of recipes) {
  const f = recipeFloor({ kind: "CARD", inputPackId: null, outputPackId: null, inputClass: a, outputClass: b } as never)!;
  console.log(id.padEnd(24), "qty", q, "floors", JSON.stringify({ cost: f.byCost, value: f.byValue, salv: f.bySalvage, ratio: f.ratio }), "valor in", Math.round(q * ce[a as keyof typeof ce].marketMean), "out", Math.round(ce[b as keyof typeof ce].marketMean), "coste directo in/out", Math.round(ce[a as keyof typeof ce].directCostPerCard ?? 0), Math.round(ce[b as keyof typeof ce].directCostPerCard ?? 0));
}
