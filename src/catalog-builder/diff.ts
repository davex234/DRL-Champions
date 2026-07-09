/**
 * DIFF BUILDER (Fase 6) — diferencias INCREMENTALES de esta build respecto al catálogo
 * anterior: added/updated/removed/moved/retired/changed. Determinista (listas ordenadas).
 */
import type { MaterializationResult } from "@/materializer";
import type { CardDef } from "@/domain/cards/types";
import type { CatalogDiff } from "./types";

export function buildDiff(mat: MaterializationResult, existingCards: CardDef[]): CatalogDiff {
  const existing = new Set(existingCards.map((c) => c.id));
  const patch = mat.catalogPatch;

  const added = patch.cardsAdd.map((c) => c.id).sort();
  const updated = patch.cardsUpdate.map((c) => c.id).sort();
  const removed = [...patch.cardsRemove].sort();
  const retired = mat.cards.filter((c) => c.status === "retired").map((c) => c.card.id).sort();

  // Moved: cartas PREEXISTENTES cuya pertenencia a pools/colecciones cambia en esta build.
  const membership = new Set<string>();
  for (const pool of mat.packPatch.pools) for (const e of pool.add) membership.add(e.cardId);
  for (const up of mat.collectionPatch.update) for (const i of up.addItems) membership.add(i.cardId);
  const moved = [...membership].filter((id) => existing.has(id)).sort();

  // Changed: solo metadatos (entradas de mercado de cartas preexistentes no añadidas/actualizadas).
  const structural = new Set([...added, ...updated, ...removed]);
  const changed = mat.marketPatch.entries.map((e) => e.cardId).filter((id) => existing.has(id) && !structural.has(id)).sort();

  return { added, updated, removed, moved, retired, changed };
}
