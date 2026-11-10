/**
 * EVENTS — materialización de detecciones en WatchEvents con secuencia global y fecha
 * lógica. El watcher SOLO emite: aquí no hay handlers, colas ni acciones — el consumo es
 * responsabilidad futura de Tournament Control.
 */
import type { DetectedChange } from "./diff";
import type { ObserveMeta, WatchEvent, WatchEventKind } from "./types";

export function makeEvents(
  baseSeq: number, meta: ObserveMeta, tournamentId: string, changes: DetectedChange[],
): WatchEvent[] {
  return changes.map((c, i) => ({
    seq: baseSeq + i + 1,
    at: meta.at,
    tournamentId,
    kind: c.kind,
    subject: c.subject,
    detail: c.detail,
  }));
}

/** Resumen por tipo (para métricas/CLI). */
export function countByKind(events: WatchEvent[]): Partial<Record<WatchEventKind, number>> {
  const out: Partial<Record<WatchEventKind, number>> = {};
  for (const e of events) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}
