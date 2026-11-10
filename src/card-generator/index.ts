/**
 * CARD GENERATOR — API pública (Card Generator Fase 4/7).
 *
 * El ÚNICO motor que decide qué cartas existen: `generateCards(analysis, ctx)` →
 * `CardGenerationResult` (decisiones editoriales + CardSpecs). NO materializa: no escribe en
 * Collection, no toca el catálogo, no acuña seriales, no abre sobres, no toca Marketplace.
 * Puro, serializable, determinista. Supersede editorialmente a los pipelines LEGACY
 * (src/engine/cardGenerator · lib/tournaments/engine · live/orchestrator) sin eliminarlos.
 */
export * from "./types";
export { generateCards, makeGenerationId } from "./engine";
export { resolvePlayers } from "./identity";
export { DEFAULT_RULESET } from "./ruleset";
export { evaluateRules } from "./rules";
export { applyGrantOverrides, decideLifecycle, confidenceOf, releaseStateOf } from "./editorial";
export { predictCatalog, newVariantsFor, buildSpecCore, kindForFamily, seriesOf } from "./specs";
export { simRegistry, buildEligibility } from "./eligibility";
export { resolveArtwork } from "./artwork";
export { buildCollection } from "./collection";
