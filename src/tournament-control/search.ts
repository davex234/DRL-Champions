/**
 * SEARCH — búsqueda de texto libre sobre el ledger: torneos (nombre/id), generaciones
 * (generationId) y cartas (cardId/jugador/nick/variante). Pura, case-insensitive y de orden
 * estable (orden del panel; dentro de un registro, orden de la generación).
 */
import type { ControlLedger, SearchHit } from "./types";

export function searchControl(l: ControlLedger, text: string): SearchHit[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const id of l.order) {
    const rec = l.records[id];
    if (rec.tournamentName.toLowerCase().includes(q) || rec.tournamentId.toLowerCase().includes(q)) {
      hits.push({ kind: "tournament", recordId: id, ref: rec.tournamentId, label: rec.tournamentName });
    }
    if (rec.generationId.toLowerCase().includes(q) || rec.recordId.toLowerCase().includes(q)) {
      hits.push({ kind: "generation", recordId: id, ref: rec.generationId, label: `${rec.recordId} · ${rec.tournamentName}` });
    }
    const nickById = new Map(rec.generation.players.filter((p) => p.playerId).map((p) => [p.playerId!, p.nick]));
    for (const c of rec.generation.cards) {
      const nick = nickById.get(c.playerId) ?? "";
      if (c.cardId.toLowerCase().includes(q) || c.playerId.toLowerCase().includes(q) ||
          c.variantId.toLowerCase().includes(q) || nick.toLowerCase().includes(q)) {
        hits.push({ kind: "card", recordId: id, ref: c.cardId, label: `${nick || c.playerId} · ${c.variantId} · OVR ${c.ovr}` });
      }
    }
  }
  return hits;
}
