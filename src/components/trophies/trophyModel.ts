/**
 * F82 · SALA DE TROFEOS — modelo de la rejilla (puro). Filtro, tipo, búsqueda y orden sobre la vista del SERVIDOR:
 * aquí no se recalcula ningún progreso, solo se elige qué enseñar y en qué orden.
 */
import type { SetView } from "@/domain/collectionSets/view";

export type TrophyFilter = "ALL" | "IN_PROGRESS" | "COMPLETED" | "LOCKED";
export type TrophyKind = "ALL" | "TEAM" | "EDITION";
export type TrophySort = "closest" | "recent" | "alpha";

export const FILTER_LABEL: Record<TrophyFilter, string> = { ALL: "Todas", IN_PROGRESS: "En progreso", COMPLETED: "Completadas", LOCKED: "Sin empezar" };
export const KIND_LABEL: Record<TrophyKind, string> = { ALL: "Todo", TEAM: "Equipos", EDITION: "Ediciones" };
export const SORT_LABEL: Record<TrophySort, string> = { closest: "Más cerca", recent: "Recientes", alpha: "A–Z" };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function matchesFilter(s: SetView, f: TrophyFilter): boolean {
  if (f === "ALL") return true;
  if (f === "COMPLETED") return s.state === "COMPLETED";
  if (f === "LOCKED") return s.state === "LOCKED";
  return s.state === "IN_PROGRESS" || s.state === "CLAIMABLE";
}

/**
 * Orden por defecto «más cerca»: lo que se puede reclamar primero, luego lo que menos falta (en jugadores, no en %:
 * «te falta 1» empuja más que «80 %»), luego el %; lo completado al final (ya es un trofeo, no un objetivo).
 */
export function sortSets(list: readonly SetView[], sort: TrophySort): SetView[] {
  const out = [...list];
  const rankState = (s: SetView) => (s.state === "CLAIMABLE" ? 0 : s.state === "IN_PROGRESS" ? 1 : s.state === "LOCKED" ? 2 : 3);
  if (sort === "alpha") return out.sort((a, b) => a.title.localeCompare(b.title, "es") || a.id.localeCompare(b.id));
  if (sort === "recent") {
    return out.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || rankState(a) - rankState(b) || b.pct - a.pct || a.title.localeCompare(b.title, "es"));
  }
  return out.sort((a, b) => rankState(a) - rankState(b) || a.missing - b.missing || b.pct - a.pct || a.title.localeCompare(b.title, "es"));
}

export function visibleSets(list: readonly SetView[], o: { filter: TrophyFilter; kind: TrophyKind; query: string; sort: TrophySort }): SetView[] {
  const q = fold(o.query.trim());
  return sortSets(
    list.filter((s) => matchesFilter(s, o.filter) && (o.kind === "ALL" || s.kind === o.kind)
      && (!q || fold(s.title).includes(q) || s.requirements.some((r) => fold(r.label).includes(q)))),
    o.sort,
  );
}

/** Texto de lo que falta, para la tarjeta y el lector de pantalla. */
export function remainingText(s: SetView): string {
  if (s.state === "COMPLETED") return "Completada";
  if (s.state === "CLAIMABLE") return "¡Lista para reclamar!";
  const unit = s.kind === "TEAM" ? (s.missing === 1 ? "jugador restante" : "jugadores restantes") : (s.missing === 1 ? "carta restante" : "cartas restantes");
  return `${s.missing} ${unit}`;
}
