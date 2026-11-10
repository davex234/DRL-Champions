/**
 * LIVE INTEL — API pública.
 *
 * La capa de INTELIGENCIA que faltaba sobre el DRL Data Engine existente: identidad
 * única (anti-duplicados multi-fuente), rating contextual, decisión de ciclo de vida
 * (crear/mejorar/mantener/especial), habilidades derivadas, noticias automáticas y
 * orquestación de fuentes con failover. Pura y determinista; el engine la consume.
 */
export { normalizeKey, registerAliases, resolveIdentity, sameEntity, aliasRegistry, type EntityKind } from "./identity";
export { contextualRating, rawPerformance, ratingToOvr, ratingFromCardStats, TOURNAMENT_WEIGHT, type PlayerPerf, type RatingContext, type Stage } from "./rating";
export { decideCard, rarityFor, type CardAction, type CardDecision, type PlayerHistory, type RarityTier } from "./decide";
export { deriveAbilities, abilityLabels, type Ability } from "./abilities";
export { buildCardNews, type NewsItem, type NewsKind, type CardNewsInput } from "./news";
export { failoverSource, type RankedSource, type FailoverSource, type SourceAttempt } from "./sources";
