import type { TournamentType, MatchStatus, RawResult, RawPlayerStat } from "./types";

/** Detecta el tipo de torneo a partir del nombre (extensible). */
export function detectTournamentType(name: string): TournamentType {
  const n = name.toLowerCase();
  if (n.includes("masters")) return "masters";
  if (n.includes("champions")) return "champions";
  if (n.includes("ewc") || n.includes("esports world cup")) return "ewc";
  if (n.includes("game changers") || n.includes("gc")) return "game-changers";
  if (n.includes("ascension")) return "ascension";
  if (n.includes("off") && n.includes("season")) return "off-season";
  if (["emea", "americas", "pacific", "china", "vct"].some((r) => n.includes(r))) return "regional";
  return "other";
}

export function tournamentStatusFromRaw(s?: string): MatchStatus {
  const v = (s ?? "").toLowerCase();
  if (["completed", "finished", "ended", "final"].some((x) => v.includes(x))) return "finished";
  if (["live", "ongoing", "in progress", "running"].some((x) => v.includes(x))) return "live";
  return "upcoming";
}

export function matchStatusFromRaw(s?: string): MatchStatus {
  const v = (s ?? "").toLowerCase();
  if (["completed", "finished", "ended"].some((x) => v.includes(x))) return "finished";
  if (v.includes("live")) return "live";
  return "upcoming";
}

/** Identifica al MVP. Si la fuente no lo da, lo deduce por ACS (menor confianza). */
export function identifyMvp(result: RawResult): { playerId: string; nick: string; confidence: number; issues: string[] } {
  const issues: string[] = [];
  if (result.mvpPlayerId) {
    const s = result.stats.find((x) => x.playerId === result.mvpPlayerId);
    if (s) return { playerId: s.playerId, nick: s.nick, confidence: 0.97, issues };
    issues.push("MVP indicado por la fuente no aparece en las estadísticas");
  }
  // Deducción por mejor ACS entre el equipo ganador.
  const winners = result.stats.filter((s) => s.teamId === result.winnerTeamId);
  const pool = winners.length ? winners : result.stats;
  const best = [...pool].sort((a, b) => (b.acs ?? 0) - (a.acs ?? 0))[0];
  if (!best) {
    issues.push("No se pudo identificar al MVP");
    return { playerId: "", nick: "", confidence: 0, issues };
  }
  issues.push("MVP deducido por ACS (no confirmado por la fuente)");
  return { playerId: best.playerId, nick: best.nick, confidence: 0.7, issues };
}

/** Jugadores del equipo ganador. */
export function winnerPlayers(result: RawResult): RawPlayerStat[] {
  return result.stats.filter((s) => s.teamId === result.winnerTeamId);
}
