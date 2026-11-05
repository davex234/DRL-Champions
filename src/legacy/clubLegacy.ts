/**
 * LEGADO DEL CLUB — la historia propia de cada organización (Career Fase 6/7).
 *
 * DERIVA todo del `WorldState` ya persistido: standings (historia/mejores-peores temporadas/
 * rachas), history.champions (dinastías/trofeos), transfers (récords), timeline (leyendas/
 * mejor jugador). PURO. No persiste nada nuevo: el mundo ya guarda los datos. Determinista.
 */
import type { WorldState } from "@/world";
import type { ClubLegacy, Dynasty, LegendEntry } from "./types";

export function clubLegacy(world: WorldState, clubId: string): ClubLegacy {
  const team = world.teams[clubId];
  const st = team?.standings ?? [];
  const champs = world.history.champions.filter((c) => c.teamId === clubId);

  // Mejores/peores temporadas por posición.
  let bestFinish = 99, bestSeason: number | null = null, worstSeason: number | null = null, worstPos = 0;
  for (const s of st) {
    if (s.pos < bestFinish) { bestFinish = s.pos; bestSeason = s.season; }
    if (s.pos > worstPos) { worstPos = s.pos; worstSeason = s.season; }
  }

  // Racha de títulos más larga (standings.champion consecutivos).
  let streak = 0, longest = 0;
  const legendarySeasons: number[] = [];
  for (const s of st) {
    if (s.champion) { streak++; longest = Math.max(longest, streak); if (s.losses <= 2) legendarySeasons.push(s.season); }
    else streak = 0;
  }

  // Dinastías: rachas de campeonatos en history.champions.
  const dynasties: Dynasty[] = [];
  let run = 0, from = 0, prev = "";
  const seq = [...world.history.champions];
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i];
    if (c.teamId === clubId) { if (prev !== clubId) { run = 1; from = c.season; } else run++; prev = clubId; if (run >= 2) upsertDynasty(dynasties, team?.name ?? clubId, clubId, run, from, c.season); }
    else prev = c.teamId;
  }

  // Récord de fichaje (entrada al club).
  const incoming = world.transfers.filter((t) => t.to === clubId && t.fee > 0).sort((a, b) => b.fee - a.fee)[0];

  // Leyendas: jugadores con paso por el club (Timeline) ordenados por bestRating; + coach histórico.
  const timelinePlayers = Object.values(world.timeline.players).filter((p) => p.teams.some((s) => s.teamId === clubId));
  const legends: LegendEntry[] = timelinePlayers
    .map((p) => ({ p, wp: world.players[p.id] }))
    .sort((a, b) => (b.p.bestRating ?? 0) - (a.p.bestRating ?? 0))
    .slice(0, 6)
    .map(({ p, wp }) => ({ id: p.id, name: p.nick, kind: "player" as const, titles: wp?.titles ?? 0, peakRating: Math.round(p.bestRating ?? 0), note: `${wp?.titles ?? 0} títulos · pico ${Math.round(p.bestRating ?? 0)}` }));
  const clubCoach = team?.coachId ? world.coaches[team.coachId] : null;
  if (clubCoach && clubCoach.titles > 0) legends.push({ id: clubCoach.id, name: clubCoach.name, kind: "coach", titles: clubCoach.titles, peakRating: clubCoach.rating, note: `${clubCoach.titles} títulos como entrenador` });

  const greatest = legends.filter((l) => l.kind === "player").sort((a, b) => b.peakRating - a.peakRating)[0] ?? null;
  const academyGraduates = Object.values(world.players).filter((p) => p.teamId === clubId && p.origin === "academy").length
    + world.transfers.filter((t) => t.to === clubId && t.kind === "promotion").length;

  return {
    clubId, name: team?.name ?? clubId,
    foundedSeason: st[0]?.season ?? world.season,
    seasonsPlayed: st.length,
    trophies: champs.length + st.filter((s) => s.champion).length,
    titles: st.filter((s) => s.champion).map((s) => ({ season: s.season, competition: "Liga DRL" })),
    bestFinish: bestFinish === 99 ? (team ? Object.keys(world.teams).length : 0) : bestFinish,
    bestSeason, worstSeason,
    longestTitleStreak: longest,
    legendarySeasons,
    legends,
    dynasties,
    records: {
      biggestTransfer: incoming ? { nick: incoming.nick, fee: incoming.fee, season: incoming.season } : null,
      greatestPlayer: greatest ? { nick: greatest.name, rating: greatest.peakRating } : null,
      greatestCoach: clubCoach && clubCoach.titles > 0 ? { name: clubCoach.name, titles: clubCoach.titles } : null,
      academyGraduates,
    },
  };
}

function upsertDynasty(list: Dynasty[], team: string, teamId: string, titles: number, from: number, to: number): void {
  const existing = list.find((d) => d.teamId === teamId && d.from === from);
  if (existing) { existing.titles = titles; existing.to = to; }
  else list.push({ team, teamId, titles, from, to });
}
