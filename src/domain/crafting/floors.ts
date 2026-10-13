/**
 * F73 · SUELOS DE LAS RECETAS y validación para el admin. PURO (lee la economía congelada; no la cambia).
 *
 * `recipeFloor` devuelve el mínimo de entradas que hace SEGURA una receta según `domain/crafting/economy`. El admin no
 * puede ACTIVAR una receta por debajo de su suelo, ni una receta que baje de categoría, que sea circular, que use un
 * sobre inexistente o no convertible (`inicial`), o una clase de salida escasa (Icon: 3 cartas → sería una garantía).
 */
import { CARDS } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { MAIN_PACK_LINE, MAIN_PACK_DISTRIBUTION, PACK_CLASS_ORDER, packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { analyzeRatio, type RatioAnalysis } from "./economy";
import { RECIPE_ID_RE, RECIPE_STATUSES, type CraftRecipe } from "./types";

/** Clases con menos cartas que esto no pueden ser salida de un intercambio aleatorio (sería una garantía). */
export const MIN_OUTPUT_POOL = 10;

export interface ClassEconomy { cards: number; marketMin: number; marketMean: number; salvageMin: number; salvageMean: number; directCostPerCard: number | null }

let CLASS_CACHE: Record<PackCardClass, ClassEconomy> | null = null;
export function classEconomy(): Record<PackCardClass, ClassEconomy> {
  if (CLASS_CACHE) return CLASS_CACHE;
  CLASS_CACHE = Object.fromEntries(PACK_CLASS_ORDER.map((k) => {
    const cs = CARDS.filter((c) => packCardClass(c) === k);
    const mv = cs.map(marketValue), sv = cs.map(salvageValue);
    const costs = MAIN_PACK_LINE.map((id) => {
      const p = getPack(id); const pct = MAIN_PACK_DISTRIBUTION[id as keyof typeof MAIN_PACK_DISTRIBUTION]?.[k] ?? 0;
      return p && pct > 0 ? p.price / (p.cardCount * (pct / 100)) : Number.POSITIVE_INFINITY;
    });
    const best = Math.min(...costs);
    return [k, {
      cards: cs.length,
      marketMin: cs.length ? Math.min(...mv) : 0, marketMean: cs.length ? mv.reduce((s, x) => s + x, 0) / cs.length : 0,
      salvageMin: cs.length ? Math.min(...sv) : 0, salvageMean: cs.length ? sv.reduce((s, x) => s + x, 0) / cs.length : 0,
      directCostPerCard: Number.isFinite(best) ? best : null,
    }];
  })) as Record<PackCardClass, ClassEconomy>;
  return CLASS_CACHE;
}

/** Suelo seguro de una receta, o `null` si no se puede analizar (sobre sin estadística del motor real). */
export function recipeFloor(r: Pick<CraftRecipe, "kind" | "inputPackId" | "outputPackId" | "inputClass" | "outputClass">): RatioAnalysis | null {
  if (r.kind === "PACK") {
    const L = r.inputPackId ? PACK_STATS[r.inputPackId] : undefined;
    const H = r.outputPackId ? PACK_STATS[r.outputPackId] : undefined;
    if (!L || !H) return null;
    return analyzeRatio({ cost: L.price, value: L.meanValue, salvage: L.meanSalvage }, { cost: H.price, value: H.meanValue, salvage: H.meanSalvage });
  }
  if (!r.inputClass || !r.outputClass) return null;
  const e = classEconomy();
  const I = e[r.inputClass], O = e[r.outputClass];
  if (!I || !O || I.directCostPerCard === null || O.directCostPerCard === null) return null;
  return analyzeRatio({ cost: I.directCostPerCard, value: I.marketMin, salvage: I.salvageMin }, { cost: O.directCostPerCard, value: O.marketMean, salvage: O.salvageMean });
}

export interface RecipeProblem { code: string; message: string }

/** Validación completa de una receta. `forActivation` = además debe ser segura para poder estar ACTIVA. */
export function validateRecipe(r: CraftRecipe, opts: { forActivation?: boolean } = {}): RecipeProblem[] {
  const out: RecipeProblem[] = [];
  const bad = (code: string, message: string) => out.push({ code, message });
  if (!RECIPE_ID_RE.test(r.id)) bad("BAD_ID", "Id inválido (minúsculas, números y guiones)");
  if (!r.name || r.name.trim().length < 3 || r.name.length > 60) bad("BAD_NAME", "Nombre de 3 a 60 caracteres");
  if (!RECIPE_STATUSES.includes(r.status)) bad("BAD_STATUS", "Estado inválido");
  if (!Number.isInteger(r.inputQty) || r.inputQty < 2 || r.inputQty > 100) bad("BAD_QTY", "La cantidad de entrada va de 2 a 100");
  if (r.availableFrom !== null && r.availableTo !== null && r.availableTo <= r.availableFrom) bad("BAD_WINDOW", "La fecha de fin debe ser posterior al inicio");
  if (r.kind === "PACK") {
    if (!r.inputPackId || !getPack(r.inputPackId)) bad("UNKNOWN_PACK", "El sobre de entrada no existe");
    if (!r.outputPackId || !getPack(r.outputPackId)) bad("UNKNOWN_PACK", "El sobre de salida no existe");
    if (r.inputPackId === "inicial" || r.outputPackId === "inicial") bad("NOT_CONVERTIBLE", "El Sobre Inicial no se puede convertir");
    if (r.inputPackId && r.inputPackId === r.outputPackId) bad("CIRCULAR", "Entrada y salida no pueden ser el mismo sobre");
    const li = MAIN_PACK_LINE.indexOf(r.inputPackId ?? ""), lo = MAIN_PACK_LINE.indexOf(r.outputPackId ?? "");
    if (li >= 0 && lo >= 0 && lo <= li) bad("DOWNGRADE", "La receta debe subir de categoría");
    if (r.inputClass || r.outputClass) bad("MIXED", "Una receta de sobres no lleva clases de carta");
  } else if (r.kind === "CARD") {
    const ii = PACK_CLASS_ORDER.indexOf(r.inputClass as PackCardClass), oo = PACK_CLASS_ORDER.indexOf(r.outputClass as PackCardClass);
    if (ii < 0 || oo < 0) bad("UNKNOWN_CLASS", "Clase de carta inválida");
    else if (oo <= ii) bad("DOWNGRADE", "La receta debe subir de clase");
    if (r.inputPackId || r.outputPackId) bad("MIXED", "Una receta de cartas no lleva sobres");
    if (oo >= 0 && classEconomy()[PACK_CLASS_ORDER[oo]].cards < MIN_OUTPUT_POOL && opts.forActivation) {
      bad("SCARCE_OUTPUT", `La clase de salida tiene menos de ${MIN_OUTPUT_POOL} cartas: sería una garantía`);
    }
  } else bad("BAD_KIND", "Tipo de receta inválido");
  if (opts.forActivation && out.length === 0) {
    const f = recipeFloor(r);
    if (!f) bad("NO_ANALYSIS", "No hay estadística del motor real para analizar esta receta: no se puede activar");
    else if (!f.viable) bad("NOT_VIABLE", `El suelo seguro (${f.ratio}) supera lo jugable`);
    else if (r.inputQty < f.ratio) bad("BELOW_FLOOR", `Por debajo del suelo seguro: mínimo ${f.ratio} (el crafteo crearía valor)`);
  }
  return out;
}
