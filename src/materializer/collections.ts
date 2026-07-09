/**
 * COLLECTION PATCH (Fase 5) — incremental sobre las colecciones EXISTENTES inyectadas: si la
 * colección del torneo (CollectionDef de F4, forma domain/collections) no existe → add; si
 * existe → solo los items nuevos. Nunca toca el Collection Engine ni stores. Determinista.
 */
import type { CardGenerationResult } from "@/card-generator";
import type { MaterializedCard, CollectionPatch } from "./types";

export function buildCollectionPatch(
  gen: CardGenerationResult,
  cards: MaterializedCard[],
  existing: { id: string; itemIds: string[] }[],
): CollectionPatch {
  const changedIds = new Set(cards.map((c) => c.card.id));
  const col = gen.collection;
  const relevantItems = col.items.filter((i) => changedIds.has(i.cardId));
  const prior = existing.find((e) => e.id === col.id);
  const series = [...new Set(cards.map((c) => c.series))].sort();

  if (!relevantItems.length) return { add: [], update: [], season: gen.season, series };
  if (!prior) {
    return { add: [{ ...col, items: relevantItems }], update: [], season: gen.season, series };
  }
  const known = new Set(prior.itemIds);
  const addItems = relevantItems.filter((i) => !known.has(i.cardId));
  return {
    add: [],
    update: addItems.length ? [{ collectionId: col.id, addItems }] : [],
    season: gen.season,
    series,
  };
}
