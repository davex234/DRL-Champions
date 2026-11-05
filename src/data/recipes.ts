/**
 * Catálogo de RECETAS de crafting (DRL Champions, Collection Fase 4/7).
 *
 * Todo por DATOS: añadir una operación de evolución = añadir una entrada aquí (sin tocar el motor).
 * Las recetas son GENÉRICAS (por criterios), no hardcodean cartas concretas: el motor resuelve la
 * salida contra el catálogo respetando la identidad del jugador. Añadir recetas específicas (una carta
 * concreta) se hace con `output.mode: "explicit"`.
 */
import type { Recipe } from "@/craft/types";
import { CRAFT_SCHEMA_VERSION } from "@/craft/types";

export const RECIPES: Recipe[] = [
  // ── Salvage: convierte cualquier DUPLICADO en polvo (+ créditos por el pricing existente) ──
  {
    id: "salvage-duplicate",
    name: "Reciclar duplicado",
    description: "Convierte una copia duplicada en polvo de su rareza y algunos créditos.",
    kind: "salvage",
    input: { count: 1, duplicatesOnly: true },
    output: { mode: "materials", dustByBucket: true, valueFromCard: true },
    version: CRAFT_SCHEMA_VERSION,
  },
  // ── Dismantle: desmonta una carta cualquiera (no duplicado) — solo si NO está bloqueada ──
  {
    id: "dismantle-card",
    name: "Desmontar carta",
    description: "Desmonta una carta en polvo de su rareza.",
    kind: "salvage",
    input: { count: 1 },
    output: { mode: "materials", dustByBucket: true },
    version: CRAFT_SCHEMA_VERSION,
  },
  // ── Upgrade: sube una carta a la SIGUIENTE variante de mayor rango del MISMO jugador (si existe) ──
  {
    id: "upgrade-next",
    name: "Mejorar carta",
    description: "Evoluciona la carta a la siguiente variante de mayor rango del jugador.",
    kind: "upgrade",
    input: { count: 1, samePlayer: true },
    output: { mode: "nextRank" },
    cost: { materials: { rare: 2 }, credits: 500 },
    version: CRAFT_SCHEMA_VERSION,
  },
  // ── Evolution: evoluciona a una variante internacional del jugador (si la tiene) ──
  {
    id: "evolve-international",
    name: "Evolución internacional",
    description: "Evoluciona hacia una variante internacional del jugador.",
    kind: "evolution",
    input: { count: 1, samePlayer: true },
    output: { mode: "group", group: "internacional" },
    cost: { materials: { epic: 3 }, credits: 2000 },
    version: CRAFT_SCHEMA_VERSION,
  },
  // ── Fusion 3→1: funde 3 duplicados del MISMO jugador en su siguiente variante ──
  {
    id: "fuse-triple",
    name: "Fusión triple",
    description: "Funde tres copias del mismo jugador en una variante superior.",
    kind: "fusion",
    input: { count: 3, samePlayer: true, duplicatesOnly: false },
    output: { mode: "nextRank" },
    cost: { materials: { uncommon: 4 } },
    version: CRAFT_SCHEMA_VERSION,
  },
  // ── Promotion: promociona a la variante 'exclusiva' del jugador (si existe) ──
  {
    id: "promote-exclusive",
    name: "Promoción exclusiva",
    description: "Promociona a una variante exclusiva del jugador.",
    kind: "promotion",
    input: { count: 1, samePlayer: true },
    output: { mode: "group", group: "exclusiva" },
    cost: { materials: { legendary: 2 }, credits: 5000 },
    version: CRAFT_SCHEMA_VERSION,
  },
];

export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));
export function getRecipe(id: string): Recipe | undefined {
  return RECIPE_BY_ID.get(id);
}
