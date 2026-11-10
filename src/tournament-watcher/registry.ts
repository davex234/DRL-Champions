/**
 * REGISTRY — memoria del watcher, y NADA MÁS que lo pactado: último snapshot, última
 * revisión, fingerprint e historial de eventos por torneo. Inmutable (cada operación
 * devuelve un registry nuevo) y 100% serializable para persistir entre pasadas.
 */
import type { RawSnapshot } from "@/importer";
import { WATCHER_SCHEMA_VERSION, type WatchEvent, type WatchedTournament, type WatcherRegistry } from "./types";

export function createWatcherRegistry(): WatcherRegistry {
  return { schemaVersion: WATCHER_SCHEMA_VERSION, tournaments: {}, order: [], seq: 0 };
}

/** Registra la observación de un torneo (nuevo o revisado). */
export function withObservation(
  reg: WatcherRegistry, tournamentId: string, snapshot: RawSnapshot, fingerprint: string,
  observedAt: number, events: WatchEvent[],
): WatcherRegistry {
  const prev = reg.tournaments[tournamentId];
  const entry: WatchedTournament = {
    tournamentId,
    revision: (prev?.revision ?? 0) + (prev && prev.fingerprint === fingerprint ? 0 : 1),
    fingerprint,
    snapshot,
    observedAt,
    history: [...(prev?.history ?? []), ...events],
    removed: false,
  };
  return {
    ...reg,
    tournaments: { ...reg.tournaments, [tournamentId]: entry },
    order: reg.order.includes(tournamentId) ? reg.order : [...reg.order, tournamentId],
    seq: reg.seq + events.length,
  };
}

/** Marca un torneo como desaparecido de las observaciones (historial intacto). */
export function withRemoval(reg: WatcherRegistry, tournamentId: string, events: WatchEvent[]): WatcherRegistry {
  const prev = reg.tournaments[tournamentId];
  if (!prev) return reg;
  return {
    ...reg,
    tournaments: { ...reg.tournaments, [tournamentId]: { ...prev, removed: true, history: [...prev.history, ...events] } },
    seq: reg.seq + events.length,
  };
}

export const historyOf = (reg: WatcherRegistry, tournamentId: string): WatchEvent[] =>
  reg.tournaments[tournamentId]?.history ?? [];

/** Auditoría de integridad del registry (vacío = íntegro). */
export function auditRegistry(reg: WatcherRegistry): string[] {
  const issues: string[] = [];
  const all = Object.values(reg.tournaments).flatMap((t) => t.history).sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < all.length; i++) if (all[i].seq <= all[i - 1].seq) issues.push(`seq no monótona: ${all[i].seq}`);
  if (all.length !== reg.seq) issues.push(`seq (${reg.seq}) ≠ eventos totales (${all.length})`);
  for (const id of reg.order) if (!reg.tournaments[id]) issues.push(`orden con torneo inexistente: ${id}`);
  return issues;
}
