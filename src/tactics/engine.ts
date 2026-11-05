/**
 * TACTICAL INTELLIGENCE ENGINE — Superficie de integración.
 *
 * `initRuntime` construye el estado táctico de la ronda (planes de ambos equipos) a
 * partir de las semillas (economía + modelo de rival + orden de concepto). El resto
 * del aprendizaje (economía y modelo) se hace entre rondas con `learnRound`/
 * `nextEconomy`, que arrastra el llamador (la partida).
 */
import type { Rng } from "../sim/rng";
import type { RoundState } from "../sim";
import type { TacticalSetup, TeamSeed } from "./types";
import { emptyModel } from "./types";
import { buildAttackState, buildDefenseState } from "./planner";
import { pistolEconomy } from "./economy";

/** Construye `s.tactical` (muta el RoundState recién creado). Cada lado es opcional. */
export function initRuntime(s: RoundState, setup: TacticalSetup, rng: Rng): void {
  s.tactical = {
    ATK: setup.ATK ? buildAttackState(s, "ATK", setup.ATK, rng) : undefined,
    DEF: setup.DEF ? buildDefenseState(s, "DEF", setup.DEF, rng) : undefined,
  };
}

/** Semilla por defecto (pistola, sin lecturas, sin orden). */
export function defaultSeed(): TeamSeed {
  return { economy: pistolEconomy(), model: emptyModel(), order: null };
}

export { stepTactics, commitTick } from "./runner";
export { learnRound } from "./opponent";
export { nextEconomy, pistolEconomy, applyBuy, buyOf } from "./economy";
export {
  predictedAttackLane, patternStrength, leastDefendedLane, worstAttackLane,
} from "./opponent";
