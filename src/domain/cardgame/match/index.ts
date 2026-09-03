/**
 * DUEL MATCH — API pública del orquestador de turnos (Fase 5).
 *
 * Convierte dos `DuelDeckSnapshot` en una partida jugable de 10 turnos y delega el resultado en el
 * Combat Resolver, que sigue siendo la única autoridad matemática.
 *
 *   startDuelMatch → (selectAttackerCard → selectAttackerStat →
 *                     selectDefenderCard → selectDefenderStat → confirmTurn) × 10
 *                  → CombatPlan → resolveCombat → DuelMatchResult
 */
export * from "./types";
export {
  startDuelMatch, selectAttackerCard, selectAttackerStat,
  selectDefenderCard, selectDefenderStat, confirmTurn,
  buildCombatPlan, availableCards, requiredDefenderStat,
  matchView, explainMatchError, explainTurn,
  type StartMatchInput,
} from "./orchestrator";
