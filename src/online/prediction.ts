/**
 * PREDICTION HOOKS — predicción cliente + reconciliación (Online Fase 1/7, preparado).
 *
 * El cliente aplica su comando de forma OPTIMISTA sobre su ronda local y, cuando llega el estado
 * autoritativo, RECONCILIA (rollback + reaplicar pendientes). Reutiliza `applyRoundCommands` (una
 * sola vía de aplicación). Determinista. Base para la suavización de red en fases futuras.
 */
import type { RoundState } from "@/sim";
import type { TimedCommand } from "./types";
import { applyRoundCommands } from "./replication";

export interface Prediction { pending: TimedCommand[] }
export function newPrediction(): Prediction { return { pending: [] }; }

/** Aplica un comando localmente de forma optimista (a la espera de confirmación). */
export function predict(pred: Prediction, round: RoundState, cmd: TimedCommand): { pred: Prediction; round: RoundState } {
  const stamped = { ...cmd, tick: round.tick };
  return { pred: { pending: [...pred.pending, stamped] }, round: applyRoundCommands(round, [stamped]) };
}

/** Descarta los comandos ya confirmados por el servidor (por tick). */
export function confirmUpTo(pred: Prediction, tick: number): Prediction {
  return { pending: pred.pending.filter((c) => c.tick > tick) };
}

/** Reconcilia: parte del estado AUTORITATIVO y reaplica los pendientes no confirmados. */
export function reconcile(pred: Prediction, authoritative: RoundState): { round: RoundState; pred: Prediction } {
  let r = authoritative;
  for (const c of pred.pending) r = applyRoundCommands(r, [{ ...c, tick: r.tick }]);
  return { round: r, pred };
}
