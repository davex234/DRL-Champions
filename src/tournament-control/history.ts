/**
 * HISTORY — cronología unificada del panel: eventos de control (importación · generación ·
 * publicación · rollback · duplicados) FUSIONADOS con el historial editorial F4 de cada caso
 * (revisiones y decisiones carta a carta). Orden total determinista: (at, fuente, seq).
 */
import type { ControlLedger, HistoryEntry } from "./types";

/** Historial completo del panel, o solo el de un registro si se indica `recordId`. */
export function buildHistory(l: ControlLedger, recordId?: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const e of l.events) {
    if (recordId && e.recordId !== recordId) continue;
    entries.push({
      at: e.at, source: "control", kind: e.kind, actor: e.actor,
      recordId: e.recordId, generationId: e.generationId, detail: e.detail, seq: e.seq,
    });
  }

  for (const id of l.order) {
    if (recordId && id !== recordId) continue;
    const rec = l.records[id];
    if (!rec.editorial) continue;
    for (const e of rec.editorial.history) {
      entries.push({
        at: e.at, source: "editorial", kind: e.action, actor: e.actor,
        recordId: id, generationId: e.generationId, cardId: e.cardId,
        detail: [e.from && e.to ? `${e.from} → ${e.to}` : undefined, e.reason ?? e.comment]
          .filter(Boolean).join(" · ") || undefined,
        seq: e.seq,
      });
    }
  }

  return entries.sort((x, y) =>
    x.at - y.at ||
    (x.source === y.source ? 0 : x.source === "control" ? -1 : 1) ||
    (x.recordId < y.recordId ? -1 : x.recordId > y.recordId ? 1 : 0) ||
    x.seq - y.seq);
}
