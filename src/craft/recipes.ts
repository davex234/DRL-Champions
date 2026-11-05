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
import { ns, td } from "@/i18n/runtime";

const t = ns("craft");

const KINDS: RecipeKind[] = ["craft", "upgrade", "evolution", "fusion", "salvage", "reforge", "promotion"];

export function validateRecipe(registry: CardRegistry, recipe: Recipe): RecipeValidation {
  const issues: CraftIssue[] = [];
  const bad = (message: string) => issues.push({ code: "INVALID_RECIPE", message });

  if (!KINDS.includes(recipe.kind)) bad(t("kind inválido: {kind}", { kind: recipe.kind }));
  if (!Number.isInteger(recipe.input.count) || recipe.input.count < 0) bad(t("input.count inválido"));
  if (recipe.kind === "fusion" && recipe.input.count < 2) bad(t("fusion requiere ≥2 entradas"));
  if (recipe.kind === "salvage" && (recipe.input.count < 1 || recipe.output.mode !== "materials")) bad(t("salvage requiere ≥1 entrada y salida 'materials'"));
  if (recipe.output.mode === "materials" && recipe.kind !== "salvage") bad(t("solo 'salvage' produce materiales"));
  if (recipe.output.mode !== "materials" && recipe.input.count === 0 && recipe.output.mode !== "explicit") bad(t("una receta sin entradas debe tener salida 'explicit'"));

  if (recipe.output.mode === "explicit") {
    if (!recipe.output.cardId) bad(t("salida 'explicit' sin cardId"));
    else if (!registry.card(recipe.output.cardId)) issues.push({ code: "OUTPUT_NOT_IN_CATALOG", message: t("cardId de salida inexistente: {cardId}", { cardId: recipe.output.cardId }) });
  }
  if (recipe.output.mode === "variant" && !recipe.output.variant) bad(t("salida 'variant' sin variante"));
  if (recipe.output.mode === "group" && !recipe.output.group) bad(t("salida 'group' sin grupo"));

  const cost = recipe.cost ?? {};
  if ((cost.credits ?? 0) < 0) bad(t("coste negativo"));
  if (cost.materials) for (const k of Object.keys(cost.materials)) if (!BUCKETS.includes(k as (typeof BUCKETS)[number])) bad(t("bucket de coste inválido: {k}", { k: td(k) }));

  return { ok: issues.length === 0, issues };
}
