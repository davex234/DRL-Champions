/**
 * DRL SPECTATOR — formato del modo Debug del Director.
 * Una línea legible por cada CAMBIO de foco (no por cada tick).
 */
import type { DebugEntry } from "./types";

/**
 * Ej.: "Tick 312 → seguir aspas | Primer duelo (aspas) | prioridad 91 | prevista 4.2s"
 */
export function formatSwitch(e: DebugEntry, tps: number): string {
  const subject = e.focusPlayerId ? `seguir ${e.name}` : "vista táctica";
  const secs = (e.holdTicks / tps).toFixed(1);
  return `Tick ${e.tick} → ${subject} | ${e.reason} | prioridad ${e.priority} | prevista ${secs}s`;
}
