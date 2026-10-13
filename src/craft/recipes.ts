/**
 * VALIDACIÓN DE RECETAS (Collection Fase 4/7 · SEGURIDAD).
 *
 * Detecta recetas CORRUPTAS antes de ejecutarlas: kind/estructura inconsistente, salida sin resolver,
 * cardId explícito inexistente, cantidades/costes inválidos. Puro y determinista. Las salidas
 * dependientes del jugador (variant/nextRank/group) se validan en tiempo de ejecución (`resolveOutput`).
 */
import type { CardRegistry } from "@/collection";
import { BUCKETS } from "./materials";
import type { Recipe, RecipeValidation, CraftIssue, RecipeKind } from "./types";

const KINDS: RecipeKind[] = ["craft", "upgrade", "evolution", "fusion", "salvage", "reforge", "promotion"];

export function validateRecipe(registry: CardRegistry, recipe: Recipe): RecipeValidation {
  const issues: CraftIssue[] = [];
  const bad = (message: string) => issues.push({ code: "INVALID_RECIPE", message });

  if (!KINDS.includes(recipe.kind)) bad(`kind inválido: ${recipe.kind}`);
  if (!Number.isInteger(recipe.input.count) || recipe.input.count < 0) bad("input.count inválido");
  if (recipe.kind === "fusion" && recipe.input.count < 2) bad("fusion requiere ≥2 entradas");
  if (recipe.kind === "salvage" && (recipe.input.count < 1 || recipe.output.mode !== "materials")) bad("salvage requiere ≥1 entrada y salida 'materials'");
  if (recipe.output.mode === "materials" && recipe.kind !== "salvage") bad("solo 'salvage' produce materiales");
  if (recipe.output.mode !== "materials" && recipe.input.count === 0 && recipe.output.mode !== "explicit") bad("una receta sin entradas debe tener salida 'explicit'");

  if (recipe.output.mode === "explicit") {
    if (!recipe.output.cardId) bad("salida 'explicit' sin cardId");
    else if (!registry.card(recipe.output.cardId)) issues.push({ code: "OUTPUT_NOT_IN_CATALOG", message: `cardId de salida inexistente: ${recipe.output.cardId}` });
  }
  if (recipe.output.mode === "variant" && !recipe.output.variant) bad("salida 'variant' sin variante");
  if (recipe.output.mode === "group" && !recipe.output.group) bad("salida 'group' sin grupo");

  const cost = recipe.cost ?? {};
  if ((cost.credits ?? 0) < 0) bad("coste negativo");
  if (cost.materials) for (const k of Object.keys(cost.materials)) if (!BUCKETS.includes(k as (typeof BUCKETS)[number])) bad(`bucket de coste inválido: ${k}`);

  return { ok: issues.length === 0, issues };
}
