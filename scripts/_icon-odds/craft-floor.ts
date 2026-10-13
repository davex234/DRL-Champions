/** Instrumento ICON-ODDS: suelo seguro de cada receta de sobres (0059 + cantidades vigentes/propuestas) con la economía actual. */
import { recipeFloor, validateRecipe } from "@/domain/crafting/floors";
import type { CraftRecipe } from "@/domain/crafting/types";
const base = (o: Partial<CraftRecipe>): CraftRecipe => ({ id: "x", kind: "PACK", name: "x", inputPackId: null, outputPackId: null, inputClass: null, outputClass: null, inputQty: 2, status: "ACTIVE", sortOrder: 0, availableFrom: null, availableTo: null, version: 1, ...o });
const rs: [string, string, string, number][] = [["pack-estandar-premium", "estandar", "premium", 4], ["pack-premium-oro", "premium", "oro", 3], ["pack-oro-masters", "oro", "masters", 2], ["pack-masters-champions", "masters", "champions", 3], ["pack-champions-icon (antes 2)", "champions", "icon", 2], ["pack-champions-icon (3:1)", "champions", "icon", 3]];
for (const [id, a, b, q] of rs) { const r = base({ id, inputPackId: a, outputPackId: b, inputQty: q }); console.log(id, "qty", q, JSON.stringify(recipeFloor(r)), "→", validateRecipe(r, { forActivation: true }).map((x) => x.code).join(",") || "OK"); }
