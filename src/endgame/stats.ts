/**
 * ESTADÍSTICAS HISTÓRICAS — la carrera completa en números (Career Fase 7/7).
 *
 * DERIVA de `ManagerCareer` (stats/history/management) + `WorldState` + `@/legacy`. Nada nuevo:
 * reutiliza reputación/atributos/ledger/valor de marca. PURO. Determinista.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";
import { globalReputationScore, reputationTier, attrOverall, ledgerTotals, FACILITY_IDS } from "@/career";
import { brandOf, clubLegacy } from "@/legacy";
import type { EndgameStats } from "./types";
import { clubIdOf, pct } from "./util";

export function endgameStats(career: ManagerCareer, world: WorldState): EndgameStats {
  const s = career.stats;
  const clubId = clubIdOf(career, world);
  const mgmt = career.management;

  const moneyGenerated = (mgmt?.ledger ?? []).reduce((a, l) => a + ledgerTotals(l).income, 0);
  const facilitiesBuilt = mgmt ? FACILITY_IDS.reduce((a, id) => a + (mgmt.facilities[id] ?? 0), 0) : 0;
  const brand = clubId ? brandOf(world, clubId) : null;
  const legacy = clubId ? clubLegacy(world, clubId) : null;
  const clubValue = brand ? Math.round(brand.commercialValue + (legacy?.trophies ?? 0) * 2000) : 0;

  // Jugadores entrenados: los que pasaron por los clubes del entrenador (Timeline).
  const clubIds = new Set<string>();
  if (clubId) clubIds.add(clubId);
  for (const sp of career.history.spells) { const t = Object.values(world.teams).find((x) => x.name === sp.team); if (t) clubIds.add(t.id); }
  const playersTrained = Object.values(world.timeline.players).filter((p) => p.teams.some((st) => clubIds.has(st.teamId))).length;
  const rookiesDiscovered = (mgmt?.academy.length ?? 0) + (mgmt?.academyStaff?.length ?? 0) + (clubId ? world.transfers.filter((t) => t.to === clubId && t.kind === "promotion").length : 0);

  return {
    seasonsCoached: s.seasonsCoached,
    teamsCoached: Math.max(s.teamsCoached, career.history.spells.length),
    matches: s.matchesPlayed,
    wins: s.wins,
    losses: s.losses,
    winRate: pct(s.wins, s.matchesPlayed),
    titles: s.titles,
    finals: s.finals,
    mvps: s.mvps,
    bestWinStreak: s.bestWinStreak,
    playersTrained,
    rookiesDiscovered,
    moneyGenerated: Math.round(moneyGenerated),
    clubValue,
    sponsorsSigned: mgmt?.sponsors.length ?? 0,
    facilitiesBuilt,
    reputationScore: globalReputationScore(career.reputation),
    reputationTier: reputationTier(career.reputation).label,
    overall: attrOverall(career.attributes),
    level: career.level,
  };
}
