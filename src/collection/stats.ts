/**
 * COLLECTION STATISTICS + ANALYTICS (Collection Fase 1/7).
 *
 * Estadística DERIVADA del registro + la propiedad. Reutiliza `collectionStats`/`duplicates`/
 * `squadRating` de `@/store/selectors` (no duplica). Puro y determinista. Sin economía (el "valor" es
 * un proxy = suma de OVR de las cartas distintas poseídas).
 */
import { duplicates, squadRating } from "@/store/selectors";
import type { CardRegistry } from "./registry";
import type { OwnershipIndex } from "./ownership";
import type { CollectionProgress, CollectionStatistics, CollectionAnalytics } from "./types";

export function progress(registry: CardRegistry, own: OwnershipIndex): CollectionProgress {
  const distinct = own.distinctCount();
  const total = registry.total;
  return { distinct, total, percent: total > 0 ? Math.round((distinct / total) * 100) : 0, owned: distinct, missing: Math.max(0, total - distinct) };
}

export function statistics(registry: CardRegistry, own: OwnershipIndex): CollectionStatistics {
  const prog = progress(registry, own);           // progreso CONSCIENTE del registro inyectado
  const byRarity: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  const byGroup: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  for (const cardId of own.distinctOwned()) {
    const def = registry.card(cardId); if (!def) continue;
    const v = registry.variant(def.variantId);
    const p = registry.player(def.playerId);
    byRarity[v.rank] = (byRarity[v.rank] ?? 0) + 1;
    // Por EDICIÓN (variantId): la taxonomía del producto es la de las 7 ediciones, no los grupos antiguos.
    byGroup[def.variantId] = (byGroup[def.variantId] ?? 0) + 1;
    if (p) { byRegion[p.region] = (byRegion[p.region] ?? 0) + 1; byRole[def.role ?? p.role] = (byRole[def.role ?? p.role] ?? 0) + 1; }
  }
  return {
    progress: prog,
    totalInstances: own.totalInstances(),
    duplicates: duplicates(own.all()).length,
    squadRating: squadRating(own.all()),
    byRarity, byRegion, byGroup, byRole,
  };
}

export function analytics(registry: CardRegistry, own: OwnershipIndex): CollectionAnalytics {
  let rarest: string | null = null, rarestRank = -1;
  let mostDup: string | null = null, mostDupCount = 1;
  let serializedOwned = 0, ovrSum = 0;
  for (const cardId of own.distinctOwned()) {
    const def = registry.card(cardId); if (!def) continue;
    const v = registry.variant(def.variantId);
    ovrSum += def.ovr;
    if (v.serialized) serializedOwned++;
    if (v.rank > rarestRank) { rarestRank = v.rank; rarest = cardId; }
    const c = own.countOf(cardId);
    if (c > mostDupCount) { mostDupCount = c; mostDup = cardId; }
  }
  const completionByGroup = ratioBy(registry, own, (def) => def.variantId); // por edición
  const completionByRegion = ratioBy(registry, own, (def) => registry.player(def.playerId)?.region ?? "?");
  return { rarestOwned: rarest, mostDuplicated: mostDup, completionByGroup, completionByRegion, serializedOwned, ovrSum };
}

/** % de completado por una clave (poseídas distintas / total del catálogo en esa clave). */
function ratioBy(registry: CardRegistry, own: OwnershipIndex, keyOf: (def: import("./types").CardDef) => string): Record<string, number> {
  const total: Record<string, number> = {}, owned: Record<string, number> = {};
  for (const c of registry.cards) { const k = keyOf(c); total[k] = (total[k] ?? 0) + 1; if (own.owns(c.id)) owned[k] = (owned[k] ?? 0) + 1; }
  const out: Record<string, number> = {};
  for (const k of Object.keys(total)) out[k] = total[k] > 0 ? Math.round(((owned[k] ?? 0) / total[k]) * 100) : 0;
  return out;
}
