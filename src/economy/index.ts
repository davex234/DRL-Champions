/**
 * ECONOMY ENGINE — API pública.
 *
 * El "cerebro económico": estados y decisiones con significado táctico que alimentan
 * a Tactical, Narrative, Match, Broadcast e Identity. Puro y determinista. La UI o el
 * Match Engine solo deben importar desde aquí.
 */
export {
  createEconomy, planRound, commitBuy, settleRound, buyContexts, economyTotal, startSecondHalf,
} from "./engine";
export { decideBuy } from "./decide";
export { DEFAULT_RULES, TIER_RANK, lossBonus, makeRules } from "./rules";
export { teamMetrics, teamEconomyView, economicAdvantage, teamCredits } from "./metrics";
export { teamBuyBias } from "./identity";
export { detectEconomicEvents } from "./narrative";
export {
  toTacticalEconomy, buildTacticalSetup, economyPosture, type EconomyPosture,
} from "./tactical";
export {
  economyBroadcastContext, type EconomyBroadcastContext, type EconomyBroadcastSide,
} from "./broadcast";
export type {
  EconomyState, EconomyRules, TeamEconomyState, TeamMetrics, TeamEconomyView,
  BuyTier, BuyDecision, BuyContext, EconomyStatus,
  EconomyRoundRecord, EconomyTeamRound, EconomicEvent, EconomicEventType, RoundEconomyResult,
  TeamSlot,
} from "./types";
