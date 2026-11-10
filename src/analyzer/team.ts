/**
 * TEAM ANALYZER — informe objetivo por equipo derivado SOLO del Canonical Model. Nunca inventa:
 * los flags que no tienen evidencia suficiente quedan en `false` (o `undefined` cuando aplica).
 * Puro y determinista. Sin O(n²) (índices Map + dos pasadas para strength-of-schedule).
 */
import type { CanonicalModel, Match, MatchMap } from "@/importer";
import type { TeamReport } from "./types";

interface Tally { wins: number; losses: number; series: number; mapsWon: number; mapsLost: number; roundsFor: number; roundsAgainst: number; opponents: string[] }

export function analyzeTeams(model: CanonicalModel): TeamReport[] {
  const stageKind = new Map(model.stages.map((s) => [s.id, s.kind]));
  const mapsByMatch = new Map<string, MatchMap[]>();
  for (const mm of model.maps) { const a = mapsByMatch.get(mm.matchId); if (a) a.push(mm); else mapsByMatch.set(mm.matchId, [mm]); }
  const standingByTeam = new Map(model.standings.map((s) => [s.teamId, s]));

  const tally = new Map<string, Tally>();
  const fresh = (): Tally => ({ wins: 0, losses: 0, series: 0, mapsWon: 0, mapsLost: 0, roundsFor: 0, roundsAgainst: 0, opponents: [] });
  const get = (id: string): Tally => { let t = tally.get(id); if (!t) { t = fresh(); tally.set(id, t); } return t; };
  const playoffTeams = new Set<string>();
  const reverseSweepTeams = new Set<string>();
  const lostAMatch = new Set<string>();

  for (const m of model.matches) {
    const A = m.teamAId, B = m.teamBId;
    if (!A || !B) continue;
    const ta = get(A), tb = get(B);
    ta.series++; tb.series++; ta.opponents.push(B); tb.opponents.push(A);
    if (stageKind.get(m.stageId ?? "") === "playoff" || stageKind.get(m.stageId ?? "") === "bracket") { playoffTeams.add(A); playoffTeams.add(B); }
    if (m.winnerTeamId === A) { ta.wins++; tb.losses++; lostAMatch.add(B); }
    else if (m.winnerTeamId === B) { tb.wins++; ta.losses++; lostAMatch.add(A); }

    const maps = (mapsByMatch.get(m.id) ?? []).slice().sort((x, y) => x.mapOrder - y.mapOrder);
    for (const mm of maps) {
      const aWon = mm.winnerTeamId === A;
      if (mm.winnerTeamId) { if (aWon) { ta.mapsWon++; tb.mapsLost++; } else { tb.mapsWon++; ta.mapsLost++; } }
      ta.roundsFor += mm.scoreA ?? 0; ta.roundsAgainst += mm.scoreB ?? 0;
      tb.roundsFor += mm.scoreB ?? 0; tb.roundsAgainst += mm.scoreA ?? 0;
    }
    // Reverse sweep (solo bo5): pierde los 2 primeros mapas y gana la serie.
    if (maps.length >= 5 && m.winnerTeamId) {
      const first2 = maps.slice(0, 2);
      const loserOfFirst2 = first2.every((mm) => mm.winnerTeamId && mm.winnerTeamId !== m.winnerTeamId);
      if (loserOfFirst2) reverseSweepTeams.add(m.winnerTeamId);
    }
  }

  const winrate = (t: Tally): number => t.wins / Math.max(1, t.series);
  const champId = model.awards?.championTeamId ?? model.standings.find((s) => s.position === 1)?.teamId;
  const runnerId = model.awards?.runnerUpTeamId ?? model.standings.find((s) => s.position === 2)?.teamId;
  const finished = model.tournament.status === "finished";
  const doubleElim = model.brackets.some((b) => b.kind === "double-elim");

  const reports: TeamReport[] = model.teams.map((team) => {
    const t = tally.get(team.id) ?? fresh();
    const st = standingByTeam.get(team.id);
    const wr = winrate(t);
    const sos = t.opponents.length ? t.opponents.reduce((a, o) => a + winrate(tally.get(o) ?? fresh()), 0) / t.opponents.length : 0;
    const champion = champId === team.id;
    const runnerUp = !champion && runnerId === team.id;
    const thirdPlace = st?.position === 3;
    const reachedPlayoff = playoffTeams.has(team.id);
    const eliminated = st?.status === "eliminated" || (finished && !champion && lostAMatch.has(team.id) && st?.status !== "qualified");
    const cinderella = (champion || runnerUp) && typeof team.worldRanking === "number" && team.worldRanking > 8;
    return {
      teamId: team.id, name: team.name,
      wins: t.wins, losses: t.losses, mapsWon: t.mapsWon, mapsLost: t.mapsLost,
      roundDiff: t.roundsFor - t.roundsAgainst, series: t.series, winrate: Math.round(wr * 1000) / 1000,
      strengthOfSchedule: Math.round(sos * 1000) / 1000,
      economy: undefined, // el modelo canónico de Fase 1 no trae economía → unknown
      placement: st?.position,
      eliminated, qualified: st?.status === "qualified", champion, runnerUp, thirdPlace,
      groupWinner: !!st?.groupLabel && st.position === 1,
      reachedPlayoff,
      perfectRun: champion && t.mapsLost === 0 && t.mapsWon > 0,
      reverseSweep: reverseSweepTeams.has(team.id),
      lowerBracketRun: doubleElim && (champion || runnerUp) && lostAMatch.has(team.id),
      cinderellaRun: cinderella,
    };
  });
  return reports.sort((a, b) => (a.placement ?? 999) - (b.placement ?? 999) || b.winrate - a.winrate || a.teamId.localeCompare(b.teamId));
}
