/**
 * CRAFT (Fase 6) — registro de crafting sobre el CraftPatch (F5): recetas EXISTENTES
 * (`RECIPES` de datos, jamás se crean), enlaces, grafo de upgrades vs grafo de evoluciones
 * (por tipo de receta) y dependencias económicas de REFERENCIA (los costes son datos de la
 * receta; no se recalcula economía).
 */
import { RECIPES } from "@/data/recipes";
import type { MaterializationResult } from "@/materializer";
import type { CraftArtifact } from "./types";

export function buildCraft(mat: MaterializationResult): CraftArtifact {
  const upgradeIds = new Set(RECIPES.filter((r) => r.kind === "upgrade" || r.kind === "fusion").map((r) => r.id));
  const upgradeGraph = mat.craftPatch.upgradePaths.filter((p) => upgradeIds.has(p.via));
  const evolutionGraph = mat.craftPatch.upgradePaths.filter((p) => !upgradeIds.has(p.via));

  return {
    recipes: RECIPES.map((r) => r.id).sort(),
    links: [...mat.craftPatch.links].sort((a, b) => a.cardId.localeCompare(b.cardId)),
    upgradeGraph,
    evolutionGraph,
    dependencies: RECIPES.map((r) => ({
      recipeId: r.id,
      credits: r.cost?.credits,
      materials: r.cost?.materials as Record<string, number> | undefined,
    })).sort((a, b) => a.recipeId.localeCompare(b.recipeId)),
  };
}
