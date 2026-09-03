/**
 * DUEL OPPONENT ENGINE — API pública (Fase 6).
 *
 * Permite que un bando lo controle una persona (acciones externas) y el otro un bot determinista.
 * Ambos atraviesan el MISMO orquestador y el MISMO resolver, así que Humano vs Humano,
 * Humano vs Bot y Bot vs Bot juegan con reglas idénticas.
 *
 *   DuelMatch → OpponentController → DuelOpponent → Turn Orchestrator → Combat Resolver
 */
export * from "./types";
export {
  createRng, normalizeSeed, isRngState, nextFloat, nextInt, pick,
  type RngState,
} from "./rng";
export {
  createRandomBot, createSmartBot, createDuelBot,
  DIFFICULTY_PROFILE, NORMAL_HEURISTIC_RATE, HARD_HEURISTIC_RATE,
} from "./bots";
export {
  createController, isBotTurn, actingSide, advanceBotDecision, advanceBots,
  type OpponentController,
} from "./controller";
