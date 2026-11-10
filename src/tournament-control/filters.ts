/**
 * FILTERS — filtrado y orden de las filas del dashboard. Puros y estables: siempre devuelven
 * copias nuevas; una clave de orden desconocida deja el orden del panel intacto.
 */
import { RECORD_STATUSES, type DashboardFilter, type DashboardRow, type DashboardSortKey } from "./types";

export function applyDashboardFilter(rows: DashboardRow[], f: DashboardFilter): DashboardRow[] {
  const t = f.tournament?.trim().toLowerCase();
  return rows.filter((r) =>
    (f.status === undefined || r.status === f.status) &&
    (f.season === undefined || r.season === f.season) &&
    (f.source === undefined || r.source === f.source) &&
    (!f.liveOnly || r.live) &&
    (!t || r.tournamentId.toLowerCase() === t || r.tournamentName.toLowerCase().includes(t)));
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const COMPARATORS: Record<DashboardSortKey, (a: DashboardRow, b: DashboardRow) => number> = {
  date: (a, b) => a.date - b.date,
  tournament: (a, b) => cmpStr(a.tournamentName, b.tournamentName) || cmpStr(a.recordId, b.recordId),
  cards: (a, b) => a.cards - b.cards,
  approved: (a, b) => a.approved - b.approved,
  published: (a, b) => a.published - b.published,
  status: (a, b) => RECORD_STATUSES.indexOf(a.status) - RECORD_STATUSES.indexOf(b.status),
};

export function sortDashboardRows(
  rows: DashboardRow[], key: DashboardSortKey, dir: "asc" | "desc" = "asc",
): DashboardRow[] {
  const cmp = COMPARATORS[key];
  const out = [...rows].sort((a, b) => cmp(a, b) || cmpStr(a.recordId, b.recordId));
  return dir === "desc" ? out.reverse() : out;
}
