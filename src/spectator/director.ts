/**
 * DRL SPECTATOR — LiveDirector.
 *
 * El cerebro de realización para el modo EN DIRECTO: decide qué observar usando
 * SOLO información presente (sin foresight). Tiene MEMORIA — persistencia,
 * histéresis, tiempo mínimo de seguimiento e interrupciones duras — para que los
 * cortes se sientan de un observer profesional, no de un debugger nervioso.
 *
 * No renderiza, no mueve la cámara y NUNCA modifica el estado del simulador.
 * Implementa la interfaz `Director`, igual que hará el futuro `ReplayDirector`
 * (modo espectador con Timeline completa y foresight).
 */
import type { RoundState } from "../sim";
import { detectCandidates } from "./priorities";
import { formatSwitch } from "./debug";
import {
  DEFAULT_CONFIG, TIER_RANK,
  type Director, type DirectorConfig, type DirectorDecision, type DirectorInput,
  type DebugEntry, type FocusCandidate, type SituationId,
} from "./types";

/** Duración prevista de seguimiento por situación (segundos). */
const HOLD_SECONDS: Record<SituationId, number> = {
  clutch: 5, defuse: 5, plant: 3.5, retake: 4,
  first_duel: 2.5, trade: 2.5, duel: 2.2, lurk: 3,
  rotation: 3, default: 3, lull: 3,
};

export class LiveDirector implements Director {
  private cfg: DirectorConfig;
  private current: DirectorDecision | null = null;
  private _debug: DebugEntry[] = [];

  constructor(cfg: Partial<DirectorConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  get debugLog(): ReadonlyArray<DebugEntry> {
    return this._debug;
  }

  reset(): void {
    this.current = null;
    this._debug = [];
  }

  decide(input: DirectorInput): DirectorDecision {
    const { state, tick, events } = input;
    const cands = detectCandidates(state, events);
    const best = this.pickBest(cands);

    if (!this.current) {
      this.current = this.adopt(best, state, tick);
      return this.snapshot();
    }

    const cur = this.current;
    const ticksFollowed = tick - cur.sinceTick;
    const focusGone = cur.focusPlayerId != null && !state.players.some((p) => p.id === cur.focusPlayerId && p.alive);
    const curCand = cands.find((c) => c.focusPlayerId === cur.focusPlayerId && c.situation === cur.situation)
      ?? cands.find((c) => c.focusPlayerId === cur.focusPlayerId);

    const sameFocus = best.focusPlayerId === cur.focusPlayerId;
    const newTierHigher = TIER_RANK[best.tier] > TIER_RANK[cur.tier];

    // Interrupción dura: el foco murió/desapareció, o surge algo de nivel superior
    // y más prioritario. Salta el tiempo mínimo de seguimiento.
    if (focusGone || (!sameFocus && newTierHigher && best.priority > cur.priority)) {
      this.current = this.adopt(best, state, tick);
      return this.snapshot();
    }

    // Refrescar la lectura del foco actual si sigue vigente (sube/baja prioridad,
    // puede ascender de situación —p. ej. duel → clutch— sin cambiar de jugador).
    if (curCand) {
      cur.priority = curCand.priority;
      cur.reason = curCand.reason;
      cur.camera = curCand.camera;
      cur.situation = curCand.situation;
      cur.tier = curCand.tier;
      cur.focusZone = curCand.focusZone;
    }

    // Tiempo mínimo de seguimiento: no se permiten cambios blandos todavía.
    if (ticksFollowed < this.cfg.minFollowTicks) return this.snapshot();

    // Cambio blando con histéresis + bonus de permanencia decreciente.
    const overMin = ticksFollowed - this.cfg.minFollowTicks;
    const sticky = this.cfg.stickyBonus * Math.max(0, 1 - overMin / this.cfg.stickyDecayTicks);
    const curPriorityNow = curCand ? curCand.priority : cur.priority * 0.6;
    if (!sameFocus && best.priority > curPriorityNow + this.cfg.switchMargin + sticky) {
      this.current = this.adopt(best, state, tick);
    }
    return this.snapshot();
  }

  // --- internos ---

  private pickBest(cands: FocusCandidate[]): FocusCandidate {
    let best = cands[0];
    for (const c of cands) {
      if (c.priority > best.priority) best = c;
      else if (c.priority === best.priority && this.current && c.focusPlayerId === this.current.focusPlayerId) best = c;
    }
    return best;
  }

  private adopt(c: FocusCandidate, state: RoundState, tick: number): DirectorDecision {
    const holdTicks = Math.round((HOLD_SECONDS[c.situation] ?? 3) * this.cfg.tps);
    const name = c.focusPlayerId ? state.players.find((p) => p.id === c.focusPlayerId)?.name ?? c.focusPlayerId : "—";
    const entry: DebugEntry = {
      tick, name, focusPlayerId: c.focusPlayerId, situation: c.situation,
      priority: c.priority, reason: c.reason, holdTicks,
    };
    this._debug.push(entry);
    if (this.cfg.debug && typeof console !== "undefined") console.log(formatSwitch(entry, this.cfg.tps));
    return {
      focusPlayerId: c.focusPlayerId, focusZone: c.focusZone, priority: c.priority,
      camera: c.camera, situation: c.situation, tier: c.tier, reason: c.reason,
      sinceTick: tick, expectedHoldTicks: holdTicks,
    };
  }

  private snapshot(): DirectorDecision {
    return { ...(this.current as DirectorDecision) };
  }
}

export function createLiveDirector(cfg: Partial<DirectorConfig> = {}): LiveDirector {
  return new LiveDirector(cfg);
}

/** Construye la entrada del Director desde un estado (azúcar para el llamador). */
export function liveInput(state: RoundState, history?: RoundState[]): DirectorInput {
  return { state, tick: state.tick, events: state.events, history };
}
