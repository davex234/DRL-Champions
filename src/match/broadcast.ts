/**
 * MATCH → BROADCAST — alimenta al Broadcast Engine con datos REALES del partido
 * (marcador y número de ronda) SIN tocar su cerebro. El Broadcast acepta este
 * contexto opcional; si no se pasa, sigue mostrando una ronda suelta.
 */
import type { MatchState, MatchBroadcastContext } from "./types";

/** Marcador por LADO (lo que muestra el scoreboard) + ronda actual del partido. */
export function matchBroadcastContext(m: MatchState): MatchBroadcastContext {
  const atk = m.currentHomeSide === "ATK" ? m.score.home : m.score.away;
  const def = m.currentHomeSide === "ATK" ? m.score.away : m.score.home;
  return { round: Math.max(1, m.roundNumber), score: { atk, def } };
}
