/**
 * QUEUE — estados de las peticiones (pendientes · planificadas · canceladas · duplicadas ·
 * ejecutadas), SOLO como registro: aquí no se ejecuta ningún motor. "executed" significa
 * "el ejecutor externo INFORMÓ de que la ejecutó"; el coordinador solo lo anota.
 */
import { appendHistory } from "./history";
import type { CoordinatorClock, CoordinatorRegistry, PipelineRequest, RequestState } from "./types";

function setState(
  reg: CoordinatorRegistry, requestId: string, state: RequestState, clock: CoordinatorClock, reason: string,
  allowed: RequestState[],
): CoordinatorRegistry {
  const r = reg.requests[requestId];
  if (!r || !allowed.includes(r.state)) return reg;
  const at = clock();
  const next: CoordinatorRegistry = {
    ...reg,
    requests: { ...reg.requests, [requestId]: { ...r, state, updatedAt: at } },
  };
  return appendHistory(next, {
    at, kind: "state-changed", tournamentId: r.tournamentId, requestId, reason, state,
  });
}

/** El ejecutor externo TOMÓ la petición (queda planificada). */
export const markPlanned = (reg: CoordinatorRegistry, id: string, clock: CoordinatorClock): CoordinatorRegistry =>
  setState(reg, id, "planned", clock, "tomada por el ejecutor", ["pending"]);

/** El ejecutor externo INFORMA de la ejecución (solo registro; aquí no se ejecutó nada). */
export const markExecuted = (reg: CoordinatorRegistry, id: string, clock: CoordinatorClock): CoordinatorRegistry =>
  setState(reg, id, "executed", clock, "ejecución informada por el ejecutor", ["planned"]);

export const cancelRequest = (reg: CoordinatorRegistry, id: string, clock: CoordinatorClock, reason = "cancelada"): CoordinatorRegistry =>
  setState(reg, id, "cancelled", clock, reason, ["pending", "planned"]);

/** Peticiones pendientes en orden determinista (creación). */
export function pendingRequests(reg: CoordinatorRegistry): PipelineRequest[] {
  return reg.order.map((id) => reg.requests[id]).filter((r) => r.state === "pending");
}
