/**
 * COLLECTION EVENTS + BROADCAST (Collection Fase 1/7).
 *
 * Observa dos instantáneas de propiedad (prev→next) y emite eventos (adquirida/nueva/duplicada/set
 * completado/serie completada/hito) SIN mutar ni duplicar la propiedad. El Broadcast prepara los
 * titulares para la UI. Puro y determinista (reloj lógico inyectado, orden estable).
 */
import { CardRegistry } from "./registry";
import { OwnershipIndex } from "./ownership";
import { allSetProgress, completion } from "./album";
import type { OwnedCard, CollectionEvent, BroadcastView } from "./types";

const MILESTONES = [25, 50, 75, 100];

/** Diferencia prev→next y produce los eventos de colección. `now` = reloj lógico. */
export function reconcile(registry: CardRegistry, prev: OwnedCard[], next: OwnedCard[], now: number): CollectionEvent[] {
  const events: CollectionEvent[] = [];
  const prevOwn = new OwnershipIndex(prev);
  const prevUids = new Set(prev.map((o) => o.uid));
  const prevDistinct = new Set(prevOwn.distinctOwned());

  // instancias nuevas (orden estable por uid)
  const added = next.filter((o) => !prevUids.has(o.uid)).sort((a, b) => (a.uid < b.uid ? -1 : 1));
  const seenNew = new Set<string>();
  for (const o of added) {
    events.push({ type: "acquired", at: now, uid: o.uid, cardId: o.cardId });
    const wasOwned = prevDistinct.has(o.cardId) || seenNew.has(o.cardId);
    if (!wasOwned) { events.push({ type: "new_card", at: now, uid: o.uid, cardId: o.cardId }); seenNew.add(o.cardId); }
    else events.push({ type: "duplicate", at: now, uid: o.uid, cardId: o.cardId });
  }

  // sets/series recién completados
  const before = new Map(allSetProgress(registry, prevOwn).map((s) => [s.id, s.complete]));
  const nextOwn = new OwnershipIndex(next);
  for (const s of allSetProgress(registry, nextOwn)) {
    if (s.complete && !before.get(s.id)) {
      events.push({ type: s.kind === "series" ? "series_completed" : "set_completed", at: now, data: { setId: s.id, label: s.label } });
    }
  }

  // hitos de completado global
  const pc = completion(registry, prevOwn), nc = completion(registry, nextOwn);
  for (const m of MILESTONES) if (pc < m && nc >= m) events.push({ type: "milestone", at: now, data: { percent: m } });

  return events;
}

/** Titulares para la UI (Collection Broadcast). `recent` = últimas cartas adquiridas. */
export function broadcast(registry: CardRegistry, own: OwnershipIndex, recentCardIds: string[] = []): BroadcastView {
  const sets = allSetProgress(registry, own).filter((s) => !s.complete && s.owned > 0);
  const nearing = sets.sort((a, b) => b.percent - a.percent || a.total - b.total)[0] ?? null;
  let featured: string | null = null, bestRank = -1;
  for (const cardId of own.distinctOwned()) {
    const def = registry.card(cardId); if (!def) continue;
    const rank = registry.variant(def.variantId).rank;
    if (rank > bestRank) { bestRank = rank; featured = cardId; }
  }
  return { completion: completion(registry, own), distinct: own.distinctCount(), total: registry.total, recent: recentCardIds.slice(0, 8), featured, nearingSet: nearing };
}
