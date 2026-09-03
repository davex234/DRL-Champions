/**
 * HISTORY — historial inmutable del coordinador: cada decisión (incluidas las de esperar/
 * ignorar), cada petición creada, cada fusión y cada cambio de estado, con evento origen,
 * motivo, fecha lógica y estado. Jamás se pierde ni se sobrescribe.
 */
import type { CoordinatorHistoryEntry, CoordinatorRegistry } from "./types";

export function appendHistory(
  reg: CoordinatorRegistry, entry: Omit<CoordinatorHistoryEntry, "seq">,
): CoordinatorRegistry {
  return { ...reg, seq: reg.seq + 1, history: [...reg.history, { ...entry, seq: reg.seq + 1 }] };
}

export const historyOfTournament = (reg: CoordinatorRegistry, tournamentId: string): CoordinatorHistoryEntry[] =>
  reg.history.filter((h) => h.tournamentId === tournamentId);

export const historyOfRequest = (reg: CoordinatorRegistry, requestId: string): CoordinatorHistoryEntry[] =>
  reg.history.filter((h) => h.requestId === requestId);

/** Auditoría (vacío = íntegro): seq monótona y peticiones referenciadas existentes. */
export function auditCoordinator(reg: CoordinatorRegistry): string[] {
  const issues: string[] = [];
  for (let i = 1; i < reg.history.length; i++) {
    if (reg.history[i].seq <= reg.history[i - 1].seq) issues.push(`seq no monótona en historial: ${reg.history[i].seq}`);
  }
  for (const h of reg.history) {
    if (h.requestId && !reg.requests[h.requestId]) issues.push(`historial referencia petición inexistente: ${h.requestId}`);
  }
  for (const id of reg.order) if (!reg.requests[id]) issues.push(`orden con petición inexistente: ${id}`);
  return issues;
}
