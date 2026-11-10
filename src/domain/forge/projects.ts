/**
 * F79 · PROYECTOS 2.0 — etapas de un proyecto de carta F73. PURO.
 *
 *   ETAPA 1..n  MISIONES   misiones del proyecto agrupadas por PROFUNDIDAD de dependencias (una misión sin
 *                          dependencias dentro del proyecto es etapa 1; la que depende de ella, etapa 2…).
 *   REÚNE       (opcional) requisitos de POSESIÓN: se comprueban, no se consumen.
 *   FABRICA     (opcional) una receta avanzada que hay que haber completado (ahí sí se consume, con confirmación).
 *   RECLAMA     la carta REAL objetivo del proyecto (F73, idempotente).
 *
 * Sin extras de Forja, un proyecto se ve y se comporta exactamente como en F73 (etapas = sus misiones).
 */
import type { MissionView } from "@/domain/missionEngine/state";
import type { ProjectExtras } from "./types";
import type { OwnCheck } from "./requirements";

export type StageKind = "MISSIONS" | "OWN" | "FABRICATE" | "CLAIM";
export interface StageItem { label: string; done: boolean; progress?: number; target?: number; refId?: string }
export interface ProjectStage { index: number; kind: StageKind; title: string; done: boolean; items: StageItem[] }

export function missionDepths(missions: readonly Pick<MissionView, "id" | "dependsOn">[]): Map<string, number> {
  const ids = new Set(missions.map((m) => m.id));
  const byId = new Map(missions.map((m) => [m.id, m]));
  const memo = new Map<string, number>();
  const depth = (id: string, guard: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (guard.has(id)) return 1; // ciclo (el admin no lo permite): no revienta
    guard.add(id);
    const deps = (byId.get(id)?.dependsOn ?? []).filter((d) => ids.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(x, guard))) : 1;
    memo.set(id, d);
    return d;
  };
  for (const m of missions) depth(m.id, new Set());
  return memo;
}

export function projectStages(
  missions: readonly MissionView[], extras: ProjectExtras | undefined, own: readonly OwnCheck[],
  fabricate: { recipeId: string; name: string; done: boolean } | null, claimed: boolean,
): { stages: ProjectStage[]; extrasMet: boolean } {
  const depths = missionDepths(missions);
  const maxDepth = Math.max(0, ...depths.values());
  const stages: ProjectStage[] = [];
  for (let d = 1; d <= maxDepth; d++) {
    const ms = missions.filter((m) => depths.get(m.id) === d);
    if (!ms.length) continue;
    const items = ms.map((m) => ({ label: m.name, done: m.state === "COMPLETED" || m.state === "CLAIMED", progress: m.progress, target: m.target, refId: m.id }));
    stages.push({ index: stages.length + 1, kind: "MISSIONS", title: maxDepth > 1 ? `Etapa ${d}` : "Misiones", done: items.every((i) => i.done), items });
  }
  if (extras && own.length) {
    const items = own.map((o) => ({ label: o.label, done: o.met, progress: Math.min(o.have, o.need), target: o.need }));
    stages.push({ index: stages.length + 1, kind: "OWN", title: "Reúne (no se consume)", done: items.every((i) => i.done), items });
  }
  if (fabricate) stages.push({ index: stages.length + 1, kind: "FABRICATE", title: "Fabrica", done: fabricate.done, items: [{ label: fabricate.name, done: fabricate.done, refId: fabricate.recipeId }] });
  /** Lo que Forge AÑADE al proyecto F73 (posesión + fabricación). Las misiones las sigue exigiendo F73. */
  const extrasMet = own.every((o) => o.met) && (!fabricate || fabricate.done);
  stages.push({ index: stages.length + 1, kind: "CLAIM", title: "Reclama", done: claimed, items: [{ label: "Carta del proyecto", done: claimed }] });
  return { stages, extrasMet };
}
