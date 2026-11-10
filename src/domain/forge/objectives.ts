/**
 * F79 · OBJETIVOS DIARIOS/SEMANALES y LOGROS DE LA FORJA. PURO.
 *
 * NO son un segundo motor de misiones. El motor F73 procesa EVENTOS de partida/apertura/crafteo con progreso guardado y
 * misiones de UNA vez; un objetivo periódico de Forja es una VENTANA de tiempo sobre el libro mayor de crafteo que ya
 * existe: «crafteos en el día/semana en curso». Se calcula, no se guarda, así que no hay progreso que reiniciar ni que
 * duplicar. Reclamar (si el admin le puso recompensa) es `award()` con clave `forge:obj:<id>:<periodo>`: una vez por
 * periodo aunque lleguen diez reclamos.
 *
 * Periodos en UTC: día `D2026-10-01`; semana ISO `W2026-40` (lunes 00:00 UTC).
 */
import type { MissionReward } from "@/domain/missionEngine/types";
import { hasReward } from "@/domain/missionEngine/state";
import { inWindows, isForgeRecipeId, type AchievementMetric, type ForgeConfig, type ObjectiveMetric, type ObjectivePeriod } from "./types";
import type { CraftOpFact } from "./progression";

const DAY = 86_400_000;

function isoWeek(at: number): { year: number; week: number; start: number } {
  const d = new Date(at);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (new Date(dayStart).getUTCDay() + 6) % 7; // lunes = 0
  const monday = dayStart - dow * DAY;
  const thursday = monday + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  return { year, week: Math.round((monday - jan4Monday) / (7 * DAY)) + 1, start: monday };
}

export function periodKey(period: ObjectivePeriod, at: number): string {
  if (period === "DAILY") { const d = new Date(at); return `D${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
  const w = isoWeek(at); return `W${w.year}-${String(w.week).padStart(2, "0")}`;
}

export function periodWindow(period: ObjectivePeriod, now: number): { key: string; start: number; end: number } {
  if (period === "DAILY") { const d = new Date(now); const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); return { key: periodKey("DAILY", now), start, end: start + DAY }; }
  const w = isoWeek(now); return { key: periodKey("WEEKLY", now), start: w.start, end: w.start + 7 * DAY };
}

export const opMatches = (metric: ObjectiveMetric, op: CraftOpFact) =>
  metric === "CRAFT_ANY" || (metric === "CRAFT_PACK" && op.kind === "PACK") ||
  (metric === "CRAFT_CARD" && op.kind === "CARD" && !isForgeRecipeId(op.recipeId)) ||
  (metric === "CRAFT_ADVANCED" && op.kind === "CARD" && isForgeRecipeId(op.recipeId));

export const objectiveClaimRef = (id: string, key: string) => `forge:obj:${id}:${key}`;
export const achievementClaimRef = (id: string) => `forge:ach:${id}`;

export type RewardState = "ACTIVE" | "COMPLETED" | "CLAIMED" | "DONE";
export interface ObjectiveView { id: string; name: string; period: ObjectivePeriod; periodKey: string; progress: number; target: number; state: RewardState; reward: MissionReward; hasReward: boolean; resetsAt: number }

const rewardState = (done: boolean, rewarded: boolean, claimed: boolean): RewardState => (!done ? "ACTIVE" : !rewarded ? "DONE" : claimed ? "CLAIMED" : "COMPLETED");

export function objectiveViews(cfg: ForgeConfig, ops: readonly CraftOpFact[], now: number, claimedRefs: ReadonlySet<string>): ObjectiveView[] {
  return cfg.objectives.filter((o) => o.status === "ACTIVE").map((o) => {
    const w = periodWindow(o.period, now);
    const progress = Math.min(o.target, ops.filter((op) => op.at >= w.start && op.at < w.end && inWindows(op.at, o.activeWindows) && opMatches(o.metric, op)).length);
    const rewarded = hasReward(o);
    return { id: o.id, name: o.name, period: o.period, periodKey: w.key, progress, target: o.target, state: rewardState(progress >= o.target, rewarded, claimedRefs.has(objectiveClaimRef(o.id, w.key))), reward: o.reward, hasReward: rewarded, resetsAt: w.end };
  });
}

/**
 * Objetivos completados (para la XP): una vez por objetivo y periodo, SOLO con crafteos dentro de sus ventanas ACTIVAS
 * (`activeWindows`, selladas por el servidor). Sin ventanas no cuenta: activar no da XP retroactiva y retirar congela.
 */
export function objectivesCompleted(cfg: ForgeConfig, ops: readonly CraftOpFact[]): number {
  let n = 0;
  for (const o of cfg.objectives.filter((x) => x.status !== "DRAFT" && (x.activeWindows ?? []).length > 0)) {
    const per = new Map<string, number>();
    for (const op of ops) if (inWindows(op.at, o.activeWindows) && opMatches(o.metric, op)) { const k = periodKey(o.period, op.at); per.set(k, (per.get(k) ?? 0) + 1); }
    for (const c of per.values()) if (c >= o.target) n++;
  }
  return n;
}

export interface AchievementValues { craftsTotal: number; advancedCrafts: number; chainsDone: number; projectsClaimed: number; forgeLevel: number }
export const achievementValue = (m: AchievementMetric, v: AchievementValues) =>
  m === "CRAFTS_TOTAL" ? v.craftsTotal : m === "ADVANCED_CRAFTS" ? v.advancedCrafts : m === "CHAINS_DONE" ? v.chainsDone : m === "PROJECTS_CLAIMED" ? v.projectsClaimed : v.forgeLevel;

export interface AchievementView { id: string; name: string; description: string; progress: number; target: number; state: RewardState; reward: MissionReward; hasReward: boolean }

export function achievementViews(cfg: ForgeConfig, v: AchievementValues, claimedRefs: ReadonlySet<string>): AchievementView[] {
  return cfg.achievements.filter((a) => a.status === "ACTIVE").map((a) => {
    const value = achievementValue(a.metric, v);
    const rewarded = hasReward(a);
    return { id: a.id, name: a.name, description: a.description, progress: Math.min(value, a.target), target: a.target, state: rewardState(value >= a.target, rewarded, claimedRefs.has(achievementClaimRef(a.id))), reward: a.reward, hasReward: rewarded };
  });
}

/** Logros conseguidos (con o sin recompensa), para las fuentes de planos. Incluye los RETIRED ya conseguidos. */
export const achievementsDone = (cfg: ForgeConfig, v: AchievementValues): Set<string> =>
  new Set(cfg.achievements.filter((a) => a.status !== "DRAFT" && achievementValue(a.metric, v) >= a.target).map((a) => a.id));
