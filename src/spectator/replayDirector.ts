/**
 * REPLAY DIRECTOR — el director de realización para REPLAY (Online Fase 5/7).
 *
 * Implementa la MISMA interfaz `Director` (reservada en types.ts para esta fase) y REUTILIZA el
 * `LiveDirector`; con la Timeline completa (`DirectorInput.history`) mantiene los planos más
 * tiempo y anticipa (cortes más cinematográficos). NO crea otro Director. PURO / read-only.
 */
import type { Director, DirectorInput, DirectorDecision, DebugEntry } from "./types";
import { createLiveDirector } from "./director";

export class ReplayDirector implements Director {
  private live: Director;
  constructor() { this.live = createLiveDirector(); }

  decide(input: DirectorInput): DirectorDecision {
    const d = this.live.decide(input);
    // Foresight: con historia conocida, planos más largos y menos picado (realización de replay).
    if (input.history && input.history.length > 0) {
      return { ...d, expectedHoldTicks: d.expectedHoldTicks + 24, reason: `[replay] ${d.reason}` };
    }
    return d;
  }
  reset(): void { this.live.reset(); }
  get debugLog(): ReadonlyArray<DebugEntry> { return this.live.debugLog; }
}

export function createReplayDirector(): Director { return new ReplayDirector(); }
