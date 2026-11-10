/**
 * CRAFTING, EVOLUTION & UPGRADE ENGINE — API pública (Collection Fase 4/7).
 *
 * Motor determinista de EVOLUCIÓN de cartas ENCIMA del Collection Engine y el Pack Minter. Reutiliza
 * catálogo/variantes/ownership/quality/pricing/CardOrigin; el único recurso nuevo son los materiales
 * (polvo por rareza). Mantiene la IDENTIDAD (jugador): la salida es siempre una carta que YA EXISTE.
 * NO abre marketplace, battle pass ni presentation.
 *
 *   Collection → Craft Engine → Collection → Deck → Gameplay → Career → Marketplace
 */
export * from "./types";
export { CraftEngine } from "./engine";
export { validateRecipe } from "./recipes";
export { resolveInputs, resolveOutput, type InputResolution, type OutputResolution } from "./resolve";
export { craftEvents } from "./events";
export {
  freshMaterials, migrateMaterials, addMaterials, subMaterials, hasMaterials, totalMaterials,
  salvageYield, dustForRank, BUCKETS,
} from "./materials";
