/**
 * BRAIN ENGINE — API pública.
 *
 * El cerebro del jugador por EVALUACIÓN CONTINUA: memoria imperfecta, hipótesis,
 * opciones puntuadas con todos los motores, duda/cambio de idea y comunicación. Lo
 * usa el sim (un paso `tickBrains` tras el director) y la UI (Brain Debug). Determinista.
 */
export { createBrain, tickBrains } from "./engine";
export { brainView, type BrainView } from "./debug";
export type {
  BrainState, BrainMemory, BrainTrace, Decision, Option, OptionKind, ScoredOption,
  Hypothesis, CommMessage,
} from "./types";
