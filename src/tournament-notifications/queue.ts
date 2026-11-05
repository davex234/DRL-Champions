/**
 * QUEUE — planificación y despacho A ADAPTADORES (jamás a APIs reales): pendientes →
 * enviadas / fallidas → reintentables → canceladas. Deduplicación permanente: una clave ya
 * ENVIADA jamás se reenvía; una pendiente en cola no se duplica.
 */
import { appendHubHistory } from "./history";
import { rankChannels } from "./channels";
import type {
  HubClock, HubRegistry, NotificationChannel, NotificationMessage, RoutingPolicy,
} from "./types";

export function createHubRegistry(): HubRegistry {
  return { schemaVersion: 1, messages: {}, order: [], history: [], sentKeys: [], perKey: {}, seq: 0 };
}

const put = (reg: HubRegistry, m: NotificationMessage): HubRegistry => ({
  ...reg,
  messages: { ...reg.messages, [m.id]: m },
  order: reg.order.includes(m.id) ? reg.order : [...reg.order, m.id],
});

/** Encola un mensaje si su clave no está enviada ni ya pendiente. */
export function enqueue(reg: HubRegistry, m: Omit<NotificationMessage, "id">, at: number): { registry: HubRegistry; message?: NotificationMessage; deduped: boolean } {
  if (reg.sentKeys.includes(m.dedupeKey)) return { registry: reg, deduped: true };
  const already = reg.order.map((id) => reg.messages[id])
    .some((x) => x.dedupeKey === m.dedupeKey && (x.state === "pending" || x.state === "retryable"));
  if (already) return { registry: reg, deduped: true };

  const n = (reg.perKey[m.dedupeKey] ?? 0) + 1;
  const message: NotificationMessage = { ...m, id: `${m.dedupeKey}#${n}` };
  let registry = put({ ...reg, perKey: { ...reg.perKey, [m.dedupeKey]: n } }, message);
  registry = appendHubHistory(registry, message, at, "encolado");
  return { registry, message, deduped: false };
}

export const pendingMessages = (reg: HubRegistry): NotificationMessage[] =>
  reg.order.map((id) => reg.messages[id]).filter((m) => m.state === "pending" || m.state === "retryable");

/** Despacha lo pendiente a los adaptadores sanos. Fallo ⇒ reintentable ⇒ cancelado. */
export function dispatch(
  reg: HubRegistry, channels: NotificationChannel[], policy: RoutingPolicy, clock: HubClock,
): { registry: HubRegistry; sent: number; failed: number } {
  const byId = new Map(rankChannels(channels).map((c) => [c.id, c]));
  let registry = reg;
  let sent = 0, failed = 0;
  const at = clock();

  for (const m of pendingMessages(registry)) {
    const channel = byId.get(m.channelId);
    if (!channel) {
      const next: NotificationMessage = { ...m, state: "failed", detail: "canal no disponible", updatedAt: at };
      registry = appendHubHistory(put(registry, next), next, at, "canal no disponible");
      failed++;
      continue;
    }
    const result = channel.send(m);
    if (result.ok) {
      const next: NotificationMessage = { ...m, state: "sent", attempts: m.attempts + 1, detail: result.detail, updatedAt: at };
      registry = appendHubHistory(put(registry, next), next, at, result.detail);
      registry = { ...registry, sentKeys: [...registry.sentKeys, m.dedupeKey] };
      sent++;
    } else {
      const attempts = m.attempts + 1;
      const state = attempts >= policy.maxAttempts ? "cancelled" : "retryable";
      const next: NotificationMessage = { ...m, state, attempts, detail: result.detail, updatedAt: at };
      registry = appendHubHistory(put(registry, next), next, at, result.detail);
      failed++;
    }
  }
  return { registry, sent, failed };
}

export function cancelMessage(reg: HubRegistry, messageId: string, clock: HubClock, reason = "cancelado"): HubRegistry {
  const m = reg.messages[messageId];
  if (!m || m.state === "sent" || m.state === "cancelled") return reg;
  const next: NotificationMessage = { ...m, state: "cancelled", detail: reason, updatedAt: clock() };
  return appendHubHistory(put(reg, next), next, clock(), reason);
}
