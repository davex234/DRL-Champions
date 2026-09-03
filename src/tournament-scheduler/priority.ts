/**
 * PRIORITY — prioridad declarativa: la PRIMERA regla de la política cuyo `when` encaja con
 * el descriptor gana (en directo > playoffs > grandes finales > grupos > próximos >
 * terminados, por defecto). Todo datos; nada acoplado a ningún proveedor.
 */
import type { PriorityRule, SchedulePolicy, TournamentDescriptor } from "./types";

const matches = (rule: PriorityRule, d: TournamentDescriptor): boolean =>
  (rule.when.live === undefined || rule.when.live === d.live) &&
  (rule.when.status === undefined || rule.when.status === d.status) &&
  (rule.when.phase === undefined || rule.when.phase === d.phase);

export function priorityOf(d: TournamentDescriptor, policy: SchedulePolicy): { score: number; label: string } {
  for (const rule of policy.priorities) if (matches(rule, d)) return { score: rule.score, label: rule.label };
  return { score: 0, label: "sin regla" };
}
