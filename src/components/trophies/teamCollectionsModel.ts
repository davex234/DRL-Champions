/**
 * COLECCIONES POR EQUIPO — modelo de la rejilla (puro). Filtro, búsqueda y orden sobre la vista del SERVIDOR: aquí no se
 * recalcula ningún progreso, solo se elige qué enseñar, en qué orden y cuántos (3 al entrar, 6 más por pulsación).
 */
import { sortTeams, type TeamTileView } from "@/domain/teamCollections/model";

export type TeamFilter = "ALL" | "IN_PROGRESS" | "COMPLETED" | "LOCKED";
export type TeamSort = "closest" | "alpha";

export const TEAM_FILTER_LABEL: Record<TeamFilter, string> = { ALL: "Todas", IN_PROGRESS: "En progreso", COMPLETED: "Completadas", LOCKED: "Sin empezar" };
export const TEAM_SORT_LABEL: Record<TeamSort, string> = { closest: "Más cerca", alpha: "A–Z" };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function visibleTeams(list: readonly TeamTileView[], o: { filter: TeamFilter; query: string; sort: TeamSort }): TeamTileView[] {
  const q = fold(o.query.trim());
  return sortTeams(
    list.filter((t) => (o.filter === "ALL" || t.state === o.filter)
      && (!q || fold(t.title).includes(q) || fold(t.tag).includes(q) || t.players.some((p) => fold(p).includes(q)))),
    o.sort,
  );
}

/** Acento de cada región (el texto y el icono dicen cuál es; el color solo acompaña). */
export const REGION_TINT: Record<string, string> = { Americas: "#ff8a4c", EMEA: "#b6f24a", Pacific: "#19e3ff", China: "#ff4d6d" };
