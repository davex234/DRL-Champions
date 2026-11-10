/**
 * DEDUPE — N eventos del mismo torneo con la misma acción PENDIENTE ⇒ UNA sola petición:
 * los eventos nuevos se fusionan en la canónica (sourceEventSeqs) y el motivo dominante es
 * el de mayor prioridad de la política (orden de reglas).
 */
import { rulePriority } from "./policy";
import type { CoordinatorRegistry, DecisionPolicy, PipelineRequest } from "./types";

/** Petición PENDIENTE canónica para (torneo, acción), si existe. */
export function pendingRequestFor(
  reg: CoordinatorRegistry, tournamentId: string, action: PipelineRequest["action"],
): PipelineRequest | undefined {
  for (const id of reg.order) {
    const r = reg.requests[id];
    if (r.tournamentId === tournamentId && r.action === action && r.state === "pending") return r;
  }
  return undefined;
}

/** Fusión: añade eventos y conserva el motivo MÁS prioritario. */
export function mergeIntoRequest(
  canonical: PipelineRequest, reason: string, eventSeqs: number[], policy: DecisionPolicy, at: number,
): PipelineRequest {
  const dominant = rulePriority(policy, reason) < rulePriority(policy, canonical.reason) ? reason : canonical.reason;
  return {
    ...canonical,
    reason: dominant,
    sourceEventSeqs: [...canonical.sourceEventSeqs, ...eventSeqs],
    updatedAt: at,
  };
}
