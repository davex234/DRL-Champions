/**
 * F79 · LA FOTO DE LA FORJA de un jugador — ensamblador PURO.
 *
 * Orden (sin ciclos): recuentos → cadenas terminadas → objetivos completados → XP → nivel → maestría → logros →
 * planos → estado de cada receta avanzada (que depende de nivel, maestría, recetas hechas y planos) → objetivos y
 * logros del periodo. El servidor solo reúne HECHOS y llama aquí; el navegador recibe el resultado y no decide nada.
 */
import type { ForgeConfig, AdvancedRecipe, ConsumeSlot, RecipeOutput } from "./types";
import { countFacts, forgeXp, levelFromXp, masteryViews, type ForgeFacts, type ForgeLevelInfo, type MasteryView, type XpBreakdown } from "./progression";
import { advancedState, blueprintViews, chainOf, chainViews, chainsCompleted, checkRule, ownedBlueprints, type AdvancedState, type BlueprintView, type ChainView, type RuleCheck, type UnlockContext } from "./discovery";
import { achievementViews, achievementsDone, objectiveViews, objectivesCompleted, type AchievementView, type ObjectiveView, type AchievementValues } from "./objectives";
import { checkOwn, slotLabel, type Labels, type OwnCheck } from "./requirements";
import type { SlotMaterials } from "./selector";

export interface ConsumeView { index: number; label: string; need: number; availableUnprotected: number; availableTotal: number; slot: ConsumeSlot }

export interface AdvancedRecipeView {
  id: string;
  name: string;
  hint: string;
  state: AdvancedState;
  repeatable: boolean;
  timesDone: number;
  /** Condiciones de desbloqueo con su estado (con LOCKED se ven, para saber qué falta). */
  rules: RuleCheck[];
  /** Con LOCKED: null (silueta). Desbloqueada: requisitos de POSESIÓN. */
  own: OwnCheck[] | null;
  /** Con LOCKED: null. Desbloqueada: requisitos de CONSUMO con lo que tienes disponible. */
  consume: ConsumeView[] | null;
  /** Con LOCKED: null. Desbloqueada: copias elegibles por hueco (para el selector; el servidor lo revalida todo al forjar). */
  materials: SlotMaterials[] | null;
  /** Con LOCKED: null (no se revela qué sale). */
  output: RecipeOutput | null;
  chain: { id: string; name: string; step: number; total: number } | null;
  canCraft: boolean;
  sortOrder: number;
}

export interface ForgeCore {
  enabled: boolean;
  xp: XpBreakdown;
  level: ForgeLevelInfo;
  /** Nivel máximo de la curva vigente (para pintar el núcleo y la barra). */
  maxLevel: number;
  mastery: MasteryView[];
  counts: { packCrafts: number; cardCrafts: number; advancedCrafts: number; projects: number; chainsDone: number };
  recipes: AdvancedRecipeView[];
  chains: ChainView[];
  blueprints: BlueprintView[];
  objectives: ObjectiveView[];
  achievements: AchievementView[];
}

export interface ForgeEvalInput {
  cfg: ForgeConfig;
  facts: ForgeFacts;
  now: number;
  /** Claves `forge:*` ya reclamadas (asientos de `credit_transactions`). */
  claimedRefs: ReadonlySet<string>;
  /** Materiales disponibles para los huecos de una receta (lo calcula el servidor con el inventario REAL). */
  materials: (slots: readonly ConsumeSlot[]) => SlotMaterials[];
  labels?: Labels;
}

const visible = (r: AdvancedRecipe) => r.status === "ACTIVE";

export function evaluateForge(inp: ForgeEvalInput): ForgeCore {
  const { cfg, facts, now } = inp;
  const counts = countFacts(facts);
  const chainsDone = chainsCompleted(cfg, counts.recipesDone);
  const objDone = objectivesCompleted(cfg, facts.ops);
  const xp = forgeXp(cfg, facts, chainsDone, objDone);
  const level = levelFromXp(xp.total, cfg.curve);
  const mastery = masteryViews(cfg, counts, facts.inventory);
  const achValues: AchievementValues = { craftsTotal: facts.ops.length, advancedCrafts: counts.advancedCrafts, chainsDone, projectsClaimed: counts.projects, forgeLevel: level.level };
  const achDone = achievementsDone(cfg, achValues);
  const bpCtx = { level: level.level, projectsClaimed: new Set(facts.projectClaims.map((p) => p.projectId)), missionsCompleted: facts.completedMissions, achievementsDone: achDone };
  const blueprints = ownedBlueprints(cfg, bpCtx);
  const ctx: UnlockContext = { level: level.level, mastery, recipesDone: counts.recipesDone, blueprints };
  const names = { recipe: (id: string) => cfg.recipes.find((r) => r.id === id)?.name ?? id, blueprint: (id: string) => cfg.blueprints.find((b) => b.id === id)?.name ?? id };
  const times = new Map<string, number>();
  for (const op of facts.ops) times.set(op.recipeId, (times.get(op.recipeId) ?? 0) + 1);

  const recipes: AdvancedRecipeView[] = cfg.recipes.filter(visible).map((r) => {
    const rules = r.unlock.map((u) => checkRule(u, ctx, names));
    const unlocked = rules.every((x) => x.met);
    const own = unlocked ? r.own.map((o) => checkOwn(o, facts.inventory, inp.labels)) : null;
    const mats = unlocked ? inp.materials(r.consume) : [];
    const consume = unlocked ? mats.map((m) => ({ index: m.index, label: slotLabel(m.slot, inp.labels), need: m.need, availableUnprotected: m.availableUnprotected, availableTotal: m.availableTotal, slot: m.slot })) : null;
    const canCraft = unlocked && (own ?? []).every((o) => o.met) && mats.every((m) => m.availableTotal >= m.need);
    return {
      id: r.id, name: r.name, hint: r.hint, state: advancedState(r, ctx, canCraft), repeatable: r.repeatable, timesDone: times.get(r.id) ?? 0,
      rules, own, consume, materials: unlocked ? mats : null, output: unlocked ? r.output : null, chain: chainOf(cfg, r.id), canCraft: canCraft && (r.repeatable || !counts.recipesDone.has(r.id)), sortOrder: r.sortOrder,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  return {
    enabled: cfg.enabled, xp, level, maxLevel: cfg.curve.maxLevel, mastery,
    counts: { packCrafts: counts.packCrafts, cardCrafts: counts.cardCrafts, advancedCrafts: counts.advancedCrafts, projects: counts.projects, chainsDone },
    recipes, chains: chainViews(cfg, counts.recipesDone), blueprints: blueprintViews(cfg, bpCtx),
    objectives: objectiveViews(cfg, facts.ops, now, inp.claimedRefs), achievements: achievementViews(cfg, achValues, inp.claimedRefs),
  };
}

/** ¿Puede este jugador forjar esta receta avanzada ahora? (la MISMA evaluación que la foto; el servidor la repite al craftear) */
export function recipeGate(core: ForgeCore, recipeId: string): { ok: true } | { ok: false; code: "RECIPE_LOCKED" | "RECIPE_COMPLETED" | "OWN_UNMET" | "RECIPE_UNAVAILABLE" } {
  const v = core.recipes.find((r) => r.id === recipeId);
  if (!v) return { ok: false, code: "RECIPE_UNAVAILABLE" };
  if (v.state === "LOCKED") return { ok: false, code: "RECIPE_LOCKED" };
  if (v.state === "COMPLETED") return { ok: false, code: "RECIPE_COMPLETED" };
  if ((v.own ?? []).some((o) => !o.met)) return { ok: false, code: "OWN_UNMET" };
  return { ok: true };
}
