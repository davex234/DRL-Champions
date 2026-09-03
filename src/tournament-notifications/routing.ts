/**
 * ROUTING — decide el TIPO de notificación de una petición (por su motivo dominante y
 * acción) y sus CANALES (política declarativa por tipo). Cero interpretación de dominio.
 */
import type { HubRequest, NotificationKind, RoutingPolicy } from "./types";

export const DEFAULT_ROUTING: RoutingPolicy = {
  byKind: {
    "team-eliminated": ["telegram", "console"],
    "full-review": ["telegram", "console"],
    "error": ["telegram", "console", "discord"],
  },
  defaultChannels: ["telegram"],
  targetByChannel: { telegram: "operators", console: "stdout", discord: "ops-channel" },
  maxAttempts: 3,
};

/** Motivo dominante de la petición → tipo de notificación. */
export function kindOfRequest(request: HubRequest): NotificationKind {
  switch (request.reason) {
    case "TeamEliminated": return "team-eliminated";
    case "TournamentFinished": return "full-review";
    case "StatisticsChanged": return "stats-updated";
    case "TournamentCreated": return "new-tournament";
    default:
      return request.action === "generate-full-review" ? "full-review" : "new-review";
  }
}

export function channelsFor(kind: NotificationKind, policy: RoutingPolicy): string[] {
  return policy.byKind[kind] ?? policy.defaultChannels;
}
