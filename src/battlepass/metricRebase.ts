/**
 * FASE 36.1 · REBASE CONSERVADOR DE MISIONES CON FUENTE CAMBIADA (puro).
 *
 * Una baseline tomada de la fuente ANTIGUA no se interpreta nunca con la NUEVA. Para traer una misión legacy a la
 * fuente vigente sin regalar ni quitar progreso:
 *
 *   progresoVisible = clamp(legacyValue − baseline, 0, goal)       ← lo que el jugador veía y había ganado
 *   nuevaBaseline   = currentValue − progresoVisible
 *   progreso futuro = currentValue' − nuevaBaseline = progresoVisible + (currentValue' − currentValue)
 *
 * Solo las aperturas POSTERIORES al rebase suman. Casos que NO se tocan (se quedan con su interpretación legacy):
 *   · ya en la versión vigente (idempotente: aplicar dos veces = una);
 *   · reclamada (no repetible): su recompensa ya se pagó y no se revoca;
 *   · de una ventana caducada (reloj del servidor): no se revive; la rotación la sustituye por una misión nueva
 *     que nace directamente con la fuente vigente.
 *
 * No reclama, no concede, no cambia `claimed`, `assignedAt`, `goal` ni `id`.
 */
import type { ActiveMission, PassState } from "./types";
import { METRIC_VERSIONS, isLegacyBaseline } from "./missions";
import { rotationDue } from "@/domain/progression/periods";

export type RebaseOutcome = "REBASED" | "ALREADY_CURRENT" | "NOT_VERSIONED" | "SKIPPED_CLAIMED" | "SKIPPED_EXPIRED";

/** Valores de las dos fuentes de una métrica en el instante del rebase (servidor). */
export interface CounterPair { legacy: number; current: number }

export interface MissionRebaseReport {
  id: string;
  kind: string;
  metric: string;
  goal: number;
  assignedAt: number;
  outcome: RebaseOutcome;
  fromBaseline: number;
  toBaseline: number;
  /** Progreso visible bajo la fuente antigua (lo que se conserva). `null` si no aplica. */
  carried: number | null;
  /** Progreso que daría la fuente NUEVA con la baseline antigua (la reinterpretación que se evita). `null` si no aplica. */
  naive: number | null;
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

export function legacyProgress(m: Pick<ActiveMission, "baseline" | "goal">, legacyValue: number): number {
  return Math.max(0, Math.min(m.goal, legacyValue - m.baseline));
}

export function rebaseMission(m: ActiveMission, counters: Readonly<Record<string, CounterPair>>, now: number): { mission: ActiveMission; report: MissionRebaseReport } {
  const report = (outcome: RebaseOutcome, toBaseline = m.baseline, carried: number | null = null, naive: number | null = null): MissionRebaseReport => ({
    id: m.id, kind: m.kind, metric: m.metric, goal: m.goal, assignedAt: m.assignedAt, outcome, fromBaseline: m.baseline, toBaseline, carried, naive,
  });
  const version = METRIC_VERSIONS[m.metric];
  if (version === undefined) return { mission: m, report: report("NOT_VERSIONED") };
  if (!isLegacyBaseline(m)) return { mission: m, report: report("ALREADY_CURRENT") };
  if (m.claimed) return { mission: m, report: report("SKIPPED_CLAIMED") };
  if (rotationDue(m.kind, m.assignedAt, now)) return { mission: m, report: report("SKIPPED_EXPIRED") };

  const c = counters[m.metric];
  if (!c || !isCount(c.legacy) || !isCount(c.current)) throw new Error(`Contadores no válidos para ${m.metric}`);
  if (!Number.isFinite(m.baseline) || !Number.isFinite(m.goal) || m.goal <= 0) throw new Error(`Misión no válida: ${m.id}`);

  const carried = legacyProgress(m, c.legacy);
  const naive = Math.max(0, Math.min(m.goal, c.current - m.baseline));
  const toBaseline = c.current - carried;
  return { mission: { ...m, baseline: toBaseline, metricVersion: version }, report: report("REBASED", toBaseline, carried, naive) };
}

export function rebaseState(state: PassState, counters: Readonly<Record<string, CounterPair>>, now: number): { state: PassState; reports: MissionRebaseReport[]; changed: boolean } {
  const reports: MissionRebaseReport[] = [];
  const missions = state.missions.map((m) => {
    const r = rebaseMission(m, counters, now);
    reports.push(r.report);
    return r.mission;
  });
  const changed = reports.some((r) => r.outcome === "REBASED");
  return { state: changed ? { ...state, missions } : state, reports, changed };
}
