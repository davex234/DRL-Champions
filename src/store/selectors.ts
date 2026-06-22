import type { OwnedCard } from "@/domain/cards/types";
import { CARDS, getCard, getPlayer, TOTAL_CARDS } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";

export interface CollectionEntry {
  cardId: string;
  count: number;
  /** Instancias poseídas (para nº de serie y venta). */
  instances: OwnedCard[];
}

/** Agrupa las cartas poseídas por definición de carta. */
export function groupCollection(owned: OwnedCard[]): Map<string, CollectionEntry> {
  const map = new Map<string, CollectionEntry>();
  for (const o of owned) {
    const entry = map.get(o.cardId);
    if (entry) {
      entry.count++;
      entry.instances.push(o);
    } else {
      map.set(o.cardId, { cardId: o.cardId, count: 1, instances: [o] });
    }
  }
  // Ordena las instancias por nº de serie (menor primero, más valioso).
  for (const entry of map.values()) {
    entry.instances.sort((a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity));
  }
  return map;
}

export interface CollectionStats {
  distinct: number;
  total: number;
  percent: number;
}

export function collectionStats(owned: OwnedCard[]): CollectionStats {
  const distinct = new Set(owned.map((o) => o.cardId)).size;
  return {
    distinct,
    total: TOTAL_CARDS,
    percent: TOTAL_CARDS > 0 ? Math.round((distinct / TOTAL_CARDS) * 100) : 0,
  };
}

/** Devuelve las cartas duplicadas (instancias más allá de la primera copia). */
export function duplicates(owned: OwnedCard[]): OwnedCard[] {
  const seen = new Set<string>();
  const dups: OwnedCard[] = [];
  // Conserva la mejor (serie más baja) como "principal"; el resto son dups.
  const grouped = groupCollection(owned);
  for (const entry of grouped.values()) {
    entry.instances.forEach((inst, i) => {
      if (i === 0) {
        seen.add(inst.uid);
      } else {
        dups.push(inst);
      }
    });
  }
  return dups;
}

/** OVR medio de la plantilla (mejor instancia de cada carta distinta). */
export function squadRating(owned: OwnedCard[]): number {
  const grouped = groupCollection(owned);
  if (grouped.size === 0) return 0;
  let sum = 0;
  for (const entry of grouped.values()) {
    const def = getCard(entry.cardId);
    if (def) sum += def.ovr;
  }
  return Math.round(sum / grouped.size);
}

/** Cuenta total de cartas distintas que existen en cada región (para progreso). */
export function regionTotals(): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const card of CARDS) {
    const region = getPlayer(card.playerId)?.region;
    if (region) totals[region] = (totals[region] ?? 0) + 1;
  }
  return totals;
}

export { CARDS, getCard, getPlayer, getVariant };
