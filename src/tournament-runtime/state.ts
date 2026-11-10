/**
 * STATE — estado puro del runtime y sus transiciones (idle → running ⇄ sleeping →
 * stopping → stopped · lock-denied). Inmutable; el reloj llega inyectado.
 */
import type { RuntimeState, RuntimeStatus, StageLatencies } from "./types";

export const zeroLatencies = (): StageLatencies =>
  ({ schedulerMs: 0, watchMs: 0, pipelineMs: 0, notificationsMs: 0 });

export function createRuntimeState(): RuntimeState {
  return {
    status: "idle", startedAt: null, stoppedAt: null, iterations: 0,
    lastIterationAt: null, lastError: null, latencies: zeroLatencies(),
  };
}

export function withStatus(s: RuntimeState, status: RuntimeStatus, at: number): RuntimeState {
  return {
    ...s,
    status,
    startedAt: status === "running" && s.startedAt === null ? at : s.startedAt,
    stoppedAt: status === "stopped" || status === "lock-denied" ? at : s.stoppedAt,
  };
}

export function withIteration(s: RuntimeState, at: number, latencies: StageLatencies): RuntimeState {
  return { ...s, iterations: s.iterations + 1, lastIterationAt: at, latencies, lastError: null };
}

export function withError(s: RuntimeState, error: string): RuntimeState {
  return { ...s, lastError: error };
}
