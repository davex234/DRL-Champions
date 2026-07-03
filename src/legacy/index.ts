/**
 * CLUB LEGACY & GLOBAL ECOSYSTEM ENGINE — API pública (Career Fase 6/7).
 *
 * El club pasa a formar parte de un ECOSISTEMA MUNDIAL que cambia cada temporada: legado,
 * Hall of Fame, rivalidades dinámicas, economía mundial, medios, redes sociales, competiciones,
 * marca y directivas. Todo EMERGE del `WorldState` ya persistido — capa de DERIVACIÓN + efectos
 * emergentes. Reutiliza Living World + Development + News (buzón único). Determinista. Cero
 * motores nuevos de World/Timeline/News/Finance/Career.
 */
export * from "./types";
export { clubLegacy } from "./clubLegacy";
export { hallOfFame } from "./hallOfFame";
export { brandOf } from "./brand";
export { clubDirectives } from "./directives";
export { detectRivalries, rivalriesOf, applyRivalryEffects } from "./rivalries";
export { globalEconomy, applyEconomy } from "./economy";
export { mediaDigest } from "./media";
export { socialTrends, applySocial, playerHype } from "./social";
export { deriveCompetitions, runCompetitions } from "./competitions";
export { runGlobalEcosystem, legacyNews } from "./ecosystem";
export { legacyDashboard } from "./dashboard";
