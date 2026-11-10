/**
 * CARD FILTERS + SEARCH (Collection Fase 1/7).
 *
 * Filtrado incremental y búsqueda textual sobre `CardView[]` (la proyección del engine). Todos los
 * criterios son AND; los arrays son OR internos. O(n) por pasada, sin estado. La búsqueda usa los
 * campos ya proyectados (nick/equipo/variante) ⇒ instantánea incluso con catálogos enormes.
 *
 * Fase 37 · la búsqueda ignora mayúsculas y diacríticos («Leviatán» = «leviatan»), se acota a 64 caracteres y
 * nunca construye expresiones regulares con lo que teclea el usuario. Nuevos criterios: OVR máximo, copias mínimas
 * (duplicadas), equipos y rarezas reales.
 */
import { bucketForRank } from "@/domain/packs/types";
import type { CardView, FilterSpec } from "./types";

export const SEARCH_MAX_LENGTH = 64;

/** Normaliza para buscar: sin diacríticos, minúsculas, espacios colapsados, longitud acotada. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .slice(0, SEARCH_MAX_LENGTH * 2)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);
}

/** Aplica un filtro a una lista de vistas. Determinista. */
export function applyFilter(views: CardView[], f: FilterSpec): CardView[] {
  const text = normalizeText(f.text);
  const tagSet = f.tags && f.tags.length ? new Set(f.tags) : null;
  const teamSet = f.teams && f.teams.length ? new Set(f.teams) : null;
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
    if (f.maxOvr != null && v.ovr > f.maxOvr) return false;
    if (f.minCount != null && v.count < f.minCount) return false;
    if (teamSet && !teamSet.has(v.team)) return false;
    if (f.rarities && f.rarities.length && !f.rarities.includes(bucketForRank(v.rank))) return false;
    if (tagSet && !v.tags.some((t) => tagSet.has(t))) return false;
    if (text && !matchesText(v, text)) return false;
    return true;
  });
}

function matchesText(v: CardView, text: string): boolean {
  return (
    normalizeText(v.nick).includes(text) ||
    normalizeText(v.team).includes(text) ||
    normalizeText(v.teamTag).includes(text) ||
    normalizeText(v.label).includes(text) ||
    v.cardId.includes(text)
  );
}

/** Búsqueda simple (solo texto). Azúcar sobre `applyFilter`. */
export function search(views: CardView[], query: string, includeHidden = false): CardView[] {
  return applyFilter(views, { text: query, includeHidden });
}
