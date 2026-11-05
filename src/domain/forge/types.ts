/**
 * F79 · NEXUS FORGE 2.0 — vocabulario. PURO.
 *
 * Forge 2.0 NO es otro sistema de crafteo: es PROGRESIÓN sobre el crafteo que ya existe (F73: `craft_recipes`,
 * `app_craft_pack`, `app_craft_card`, proyectos). Principio: TODO lo que el jugador «tiene» en la Forja (XP, nivel,
 * maestría, recetas descubiertas, cadenas, planos, logros, objetivos) se DERIVA en el servidor del libro mayor que ya es
 * idempotente (`economy_ops` craft_*, `user_project_claims`, `credit_transactions`) y del inventario. Nada de eso se
 * escribe aparte, así que dos pestañas o diez reintentos no pueden duplicarlo ni desincronizarlo, y el cliente no
 * puede mandarlo.
 *
 * Lo único configurable vive en UN documento versionado (`forge_config`, 0061), editable desde el panel. Todo contenido
 * nuevo (recetas avanzadas, cadenas, planos, objetivos, logros) nace DRAFT y no lo ve nadie hasta que el admin lo activa.
 */
import type { PackCardClass } from "@/domain/packs/packClass";
import type { MissionReward } from "@/domain/missionEngine/types";

export type ContentStatus = "DRAFT" | "ACTIVE" | "RETIRED";
export const CONTENT_STATUSES: readonly ContentStatus[] = ["DRAFT", "ACTIVE", "RETIRED"];

/** Ramas de maestría (nombres del producto: las mismas zonas de la Forja). */
export type ForgeBranch = "SOBRES" | "INTERCAMBIO" | "PROYECTOS" | "COLECCION";
export const FORGE_BRANCHES: readonly ForgeBranch[] = ["SOBRES", "INTERCAMBIO", "PROYECTOS", "COLECCION"];

/** XP de Forja por acción REAL ya registrada en el libro mayor. */
export interface ForgeXpRules {
  /** Crafteo de sobres (`economy_ops.kind = craft_pack`). */
  craftPack: number;
  /** Intercambio de cartas F73 (`craft_card`, receta base). */
  craftCard: number;
  /** Receta avanzada de Forge (`craft_card`, receta `forge-…`). */
  craftAdvanced: number;
  /** Bonus por cadena terminada (una vez por cadena). */
  chainComplete: number;
  /** Proyecto de carta reclamado (`user_project_claims`). */
  projectClaim: number;
  /** Objetivo diario/semanal completado (una vez por objetivo y periodo). */
  objectiveComplete: number;
}

/** Curva de nivel: XP para pasar del nivel n al n+1 = round(base · growth^(n−1)). */
export interface ForgeLevelCurve { base: number; growth: number; maxLevel: number }

export type MasteryMetric = "PACK_CRAFTS" | "CARD_CRAFTS" | "PROJECTS" | "DISTINCT_CARDS";
export interface MasteryDef {
  branch: ForgeBranch;
  label: string;
  metric: MasteryMetric;
  /** Umbrales crecientes: alcanzar el i-ésimo = rango i+1. */
  thresholds: number[];
}

/** Condición de desbloqueo de una receta avanzada (todas deben cumplirse). */
export type UnlockRule =
  | { type: "FORGE_LEVEL"; min: number }
  | { type: "RECIPE_DONE"; recipeId: string }
  | { type: "BLUEPRINT"; blueprintId: string }
  | { type: "MASTERY"; branch: ForgeBranch; min: number };

/** Requisito de POSESIÓN: se comprueba, NUNCA se consume. */
export type OwnRequirement =
  | { type: "OWN_EDITION"; variantId: string; min: number }
  | { type: "OWN_DISTINCT_PLAYERS"; min: number }
  | { type: "OWN_CARD"; cardId: string };

/**
 * Requisito de CONSUMO: N copias que DESAPARECEN. La clase es obligatoria (la canónica, `packCardClass`); los filtros
 * opcionales estrechan (edición REAL, equipo IMPRESO canónico, jugador REAL).
 */
export interface ConsumeSlot {
  qty: number;
  class: PackCardClass;
  variantId?: string;
  team?: string;
  playerId?: string;
}

export type RecipeOutput = { type: "CLASS"; class: PackCardClass } | { type: "CARD"; cardId: string };

/** Receta AVANZADA de la Forja. Su id empieza por `forge-` y tiene una fila espejo CARD en `craft_recipes` (la RPC). */
export interface AdvancedRecipe {
  id: string;
  name: string;
  /** Pista visible mientras está bloqueada (sin revelar la receta entera). */
  hint: string;
  status: ContentStatus;
  unlock: UnlockRule[];
  own: OwnRequirement[];
  consume: ConsumeSlot[];
  output: RecipeOutput;
  /** false → tras hacerla una vez queda COMPLETED (pasos de cadena). */
  repeatable: boolean;
  sortOrder: number;
}

export interface ForgeChain { id: string; name: string; description: string; status: ContentStatus; steps: string[] }

/** Un PLANO es un ESTADO de desbloqueo (no una moneda): se tiene o no, y se deriva de su fuente. */
export type BlueprintSource =
  | { type: "FORGE_LEVEL"; min: number }
  | { type: "PROJECT_CLAIMED"; projectId: string }
  | { type: "MISSION_COMPLETED"; missionId: string }
  | { type: "ACHIEVEMENT"; achievementId: string };
export interface Blueprint { id: string; name: string; hint: string; status: ContentStatus; source: BlueprintSource }

/** Extras de Forge para un proyecto F73 (etapas 2.0). Si un proyecto no tiene extras, se comporta como en F73. */
export interface ProjectExtras {
  projectId: string;
  /** Etapa «reúne»: posesión, no se consume. */
  own: OwnRequirement[];
  /** Etapa «fabrica»: una receta avanzada que hay que haber completado al menos una vez. */
  fabricateRecipeId: string | null;
}

export type ObjectivePeriod = "DAILY" | "WEEKLY";
export type ObjectiveMetric = "CRAFT_PACK" | "CRAFT_CARD" | "CRAFT_ADVANCED" | "CRAFT_ANY";
export interface ForgeObjective {
  id: string; name: string; period: ObjectivePeriod; metric: ObjectiveMetric; target: number; reward: MissionReward; status: ContentStatus;
  /**
   * F79.1 · VENTANAS en que estuvo ACTIVE (las sella el SERVIDOR al guardar; el panel no puede escribirlas). Solo cuentan
   * los crafteos dentro de una ventana: activar no regala XP por el pasado, retirar CONGELA (ni se pierde ni se gana) y
   * reactivar abre una ventana nueva. Sin ventanas → no da XP (por defecto, conservador).
   */
  activeWindows?: ActiveWindow[];
}
export interface ActiveWindow { from: number; to: number | null }
export const inWindows = (at: number, w: readonly ActiveWindow[] | undefined) => (w ?? []).some((x) => at >= x.from && (x.to === null || at < x.to));

export type AchievementMetric = "CRAFTS_TOTAL" | "ADVANCED_CRAFTS" | "CHAINS_DONE" | "PROJECTS_CLAIMED" | "FORGE_LEVEL";
export interface ForgeAchievement { id: string; name: string; description: string; metric: AchievementMetric; target: number; reward: MissionReward; status: ContentStatus }

/** Protección contra mala suerte en la salida ALEATORIA. Desactivada hasta que haya balance aprobado. */
export interface PityConfig {
  enabled: boolean;
  /** Con `enabled`: la salida aleatoria evita cartas que ya posees mientras quede alguna que no. */
  preferUnowned: boolean;
}

export interface ForgeConfig {
  /** Interruptor general de las piezas NUEVAS de Forge 2.0 en la interfaz (el crafteo F73 no depende de él). */
  enabled: boolean;
  xp: ForgeXpRules;
  curve: ForgeLevelCurve;
  mastery: MasteryDef[];
  recipes: AdvancedRecipe[];
  chains: ForgeChain[];
  blueprints: Blueprint[];
  projects: ProjectExtras[];
  objectives: ForgeObjective[];
  achievements: ForgeAchievement[];
  pity: PityConfig;
}

/** Prefijo reservado: el intercambio F73 nunca acepta estas recetas; solo la Forja, que comprueba desbloqueos. */
export const FORGE_RECIPE_PREFIX = "forge-";
export const isForgeRecipeId = (id: string) => id.startsWith(FORGE_RECIPE_PREFIX);
export const FORGE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
