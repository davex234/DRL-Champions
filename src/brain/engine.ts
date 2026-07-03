/**
 * BRAIN ENGINE — orquestador por tick.
 *
 * Dos pasadas deterministas: (A) cada jugador recibe las comms que han llegado y
 * PERCIBE (actualiza memoria + emite comms); (B) cada jugador DECIDE y ACTÚA. Corre
 * DESPUÉS del director (lee el plan como input) y ANTES de actPlayer (que se salta a
 * los jugadores con cerebro: ya han actuado aquí). No toca otros motores: los consume.
 */
import type { Rng } from "../sim/rng";
import type { RoundState } from "../sim/types";
import { createMemory, pruneMemory, memoryTau } from "./memory";
import { perceive } from "./perceive";
import { deliverComms, expireComms } from "./comms";
import { decide } from "./decide";
import { applyDecision } from "./apply";
import type { BrainState } from "./types";

export function createBrain(): BrainState {
  return { memory: createMemory(), lastAction: null, lastScore: 0, changedTick: -1, trace: null };
}

export function tickBrains(s: RoundState, rng: Rng): void {
  if (s.brainEnabled === false) return;

  // Pasada A: recibir info que ha llegado + percibir (memoria + emitir comms).
  for (const p of s.players) {
    if (!p.alive || !p.brain) continue;
    deliverComms(s, p);
    perceive(s, p);
    pruneMemory(p.brain.memory, s.tick, memoryTau(p.identity));
  }

  // Pasada B: decidir y actuar (reutiliza behaviors vía applyDecision).
  for (const p of s.players) {
    if (!p.alive || !p.brain) continue;
    p.movedThisTick = false;
    const d = decide(s, p, rng);
    applyDecision(s, p, d);
  }

  expireComms(s);
}
