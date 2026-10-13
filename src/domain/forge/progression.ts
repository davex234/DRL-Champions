/**
 * F79 · PROGRESIÓN DE LA FORJA — XP, nivel y maestría DERIVADOS del libro mayor. PURO.
 *
 * Entrada: los HECHOS que el servidor lee de tablas ya idempotentes (crafteos en `economy_ops`, proyectos reclamados,
 * inventario). Salida: XP total, nivel, progreso al siguiente y rangos de maestría. Recalcular N veces da lo mismo; un
 * crafteo repetido (misma ref) es UNA fila del libro mayor, así que tampoco puede contar dos veces.
 */
import { isForgeRecipeId, type ForgeBranch, type ForgeConfig, type MasteryMetric } from "./types";

/** Un crafteo ya aplicado (una fila `economy_ops` kind craft_pack / craft_card). */
export interface CraftOpFact {
  ref: string;
  kind: "PACK" | "CARD";
  recipeId: string;
  /** ms desde epoch (reloj de la BD). */
  at: number;
  inputs: { cardId?: string; packId?: string; qty?: number; uid?: string }[];
  outputs: { cardId?: string; packId?: string; qty?: number; uid?: string }[];
}

export interface InventorySummary {
  /** Cartas distintas que posees (definiciones, no copias). */
  distinctCards: number;
  /** Cartas distintas por edición (variantId). */
  distinctByVariant: Record<string, number>;
  /** Jugadores distintos de los que posees al menos una carta. */
  distinctPlayers: number;
  ownedCardIds: ReadonlySet<string>;
}

export interface ForgeFacts {
  ops: CraftOpFact[];
  projectClaims: { projectId: string; at: number }[];
  /** Misiones F73 completadas (o reclamadas). */
  completedMissions: ReadonlySet<string>;
  inventory: InventorySummary;
}

export const EMPTY_INVENTORY: InventorySummary = { distinctCards: 0, distinctByVariant: {}, distinctPlayers: 0, ownedCardIds: new Set() };

/* ─────────────────────────── recuentos ─────────────────────────── */

export interface ForgeCounts { packCrafts: number; cardCrafts: number; exchangeCrafts: number; advancedCrafts: number; projects: number; recipesDone: ReadonlySet<string> }

export function countFacts(f: ForgeFacts): ForgeCounts {
  let packCrafts = 0, exchangeCrafts = 0, advancedCrafts = 0;
  const recipesDone = new Set<string>();
  for (const op of f.ops) {
    recipesDone.add(op.recipeId);
    if (op.kind === "PACK") packCrafts++;
    else if (isForgeRecipeId(op.recipeId)) advancedCrafts++;
    else exchangeCrafts++;
  }
  return { packCrafts, cardCrafts: exchangeCrafts + advancedCrafts, exchangeCrafts, advancedCrafts, projects: new Set(f.projectClaims.map((p) => p.projectId)).size, recipesDone };
}

/* ─────────────────────────── nivel ─────────────────────────── */

/** XP necesaria para pasar del nivel `level` al siguiente (nivel 1 → 2 = base). */
export function xpToNext(level: number, curve: ForgeConfig["curve"]): number {
  return Math.max(1, Math.round(curve.base * Math.pow(curve.growth, Math.max(0, level - 1))));
}

export interface ForgeLevelInfo { level: number; xpIntoLevel: number; xpForNext: number; maxed: boolean }

export function levelFromXp(totalXp: number, curve: ForgeConfig["curve"]): ForgeLevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  const max = Math.max(1, Math.floor(curve.maxLevel));
  while (level < max) {
    const need = xpToNext(level, curve);
    if (rest < need) return { level, xpIntoLevel: rest, xpForNext: need, maxed: false };
    rest -= need;
    level++;
  }
  return { level: max, xpIntoLevel: 0, xpForNext: 0, maxed: true };
}

/* ─────────────────────────── maestría ─────────────────────────── */

export interface MasteryView { branch: ForgeBranch; label: string; metric: MasteryMetric; value: number; rank: number; maxRank: number; next: number | null; prev: number }

export function metricValue(metric: MasteryMetric, c: ForgeCounts, inv: InventorySummary): number {
  switch (metric) {
    case "PACK_CRAFTS": return c.packCrafts;
    case "CARD_CRAFTS": return c.cardCrafts;
    case "PROJECTS": return c.projects;
    case "DISTINCT_CARDS": return inv.distinctCards;
  }
}

export function masteryViews(cfg: ForgeConfig, c: ForgeCounts, inv: InventorySummary): MasteryView[] {
  return cfg.mastery.map((m) => {
    const value = metricValue(m.metric, c, inv);
    const t = [...m.thresholds].sort((a, b) => a - b);
    const rank = t.filter((x) => value >= x).length;
    return { branch: m.branch, label: m.label, metric: m.metric, value, rank, maxRank: t.length, next: rank < t.length ? t[rank] : null, prev: rank > 0 ? t[rank - 1] : 0 };
  });
}

export const masteryRank = (views: readonly MasteryView[], branch: ForgeBranch) => views.find((v) => v.branch === branch)?.rank ?? 0;

/* ─────────────────────────── XP ─────────────────────────── */

export interface XpBreakdown { crafts: number; chains: number; projects: number; objectives: number; total: number }

/**
 * XP total. `chainsDone` y `objectivesDone` los calcula quien llama (discovery/objectives) a partir de los MISMOS
 * hechos, para no duplicar la lógica: aquí solo se ponderan.
 */
export function forgeXp(cfg: ForgeConfig, f: ForgeFacts, chainsDone: number, objectivesDone: number): XpBreakdown {
  let crafts = 0;
  for (const op of f.ops) crafts += op.kind === "PACK" ? cfg.xp.craftPack : isForgeRecipeId(op.recipeId) ? cfg.xp.craftAdvanced : cfg.xp.craftCard;
  const projects = new Set(f.projectClaims.map((p) => p.projectId)).size * cfg.xp.projectClaim;
  const chains = chainsDone * cfg.xp.chainComplete;
  const objectives = objectivesDone * cfg.xp.objectiveComplete;
  return { crafts, chains, projects, objectives, total: crafts + chains + projects + objectives };
}
