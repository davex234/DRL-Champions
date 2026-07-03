/**
 * CARD HISTORY + CARD ORIGIN (Collection Fase 1/7).
 *
 * Historial de obtención derivado de `OwnedCard.obtainedAt` + el origen (de la meta). NO añade campos
 * a `OwnedCard`: el origen vive en `CollectionMeta.origins`. Puro y determinista (orden estable).
 */
import type { OwnershipIndex } from "./ownership";
import { originOf } from "./meta";
import type { CollectionMeta, CardOrigin } from "./types";

export interface HistoryEntry { uid: string; cardId: string; at: number; serial: number | null; origin: CardOrigin }

/** Línea de tiempo de adquisiciones (más reciente primero; desempate por uid ⇒ estable). */
export function history(own: OwnershipIndex, meta: CollectionMeta): HistoryEntry[] {
  return own.all()
    .map((o) => ({ uid: o.uid, cardId: o.cardId, at: o.obtainedAt, serial: o.serial ?? null, origin: originOf(meta, o.uid) }))
    .sort((a, b) => (b.at - a.at) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

/** Historial de una carta concreta (todas sus instancias). */
export function cardHistory(own: OwnershipIndex, meta: CollectionMeta, cardId: string): HistoryEntry[] {
  return own.instancesOf(cardId)
    .map((o) => ({ uid: o.uid, cardId: o.cardId, at: o.obtainedAt, serial: o.serial ?? null, origin: originOf(meta, o.uid) }))
    .sort((a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity));
}

/** Recuento de instancias por origen (analytics de procedencia). */
export function byOrigin(own: OwnershipIndex, meta: CollectionMeta): Record<CardOrigin, number> {
  const out = {} as Record<CardOrigin, number>;
  for (const o of own.all()) { const org = originOf(meta, o.uid); out[org] = (out[org] ?? 0) + 1; }
  return out;
}
