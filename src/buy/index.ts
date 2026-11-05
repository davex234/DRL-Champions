/**
 * BUY PHASE & INVENTORY ENGINE — API pública.
 *
 * Transforma la decisión económica + RoundPlan + CoachDecision + ADN en un Loadout
 * por jugador. La economía sigue siendo la única autoridad del dinero (la Buy Phase
 * calcula el gasto y la economía lo aplica). La simulación recibe el Loadout y lo porta.
 */
export { CATALOG, getItem, itemsByCategory, primariesOfClasses, sidearms } from "./catalog";
export {
  buildLoadout, buildTeamLoadout, spentByName, priorityFromConcept, priorityFromTier,
} from "./ai";
export { playerBuyTemperament, type BuyTemperament } from "./identity";
export { detectBuyEvents, type BuyNarrativeRound } from "./narrative";
export {
  loadoutBroadcastContext, type LoadoutBroadcastContext, type LoadoutBroadcastSide,
} from "./broadcast";
export type {
  CatalogItem, ItemCategory, WeaponClass, Loadout, LoadoutState, TeamLoadout, MatchLoadouts,
  BuyPriority, BuyInput, BuyEvent, BuyEventType, TeamLoadoutSummary,
} from "./types";
