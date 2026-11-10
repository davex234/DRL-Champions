/**
 * HEALTH — proyección de salud del runtime: uptime, última iteración, último error,
 * latencias por etapa (watch/scheduler/notifications), estado y posesión del lock.
 * Solo lectura; jamás modifica módulos.
 */
import type { RuntimeClock, RuntimeHealth, RuntimeLock, RuntimeState } from "./types";

export function healthOf(
  state: RuntimeState, lock: RuntimeLock, lockKey: string, owner: string, clock: RuntimeClock,
): RuntimeHealth {
  return {
    status: state.status,
    uptimeMs: state.startedAt === null ? 0 : Math.max(0, (state.stoppedAt ?? clock()) - state.startedAt),
    iterations: state.iterations,
    lastIterationAt: state.lastIterationAt,
    lastError: state.lastError,
    latencies: state.latencies,
    lockHeld: lock.ownerOf(lockKey) === owner,
  };
}
