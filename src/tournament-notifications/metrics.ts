/**
 * METRICS — proyección de solo-lectura del hub: mensajes por estado y por canal.
 */
import type { HubMetrics, HubRegistry } from "./types";

export function hubMetrics(reg: HubRegistry, deduped = 0): HubMetrics {
  const all = reg.order.map((id) => reg.messages[id]);
  const by = (s: string): number => all.filter((m) => m.state === s).length;
  const byChannel: Record<string, number> = {};
  for (const m of all) byChannel[m.channelId] = (byChannel[m.channelId] ?? 0) + 1;
  return {
    messages: all.length,
    pending: by("pending"),
    sent: by("sent"),
    failed: by("failed"),
    retryable: by("retryable"),
    cancelled: by("cancelled"),
    deduped,
    byChannel,
  };
}
