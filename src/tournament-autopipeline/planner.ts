/**
 * PLANNER — la ingesta: WatchEvents → decisiones (routing) → deduplicación → peticiones.
 * Cada evento queda en el historial con su decisión (también esperar/ignorar); los que
 * planifican acción crean UNA petición por (torneo, acción) o se fusionan en la pendiente.
 */
import type { WatchEvent } from "@/tournament-watcher";
import { mergeIntoRequest, pendingRequestFor } from "./dedupe";
import { appendHistory } from "./history";
import { routeEvent } from "./routing";
import {
  AUTOPIPELINE_SCHEMA_VERSION,
  type CoordinatorClock, type CoordinatorRegistry, type DecisionPolicy, type IngestResult,
  type PipelineRequest,
} from "./types";

export function createCoordinatorRegistry(): CoordinatorRegistry {
  return { schemaVersion: AUTOPIPELINE_SCHEMA_VERSION, requests: {}, order: [], history: [], perKey: {}, seq: 0 };
}

export function ingestEvents(
  reg: CoordinatorRegistry, events: WatchEvent[], policy: DecisionPolicy, clock: CoordinatorClock,
): { registry: CoordinatorRegistry; result: IngestResult } {
  let registry = reg;
  const at = clock();
  const created: PipelineRequest[] = [];
  let merged = 0, waited = 0, ignored = 0;

  for (const event of events) {
    const { action, reason } = routeEvent(event, policy);
    registry = appendHistory(registry, {
      at, kind: "decision", tournamentId: event.tournamentId,
      eventSeq: event.seq, eventKind: event.kind, reason, state: action,
    });

    if (action === "wait") { waited++; continue; }
    if (action === "ignore") { ignored++; continue; }

    const existing = pendingRequestFor(registry, event.tournamentId, action);
    if (existing) {
      const fused = mergeIntoRequest(existing, reason, [event.seq], policy, at);
      registry = {
        ...registry,
        requests: { ...registry.requests, [fused.id]: fused },
      };
      registry = appendHistory(registry, {
        at, kind: "request-merged", tournamentId: event.tournamentId,
        eventSeq: event.seq, eventKind: event.kind, requestId: fused.id, reason, state: "pending",
      });
      merged++;
      continue;
    }

    const key = `${event.tournamentId}@${action}`;
    const n = (registry.perKey[key] ?? 0) + 1;
    const request: PipelineRequest = {
      id: `${key}#${n}`,
      tournamentId: event.tournamentId,
      action,
      reason,
      sourceEventSeqs: [event.seq],
      state: "pending",
      createdAt: at,
      updatedAt: at,
    };
    registry = {
      ...registry,
      requests: { ...registry.requests, [request.id]: request },
      order: [...registry.order, request.id],
      perKey: { ...registry.perKey, [key]: n },
    };
    registry = appendHistory(registry, {
      at, kind: "request-created", tournamentId: event.tournamentId,
      eventSeq: event.seq, eventKind: event.kind, requestId: request.id, reason, state: "pending",
    });
    created.push(registry.requests[request.id]);
  }

  return {
    registry,
    result: { received: events.length, created: created.map((r) => registry.requests[r.id]), merged, waited, ignored },
  };
}
