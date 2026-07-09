/**
 * COLLECTIONS (Fase 6) — aplica el CollectionPatch (F5) sobre las colecciones existentes:
 * SOLO patches, jamás recalcula todo. Álbum (orden determinista por colección), museo
 * (escaparate de variantes serializadas) y series. La completion real depende de propiedad
 * (runtime del Collection Engine): aquí solo totales de definición.
 */
import { getVariant } from "@/domain/cards/variants";
import type { CollectionDef } from "@/domain/collections/types";
import type { MaterializationResult } from "@/materializer";
import type { CollectionsArtifact } from "./types";
import type { AppliedCatalog } from "./catalog";

export function buildCollections(mat: MaterializationResult, existing: CollectionDef[], applied: AppliedCatalog): CollectionsArtifact {
  const byId = new Map(existing.map((c) => [c.id, c]));

  // Patch: colecciones nuevas + items añadidos a existentes (incremental).
  for (const col of mat.collectionPatch.add) byId.set(col.id, col);
  for (const up of mat.collectionPatch.update) {
    const prior = byId.get(up.collectionId);
    if (!prior) continue;
    const known = new Set(prior.items.map((i) => i.cardId));
    byId.set(up.collectionId, { ...prior, items: [...prior.items, ...up.addItems.filter((i) => !known.has(i.cardId))] });
  }

  const collections = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const completion = collections.map((c) => ({ collectionId: c.id, total: c.items.length }));
  const album = collections.map((c) => ({
    collectionId: c.id,
    cardIds: [...c.items].map((i) => i.cardId).sort(),
  }));

  // Museo: cartas serializadas del catálogo aplicado (escaparate determinista).
  const museum = applied.artifact.cards
    .filter((c) => getVariant(c.variantId).serialized)
    .map((c) => c.id)
    .sort();

  // Series afectadas por esta materialización.
  const series: Record<string, string[]> = {};
  for (const m of mat.cards) (series[m.series] ??= []).push(m.card.id);
  for (const k of Object.keys(series)) series[k].sort();

  return { collections, completion, album, museum, series };
}
