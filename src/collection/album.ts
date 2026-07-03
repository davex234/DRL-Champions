/**
 * ALBUM · BINDER · SETS/SERIES/SEASONS · MISSING · COMPLETION (Collection Fase 1/7).
 *
 * Vistas de progreso sobre el registro + la propiedad: el Álbum (catálogo completo con poseída/
 * faltante), el Binder (páginas de poseídas), y el progreso por cada SET/SERIE/TEMPORADA derivado del
 * registro. Puro y determinista. Reutiliza registry+ownership (sin duplicar).
 */
import type { CardRegistry } from "./registry";
import type { OwnershipIndex } from "./ownership";
import type { CardView, AlbumEntry, BinderPage, SetProgress } from "./types";

/** Álbum: una entrada por carta del catálogo, con si se posee y cuántas copias. */
export function album(registry: CardRegistry, own: OwnershipIndex): AlbumEntry[] {
  return registry.cards.map((c) => ({ cardId: c.id, owned: own.owns(c.id), count: own.countOf(c.id) }));
}

/** Cartas que FALTAN (del catálogo, no poseídas). */
export function missing(registry: CardRegistry, own: OwnershipIndex): string[] {
  return registry.cards.filter((c) => !own.owns(c.id)).map((c) => c.id);
}

/** Completion % global (cartas distintas poseídas / total del catálogo). */
export function completion(registry: CardRegistry, own: OwnershipIndex): number {
  return registry.total > 0 ? Math.round((own.distinctCount() / registry.total) * 100) : 0;
}

/** Progreso de un SET/SERIE/TEMPORADA concreto. */
export function setProgress(registry: CardRegistry, own: OwnershipIndex, setId: string): SetProgress | null {
  const s = registry.set(setId);
  if (!s) return null;
  const missingIds = s.cardIds.filter((id) => !own.owns(id));
  const owned = s.cardIds.length - missingIds.length;
  const total = s.cardIds.length;
  return { id: s.id, kind: s.kind, label: s.label, owned, total, percent: total > 0 ? Math.round((owned / total) * 100) : 0, complete: missingIds.length === 0, missing: missingIds };
}

/** Progreso de TODOS los sets/series/temporadas. */
export function allSetProgress(registry: CardRegistry, own: OwnershipIndex): SetProgress[] {
  return registry.allSets().map((s) => setProgress(registry, own, s.id)!).filter(Boolean);
}

/** Binder: pagina una lista de vistas (poseídas) en páginas de tamaño fijo. */
export function binder(views: CardView[], pageSize = 12): BinderPage[] {
  const pages: BinderPage[] = [];
  for (let i = 0; i < views.length; i += pageSize) pages.push({ index: pages.length, cards: views.slice(i, i + pageSize) });
  return pages;
}
