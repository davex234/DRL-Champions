/**
 * COLLECTION CORE ENGINE — API pública (Collection Fase 1/7).
 *
 * Capa PURA y DETERMINISTA sobre lo existente (Card Registry `@/data/catalog` + variantes + propiedad
 * `OwnedCard[]` + selectores) que da: Collection/Inventory/Registry/Ownership/Identity/Instance/
 * Metadata/Variant/Quality/Favorite/Tags/Filters/Search/Progress/Statistics/Album/Binder/Sets/Series/
 * Seasons/History/Origin/Lock/Visibility/Sorting/Grouping/Comparison/Missing/Completion/Events/
 * Broadcast/Analytics. NO abre sobres, NO economía, NO crafting, NO marketplace. Sin duplicar nada.
 * Flujo: Card → Registry → Collection → Inventory → Deck(elegibles) → Gameplay.
 */
export * from "./types";
export { CardRegistry, parseCardId, makeCardId, type SearchRow } from "./registry";
export { OwnershipIndex, type OwnershipIssue, type OwnershipValidation } from "./ownership";
export { qualityOf, QUALITY_RANK } from "./quality";
export {
  toggleFavorite, isFavorite, setHidden, isHidden, setLocked, isLocked,
  addTag, removeTag, tagsOf, setOrigin, originOf, serializeMeta, deserializeMeta, migrateMeta,
} from "./meta";
export { applyFilter, search } from "./filter";
export { sortViews, groupViews } from "./sort";
export { album, binder, missing, completion, setProgress, allSetProgress } from "./album";
export { compareCards } from "./compare";
export { statistics, analytics, progress } from "./stats";
export { history, cardHistory, byOrigin, type HistoryEntry } from "./history";
export { reconcile, broadcast } from "./events";
export { CollectionEngine } from "./engine";
