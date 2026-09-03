/**
 * SHUTDOWN — apagado LIMPIO: drena el outbox pendiente del hub (a adaptadores), libera el
 * lock y sella el estado. Jamás pierde historial: los registries de los cuatro módulos
 * quedan íntegros y serializables para el siguiente arranque.
 */
import type { NotificationHub } from "@/tournament-notifications";
import { withStatus } from "./state";
import type { RuntimeClock, RuntimeLock, RuntimeState } from "./types";

export interface ShutdownResult {
  state: RuntimeState;
  drainedMessages: number;
  lockReleased: boolean;
}

export function gracefulShutdown(
  state: RuntimeState, hub: NotificationHub, lock: RuntimeLock, lockKey: string, owner: string, clock: RuntimeClock,
): ShutdownResult {
  let next = withStatus(state, "stopping", clock());
  const drained = hub.dispatch();
  const held = lock.ownerOf(lockKey) === owner;
  if (held) lock.release(lockKey, owner);
  next = withStatus(next, "stopped", clock());
  return { state: next, drainedMessages: drained.sent, lockReleased: held };
}
