/**
 * DUELOS — API pública del dominio (Fase 3).
 *
 * Capa PURA del juego de cartas del PDF: mazo de 10, composición 2 por rol, validación explicable,
 * selección de cartas y snapshot congelado.
 *
 *   CardRegistry + OwnershipSource → makeDeckResolver → validateDuelDeck → takeDeckSnapshot
 *
 * NO confundir con `@/deck` (quinteto de titulares del simulador táctico) ni con `@/match`
 * (partido de VALORANT 5v5). Aquí nada depende de `@/store`, `@/app` ni Supabase.
 *
 * El resolutor de combate NO vive aquí todavía: esta fase solo deja el snapshot listo.
 */
export * from "./types";
export {
  createDuelDeck, addCard, removeCard, replaceCard,
  validateDuelDeck, duelDeckStatus,
  getEligibleCardsForSlot, rolesNeeded,
  takeDeckSnapshot, deckChecksum,
  ALLOW_SAME_PLAYER_TWICE,
  type CreateDeckInput, type EligibilityContext,
} from "./deck";
export {
  makeDeckResolver, resolveAvailableCards, ownershipFromList,
  type OwnershipSource,
} from "./resolve";
export { explainDeckError, explainDeckValidation, explainAll, ROLE_LABEL } from "./explain";
