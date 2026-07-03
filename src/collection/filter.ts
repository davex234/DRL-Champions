/**
 * CARD FILTERS + SEARCH (Collection Fase 1/7).
 *
 * Filtrado incremental y búsqueda textual sobre `CardView[]` (la proyección del engine). Todos los
 * criterios son AND; los arrays son OR internos. O(n) por pasada, sin estado. La búsqueda usa los
 * campos ya proyectados (nick/equipo/variante) ⇒ instantánea incluso con catálogos enormes.
 */
import type { CardView, FilterSpec } from "./types";

/** Aplica un filtro a una lista de vistas. Determinista. */
export function applyFilter(views: CardView[], f: FilterSpec): CardView[] {
  const text = f.text?.trim().toLowerCase();
  const tagSet = f.tags && f.tags.length ? new Set(f.tags) : null;
  return views.filter((v) => {
    if (!f.includeHidden && v.hidden) return false;
    if (f.owned === true && !v.owned) return false;
    if (f.owned === false && v.owned) return false;
    if (f.favorite === true && !v.favorite) return false;
    if (f.serialized != null && v.serialized !== f.serialized) return false;
    if (f.regions && !f.regions.includes(v.region)) return false;
    if (f.roles && !f.roles.includes(v.role)) return false;
    if (f.groups && !f.groups.includes(v.group)) return false;
    if (f.variants && !f.variants.includes(v.variantId)) return false;
    if (f.minRank != null && v.rank < f.minRank) return false;
    if (f.maxRank != null && v.rank > f.maxRank) return false;
    if (f.minOvr != null && v.ovr < f.minOvr) return false;
    if (tagSet && !v.tags.some((t) => tagSet.has(t))) return false;
    if (text && !matchesText(v, text)) return false;
    return true;
  });
}

function matchesText(v: CardView, text: string): boolean {
  return (
    v.nick.toLowerCase().includes(text) ||
    v.team.toLowerCase().includes(text) ||
    v.teamTag.toLowerCase().includes(text) ||
    v.label.toLowerCase().includes(text)
  );
}

/** Búsqueda simple (solo texto). Azúcar sobre `applyFilter`. */
export function search(views: CardView[], query: string, includeHidden = false): CardView[] {
  return applyFilter(views, { text: query, includeHidden });
}
