/**
 * LEAGUE / DIVISION ENGINE — ligas y divisiones configurables (Online Fase 3/7).
 *
 * Iron→Champion, cada una con divisiones y umbrales de MMR. Las apex (Master+) no tienen
 * divisiones: se ordenan por MMR/leaderboard. PURO. Determinista.
 */
import type { LeagueId, LeagueDef } from "./types";

export const LEAGUES: LeagueId[] = ["iron", "bronze", "silver", "gold", "platinum", "diamond", "master", "grandmaster", "champion"];

export const LEAGUE_LABEL: Record<LeagueId, string> = {
  iron: "Hierro", bronze: "Bronce", silver: "Plata", gold: "Oro", platinum: "Platino",
  diamond: "Diamante", master: "Maestro", grandmaster: "Gran Maestro", champion: "Campeón",
};

/** Umbrales configurables. DEFAULT_RATING (1500) cae en Platino. */
export const LEAGUE_CONFIG: LeagueDef[] = [
  { id: "iron", floor: 0, ceil: 599, divisions: 4, apex: false },
  { id: "bronze", floor: 600, ceil: 899, divisions: 4, apex: false },
  { id: "silver", floor: 900, ceil: 1199, divisions: 4, apex: false },
  { id: "gold", floor: 1200, ceil: 1499, divisions: 4, apex: false },
  { id: "platinum", floor: 1500, ceil: 1799, divisions: 4, apex: false },
  { id: "diamond", floor: 1800, ceil: 2099, divisions: 4, apex: false },
  { id: "master", floor: 2100, ceil: 2399, divisions: 1, apex: true },
  { id: "grandmaster", floor: 2400, ceil: 2699, divisions: 1, apex: true },
  { id: "champion", floor: 2700, ceil: Infinity, divisions: 1, apex: true },
];

const BY_ID: Record<LeagueId, LeagueDef> = Object.fromEntries(LEAGUE_CONFIG.map((d) => [d.id, d])) as Record<LeagueId, LeagueDef>;

export function leagueDef(id: LeagueId): LeagueDef { return BY_ID[id]; }
export function leagueOrdinal(id: LeagueId): number { return LEAGUES.indexOf(id); }
export function divisionsOf(id: LeagueId): number { return BY_ID[id].divisions; }
export function isApex(id: LeagueId): boolean { return BY_ID[id].apex; }

/** Liga a la que pertenece un MMR. */
export function leagueForMmr(mmr: number): LeagueId {
  for (const d of LEAGUE_CONFIG) if (mmr >= d.floor && mmr <= d.ceil) return d.id;
  return mmr < 0 ? "iron" : "champion";
}

/** División dentro de una liga (1 = más alta … divisions = más baja). Apex ⇒ 0. */
export function divisionForMmr(mmr: number, league: LeagueId): number {
  const d = BY_ID[league];
  if (d.apex) return 0;
  const span = (d.ceil - d.floor + 1) / d.divisions;
  const idx = Math.floor((mmr - d.floor) / span); // 0 = más baja
  const clamped = Math.max(0, Math.min(d.divisions - 1, idx));
  return d.divisions - clamped; // invierte: arriba de la banda = división 1
}

/** Orden absoluto de un rango (mayor = mejor) para comparar/ordenar. */
export function rankOrdinal(league: LeagueId | null, division: number): number {
  if (!league) return -1; // en placements
  const base = leagueOrdinal(league) * 10;
  return isApex(league) ? base + 5 : base + (5 - division); // división 1 > 4
}

export function rankLabel(league: LeagueId | null, division: number): string {
  if (!league) return "Sin clasificar";
  if (isApex(league)) return LEAGUE_LABEL[league];
  return `${LEAGUE_LABEL[league]} ${["", "I", "II", "III", "IV"][division] ?? ""}`.trim();
}
