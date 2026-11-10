/**
 * COMBAT RESOLVER — API pública (Fase 4).
 *
 * Motor matemático puro del combate de Duelos. Consume dos `DuelDeckSnapshot` congelados y un
 * `CombatPlan`, y devuelve un `CombatResult` determinista, auditable y versionado.
 *
 * NO elige los enfrentamientos: el PDF no define esa regla. La orquestación de turnos es una fase
 * posterior que producirá el plan (ver OPD-01/02/03 en el informe de Fase 4).
 */
export * from "./types";
export {
  COMBAT_RULES_V1, COMBAT_RULES_V2, COMBAT_RULESETS, CURRENT_COMBAT_RULES, getCombatRuleset,
  type CombatRuleset, type EncounterTiePolicy, type FinalTiebreakPolicy, type TerminalPolicy,
} from "./rules";
export {
  resolveCombat, resolveEncounter, sumOvr, statTotals, validateSnapshotsForCombat,
  explainCombatError, explainCombatResult, explainCombatReason, auditCombatResult,
} from "./resolver";
