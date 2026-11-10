/**
 * STATE — estado de observación DERIVADO de un torneo vigilado (nunca almacenado aparte):
 * tracking · finished · removed. Solo lectura sobre el registry.
 */
import type { WatchedTournament } from "./types";

export type WatchStatus = "tracking" | "finished" | "removed";

export function watchStatusOf(t: WatchedTournament): WatchStatus {
  if (t.removed) return "removed";
  if (t.snapshot.tournament.status === "finished") return "finished";
  return "tracking";
}
