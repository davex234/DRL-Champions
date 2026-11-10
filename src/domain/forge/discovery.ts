/**
 * F79 · DESCUBRIMIENTO DE RECETAS, CADENAS y PLANOS. PURO.
 *
 *   receta avanzada  LOCKED      → alguna condición de desbloqueo sin cumplir. Se ve: silueta, pista y qué condiciones
 *                                  ya cumples (no qué consume ni qué sale).
 *                    DISCOVERED  → desbloqueada, pero aún no puedes forjarla (te falta poseer algo o material).
 *                    AVAILABLE   → puedes forjarla ya.
 *                    COMPLETED   → no repetible y ya hecha (paso de cadena terminado).
 *   Las recetas FUNDAMENTALES (F73: sobres e intercambio) no pasan por aquí: están siempre a la vista.
 *
 * Desbloqueos, cadenas y planos son ESTADO DERIVADO de los hechos del servidor: no hay nada que «conceder» y por tanto
 * nada que dos pestañas puedan duplicar o desincronizar.
 */
import type { AdvancedRecipe, Blueprint, ForgeBranch, ForgeConfig, UnlockRule } from "./types";
import type { MasteryView } from "./progression";

export interface UnlockContext {
  level: number;
  mastery: readonly MasteryView[];
  recipesDone: ReadonlySet<string>;
  blueprints: ReadonlySet<string>;
}

export interface RuleCheck { rule: UnlockRule; met: boolean; label: string }

const BRANCH_LABEL: Record<ForgeBranch, string> = { SOBRES: "Forja de sobres", INTERCAMBIO: "Forja de cartas", PROYECTOS: "Proyectos", COLECCION: "Colección" };

export function checkRule(rule: UnlockRule, ctx: UnlockContext, names: { recipe?: (id: string) => string; blueprint?: (id: string) => string } = {}): RuleCheck {
  switch (rule.type) {
    case "FORGE_LEVEL": return { rule, met: ctx.level >= rule.min, label: `Nivel de Forja ${rule.min}` };
    case "RECIPE_DONE": return { rule, met: ctx.recipesDone.has(rule.recipeId), label: `Completa «${names.recipe?.(rule.recipeId) ?? rule.recipeId}»` };
    case "BLUEPRINT": return { rule, met: ctx.blueprints.has(rule.blueprintId), label: `Plano «${names.blueprint?.(rule.blueprintId) ?? rule.blueprintId}»` };
    case "MASTERY": return { rule, met: (ctx.mastery.find((m) => m.branch === rule.branch)?.rank ?? 0) >= rule.min, label: `${BRANCH_LABEL[rule.branch]} rango ${rule.min}` };
  }
}

export const isUnlocked = (r: Pick<AdvancedRecipe, "unlock">, ctx: UnlockContext) => r.unlock.every((u) => checkRule(u, ctx).met);

/* ─────────────────────────── planos ─────────────────────────── */

export interface BlueprintContext { level: number; projectsClaimed: ReadonlySet<string>; missionsCompleted: ReadonlySet<string>; achievementsDone: ReadonlySet<string> }

export function blueprintOwned(bp: Blueprint, ctx: BlueprintContext): boolean {
  if (bp.status === "DRAFT") return false;
  const s = bp.source;
  switch (s.type) {
    case "FORGE_LEVEL": return ctx.level >= s.min;
    case "PROJECT_CLAIMED": return ctx.projectsClaimed.has(s.projectId);
    case "MISSION_COMPLETED": return ctx.missionsCompleted.has(s.missionId);
    case "ACHIEVEMENT": return ctx.achievementsDone.has(s.achievementId);
  }
}

export interface BlueprintView { id: string; name: string; hint: string; owned: boolean }
export const blueprintViews = (cfg: ForgeConfig, ctx: BlueprintContext): BlueprintView[] =>
  cfg.blueprints.filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.id, name: b.name, hint: b.hint, owned: blueprintOwned(b, ctx) }));
export const ownedBlueprints = (cfg: ForgeConfig, ctx: BlueprintContext): Set<string> =>
  new Set(cfg.blueprints.filter((b) => blueprintOwned(b, ctx)).map((b) => b.id));

/* ─────────────────────────── cadenas ─────────────────────────── */

export interface ChainStepView { recipeId: string; name: string; done: boolean }
export interface ChainView { id: string; name: string; description: string; steps: ChainStepView[]; done: number; total: number; completed: boolean }

export function chainViews(cfg: ForgeConfig, recipesDone: ReadonlySet<string>): ChainView[] {
  const nameOf = (id: string) => cfg.recipes.find((r) => r.id === id)?.name ?? id;
  return cfg.chains.filter((c) => c.status === "ACTIVE").map((c) => {
    const steps = c.steps.map((s) => ({ recipeId: s, name: nameOf(s), done: recipesDone.has(s) }));
    const done = steps.filter((s) => s.done).length;
    return { id: c.id, name: c.name, description: c.description, steps, done, total: steps.length, completed: steps.length > 0 && done === steps.length };
  });
}

/** Cadenas terminadas (para la XP). Cuentan también las RETIRED ya terminadas; nunca las DRAFT. */
export const chainsCompleted = (cfg: ForgeConfig, recipesDone: ReadonlySet<string>): number =>
  cfg.chains.filter((c) => c.status !== "DRAFT" && c.steps.length > 0 && c.steps.every((s) => recipesDone.has(s))).length;

export const chainOf = (cfg: ForgeConfig, recipeId: string) => {
  const c = cfg.chains.find((x) => x.status === "ACTIVE" && x.steps.includes(recipeId));
  return c ? { id: c.id, name: c.name, step: c.steps.indexOf(recipeId) + 1, total: c.steps.length } : null;
};

/* ─────────────────────────── estado de una receta ─────────────────────────── */

export type AdvancedState = "LOCKED" | "DISCOVERED" | "AVAILABLE" | "COMPLETED";

export function advancedState(r: AdvancedRecipe, ctx: UnlockContext, canCraft: boolean): AdvancedState {
  if (!r.repeatable && ctx.recipesDone.has(r.id)) return "COMPLETED";
  if (!isUnlocked(r, ctx)) return "LOCKED";
  return canCraft ? "AVAILABLE" : "DISCOVERED";
}
