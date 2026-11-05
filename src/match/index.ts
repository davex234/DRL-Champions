/**
 * MATCH ENGINE — API pública.
 *
 * La unidad principal del juego pasa de ser la RONDA a ser el PARTIDO. Este módulo
 * controla el flujo del partido (máquina de estados) sobre la simulación de ronda
 * existente. La UI/headless solo debe importar desde aquí.
 */
export { createMatch, stepMatch, simulateMatch, runRoundToEnd, type RoundRunner } from "./engine";
export {
  makeMatchConfig, matchWinner, matchPointTeams, shouldSwitchSide, regulationMaxRounds,
  DEFAULT_WIN, DEFAULT_SWITCH_AFTER, DEFAULT_OVERTIME, type MatchConfigInput,
} from "./config";
export { matchBroadcastContext } from "./broadcast";
export type {
  MatchPhase, MatchState, MatchConfig, MatchScore, MatchEvent, MatchEventType,
  RoundHistoryEntry, RoundMvp, RoundEconomyPlaceholder, TeamSlot,
  WinRules, OvertimeRules, MatchBroadcastContext,
} from "./types";
