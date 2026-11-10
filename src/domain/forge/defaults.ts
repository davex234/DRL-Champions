/**
 * F79 · CONFIGURACIÓN CENTRAL POR DEFECTO de NEXUS FORGE 2.0. PURO.
 *
 * Es la ÚNICA fuente de los números de progresión (no hay constantes sueltas por el código). Producción la sobrescribe
 * con el documento de `forge_config` (0061) que edita el panel; sin 0061 se usa esto tal cual.
 *
 * Reglas que esta configuración respeta:
 *   · XP, nivel y maestría NO dan nada económico: son estado de progresión derivado del libro mayor.
 *   · Todo el CONTENIDO nuevo (recetas avanzadas, cadenas, planos, objetivos, logros) nace DRAFT y SIN recompensa.
 *   · Las plantillas de recetas avanzadas piden SIEMPRE más material que el intercambio F73 equivalente
 *     (plata→oro 3, oro→masters 8, masters→champions 14): aunque se activaran tal cual, nunca serían mejor ruta que la
 *     existente. Solo usan clases y ediciones REALES; ninguna apunta a una carta concreta inventada.
 */
import type { ForgeConfig } from "./types";

export const DEFAULT_FORGE_CONFIG: ForgeConfig = {
  enabled: true,
  xp: { craftPack: 20, craftCard: 30, craftAdvanced: 60, chainComplete: 120, projectClaim: 150, objectiveComplete: 25 },
  curve: { base: 100, growth: 1.22, maxLevel: 40 },
  mastery: [
    { branch: "SOBRES", label: "Forja de sobres", metric: "PACK_CRAFTS", thresholds: [1, 5, 15, 40, 100] },
    { branch: "INTERCAMBIO", label: "Forja de cartas", metric: "CARD_CRAFTS", thresholds: [1, 5, 15, 40, 100] },
    { branch: "PROYECTOS", label: "Proyectos", metric: "PROJECTS", thresholds: [1, 2, 4, 8, 15] },
    // Umbrales por debajo de las 331 cartas del catálogo real.
    { branch: "COLECCION", label: "Colección", metric: "DISTINCT_CARDS", thresholds: [25, 60, 120, 200, 300] },
  ],
  recipes: [
    {
      id: "forge-ruta-oro", name: "Refinado de Oro", hint: "Alcanza el nivel 2 de Forja.", status: "DRAFT",
      unlock: [{ type: "FORGE_LEVEL", min: 2 }], own: [],
      consume: [{ qty: 4, class: "plata" }], output: { type: "CLASS", class: "oro" }, repeatable: false, sortOrder: 10,
    },
    {
      id: "forge-ruta-masters", name: "Forjado Masters", hint: "Completa el Refinado de Oro.", status: "DRAFT",
      unlock: [{ type: "RECIPE_DONE", recipeId: "forge-ruta-oro" }], own: [{ type: "OWN_EDITION", variantId: "masters-l", min: 1 }],
      consume: [{ qty: 10, class: "oro" }], output: { type: "CLASS", class: "masters" }, repeatable: false, sortOrder: 20,
    },
    {
      id: "forge-ruta-champions", name: "Sello Champions", hint: "Necesitas el plano Sello y el Forjado Masters.", status: "DRAFT",
      unlock: [{ type: "RECIPE_DONE", recipeId: "forge-ruta-masters" }, { type: "BLUEPRINT", blueprintId: "bp-sello-champions" }],
      own: [{ type: "OWN_DISTINCT_PLAYERS", min: 40 }],
      consume: [{ qty: 16, class: "masters" }], output: { type: "CLASS", class: "champions" }, repeatable: false, sortOrder: 30,
    },
  ],
  chains: [
    { id: "ruta-del-campeon", name: "Ruta del Campeón", description: "Oro → Masters → Champions, cada paso abre el siguiente.", status: "DRAFT", steps: ["forge-ruta-oro", "forge-ruta-masters", "forge-ruta-champions"] },
  ],
  blueprints: [
    { id: "bp-sello-champions", name: "Plano · Sello Champions", hint: "Se obtiene al llegar al nivel 5 de Forja.", status: "DRAFT", source: { type: "FORGE_LEVEL", min: 5 } },
  ],
  projects: [],
  objectives: [
    { id: "obj-dia-forja", name: "Enciende la Forja", period: "DAILY", metric: "CRAFT_ANY", target: 1, reward: {}, status: "DRAFT" },
    { id: "obj-semana-forja", name: "Semana de Forja", period: "WEEKLY", metric: "CRAFT_ANY", target: 5, reward: {}, status: "DRAFT" },
  ],
  achievements: [
    { id: "ach-primera-forja", name: "Primera forja", description: "Completa tu primer crafteo.", metric: "CRAFTS_TOTAL", target: 1, reward: {}, status: "DRAFT" },
    { id: "ach-forjador", name: "Forjador", description: "Completa 10 crafteos.", metric: "CRAFTS_TOTAL", target: 10, reward: {}, status: "DRAFT" },
    { id: "ach-maestro-forja", name: "Maestro de la Forja", description: "Completa 50 crafteos.", metric: "CRAFTS_TOTAL", target: 50, reward: {}, status: "DRAFT" },
    { id: "ach-receta-avanzada", name: "Receta avanzada", description: "Completa tu primera receta avanzada.", metric: "ADVANCED_CRAFTS", target: 1, reward: {}, status: "DRAFT" },
    { id: "ach-primera-cadena", name: "Cadena completa", description: "Termina tu primera cadena de Forja.", metric: "CHAINS_DONE", target: 1, reward: {}, status: "DRAFT" },
    { id: "ach-primer-proyecto", name: "Proyecto terminado", description: "Reclama tu primer proyecto de carta.", metric: "PROJECTS_CLAIMED", target: 1, reward: {}, status: "DRAFT" },
    { id: "ach-forja-10", name: "Núcleo ardiente", description: "Llega al nivel 10 de Forja.", metric: "FORGE_LEVEL", target: 10, reward: {}, status: "DRAFT" },
  ],
  pity: { enabled: false, preferUnowned: true },
};

/**
 * Mezcla el documento guardado sobre los valores por defecto, campo a campo de primer nivel (un documento antiguo
 * sin un campo nuevo sigue funcionando). No valida: eso lo hace `validateForgeConfig` al GUARDAR.
 */
export function mergeForgeConfig(doc: unknown): ForgeConfig {
  const d = (doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {}) as Partial<ForgeConfig>;
  const base = DEFAULT_FORGE_CONFIG;
  return {
    enabled: typeof d.enabled === "boolean" ? d.enabled : base.enabled,
    xp: { ...base.xp, ...(d.xp ?? {}) },
    curve: { ...base.curve, ...(d.curve ?? {}) },
    mastery: Array.isArray(d.mastery) ? d.mastery : base.mastery,
    recipes: Array.isArray(d.recipes) ? d.recipes : base.recipes,
    chains: Array.isArray(d.chains) ? d.chains : base.chains,
    blueprints: Array.isArray(d.blueprints) ? d.blueprints : base.blueprints,
    projects: Array.isArray(d.projects) ? d.projects : base.projects,
    objectives: Array.isArray(d.objectives) ? d.objectives : base.objectives,
    achievements: Array.isArray(d.achievements) ? d.achievements : base.achievements,
    pity: { ...base.pity, ...(d.pity ?? {}) },
  };
}
