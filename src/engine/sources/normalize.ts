import type { Player } from "@/domain/cards/types";
import { normalizeRawPlayer } from "@/data/sources/normalize";
import type { Tournament, Match, RawTournament, RawMatch, RawTeam, RawPlayerStat } from "../types";
import { detectTournamentType, tournamentStatusFromRaw, matchStatusFromRaw } from "../tournament";

/** Capa de normalización: datos crudos de la fuente → dominio del engine. */

export function normalizeTournament(raw: RawTournament): Tournament {
  return {
    id: raw.id,
    name: raw.name,
    type: detectTournamentType(raw.name),
    region: raw.region,
    status: tournamentStatusFromRaw(raw.status),
    startDate: raw.startDate,
    endDate: raw.endDate,
  };
}

export function normalizeMatches(raws: RawMatch[], teams: RawTeam[]): Match[] {
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? id;
  return raws.map((m) => ({
    id: m.id,
    tournamentId: m.tournamentId,
    teamA: name(m.teamAId),
    teamB: name(m.teamBId),
    startTime: new Date(m.startTime).getTime(),
    status: matchStatusFromRaw(m.status),
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    winner: m.winnerTeamId ? name(m.winnerTeamId) : undefined,
  }));
}

/** Convierte una estadística cruda + equipo en un Player del juego (normalizado). */
export function normalizeStatToPlayer(stat: RawPlayerStat, teamName: string): Player {
  return normalizeRawPlayer({
    id: stat.playerId,
    nick: stat.nick,
    team: teamName,
    region: stat.region ?? "EMEA",
    role: stat.role,
    country: stat.country ?? "",
    metrics: {
      acs: stat.acs,
      kills: stat.kills,
      deaths: stat.deaths,
      assists: stat.assists,
      hsPct: stat.hsPct,
      clutches: stat.clutches,
      kast: stat.kast,
    },
    accolades: [],
  });
}
