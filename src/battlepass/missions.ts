/**
 * MISIONES (Collection Fase 6/7).
 *
 * 100% POR DATOS: cada misión mide una MÉTRICA acumulada real del juego (`MetricSnapshot`, que aporta
 * el store desde Gameplay/Career/Collection/Marketplace/Competitive/Online/Living World). El motor NO
 * duplica estadísticas: guarda un `baseline` al asignar y el progreso = snapshot − baseline (acotado al
 * goal). El sorteo de misiones usa el RNG del proyecto (determinista). Puro.
 */
import type { Rng } from "@/sim/rng";
import type { ActiveMission, MetricSnapshot, MissionDef } from "./types";

/** Progreso actual de una misión (acotado a [0, goal]). */
export function missionProgress(m: ActiveMission, snapshot: MetricSnapshot): number {
  const raw = (snapshot[m.metric] ?? 0) - m.baseline;
  return Math.max(0, Math.min(m.goal, raw));
}

export const isMissionComplete = (m: ActiveMission, snapshot: MetricSnapshot): boolean =>
  missionProgress(m, snapshot) >= m.goal;

/** Crea una misión activa fijando el baseline en la métrica actual. */
export function assignMission(def: MissionDef, snapshot: MetricSnapshot, now: number): ActiveMission {
  return { id: def.id, kind: def.kind, metric: def.metric, goal: def.goal, baseline: snapshot[def.metric] ?? 0, claimed: false, assignedAt: now };
}

/**
 * Sortea `count` misiones de un tipo del pool (ponderado por `weight`, sin ocultas, sin repetir),
 * de forma DETERMINISTA con el RNG del proyecto. Devuelve las definiciones elegidas.
 */
export function rollMissions(pool: MissionDef[], kind: MissionDef["kind"], count: number, rng: Rng): MissionDef[] {
  const candidates = pool.filter((m) => m.kind === kind && !m.hidden);
  const chosen: MissionDef[] = [];
  const remaining = [...candidates];
  while (chosen.length < count && remaining.length > 0) {
    const total = remaining.reduce((s, m) => s + (m.weight ?? 1), 0);
    let roll = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < remaining.length; i++) { roll -= remaining[i].weight ?? 1; if (roll <= 0) { idx = i; break; } }
    chosen.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return chosen;
}
