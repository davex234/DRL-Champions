/**
 * HISTORY — auditoría inmutable de cada mensaje: destino, canal, estado, intentos y fecha
 * lógica de cada transición. Jamás se pierde ni se sobrescribe.
 */
import type { HubHistoryEntry, HubRegistry, NotificationMessage } from "./types";

export function appendHubHistory(reg: HubRegistry, m: NotificationMessage, at: number, detail?: string): HubRegistry {
  const entry: HubHistoryEntry = {
    seq: reg.seq + 1, at, messageId: m.id, channelId: m.channelId, target: m.target,
    kind: m.kind, state: m.state, attempts: m.attempts, detail,
  };
  return { ...reg, seq: reg.seq + 1, history: [...reg.history, entry] };
}

export const historyOfMessage = (reg: HubRegistry, messageId: string): HubHistoryEntry[] =>
  reg.history.filter((h) => h.messageId === messageId);

export function auditHub(reg: HubRegistry): string[] {
  const issues: string[] = [];
  for (let i = 1; i < reg.history.length; i++) {
    if (reg.history[i].seq <= reg.history[i - 1].seq) issues.push(`seq no monótona: ${reg.history[i].seq}`);
  }
  for (const h of reg.history) if (!reg.messages[h.messageId]) issues.push(`historial de mensaje inexistente: ${h.messageId}`);
  for (const id of reg.order) if (!reg.messages[id]) issues.push(`orden con mensaje inexistente: ${id}`);
  for (const key of reg.sentKeys) {
    if (!Object.values(reg.messages).some((m) => m.dedupeKey === key && m.state === "sent")) {
      issues.push(`clave enviada sin mensaje sent: ${key}`);
    }
  }
  return issues;
}
