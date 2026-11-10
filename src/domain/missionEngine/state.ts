/**
 * F73 · ESTADO DE MISIONES Y PROYECTOS de un usuario — derivado del progreso guardado y del reloj del SERVIDOR. PURO.
 *
 *   misión   LOCKED (dependencias sin completar o fuera de fecha) → ACTIVE → COMPLETED → CLAIMED (si tenía recompensa)
 *   proyecto LOCKED (fuera de fecha) → ACTIVE → COMPLETED (todas sus misiones completadas) → CLAIMED
 */
import type { MissionDef, MissionProgressRow, MissionState, ProjectDef } from "./types";

const inWindow = (x: { availableFrom: number | null; availableTo: number | null }, now: number) =>
  (x.availableFrom === null || now >= x.availableFrom) && (x.availableTo === null || now < x.availableTo);

export interface MissionView {
  id: string; name: string; description: string; target: number; progress: number; state: MissionState;
  reward: MissionDef["reward"]; hasReward: boolean; projectId: string | null; dependsOn: string[];
  conditionType: MissionDef["condition"]["type"]; sortOrder: number;
}

export const hasReward = (m: Pick<MissionDef, "reward">) =>
  (m.reward.credits ?? 0) > 0 || (m.reward.xp ?? 0) > 0 || (!!m.reward.packId && (m.reward.packCount ?? 0) > 0);

export function missionStates(defs: readonly MissionDef[], rows: readonly MissionProgressRow[], now: number): MissionView[] {
  const byId = new Map(rows.map((r) => [r.missionId, r]));
  const done = (id: string) => { const r = byId.get(id); return !!r && r.completedAt !== null; };
  return defs.filter((m) => m.status === "ACTIVE").map((m) => {
    const r = byId.get(m.id);
    const progress = Math.min(m.target, r?.progress ?? 0);
    let state: MissionState;
    if (r?.claimedAt != null) state = "CLAIMED";
    else if (r?.completedAt != null) state = hasReward(m) ? "COMPLETED" : "CLAIMED";
    else if (!inWindow(m, now) || !m.dependsOn.every(done)) state = "LOCKED";
    else state = "ACTIVE";
    return {
      id: m.id, name: m.name, description: m.description, target: m.target, progress, state, reward: m.reward, hasReward: hasReward(m),
      projectId: m.projectId, dependsOn: m.dependsOn, conditionType: m.condition.type, sortOrder: m.sortOrder,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** Misiones que pueden recibir progreso ahora mismo (las ACTIVE). */
export const activeForProgress = (defs: readonly MissionDef[], rows: readonly MissionProgressRow[], now: number): MissionDef[] => {
  const ok = new Set(missionStates(defs, rows, now).filter((v) => v.state === "ACTIVE").map((v) => v.id));
  return defs.filter((d) => ok.has(d.id));
};

export type ProjectState = "LOCKED" | "ACTIVE" | "COMPLETED" | "CLAIMED";
export interface ProjectView { id: string; name: string; description: string; targetCardId: string; state: ProjectState; completed: number; total: number; missionIds: string[]; sortOrder: number }

export function projectStates(projects: readonly ProjectDef[], missions: readonly MissionView[], claimed: ReadonlySet<string>, now: number): ProjectView[] {
  return projects.filter((p) => p.status === "ACTIVE").map((p) => {
    const ms = missions.filter((m) => m.projectId === p.id);
    const completed = ms.filter((m) => m.state === "COMPLETED" || m.state === "CLAIMED").length;
    let state: ProjectState;
    if (claimed.has(p.id)) state = "CLAIMED";
    else if (!inWindow(p, now)) state = "LOCKED";
    else if (ms.length > 0 && completed === ms.length) state = "COMPLETED";
    else state = "ACTIVE";
    return { id: p.id, name: p.name, description: p.description, targetCardId: p.targetCardId, state, completed, total: ms.length, missionIds: ms.map((m) => m.id), sortOrder: p.sortOrder };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
