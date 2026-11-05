/**
 * TOURNAMENT ANALYZER — orquesta el flujo: Team → Player → Awards → Story → TournamentReport.
 * Consume el Canonical Model (Fase 1) en SOLO LECTURA y produce un informe OBJETIVO y SERIALIZABLE.
 * Puro y determinista. Sin cartas/OVR/rareza. Sin stores/React/UI.
 */
import type { CanonicalModel, MapPlayerStat } from "@/importer";
import { analyzeTeams } from "./team";
import { analyzePlayers } from "./player";
import { computeAwards } from "./awards";
import { computeStory } from "./story";
import { tournamentType } from "./rating";
import { clamp } from "./aggregate";
import { ANALYZER_SCHEMA_VERSION, type TournamentReport, type TeamReport, type TournamentRecord } from "./types";
import { ns } from "@/i18n/runtime";

const tr = ns("analyzer");

const successOf = (t: TeamReport): number =>
  clamp(t.champion ? 1 : t.runnerUp ? 0.8 : t.thirdPlace ? 0.65 : t.reachedPlayoff ? 0.5 : 0.35 + 0.15 * t.winrate, 0, 1);

function records(model: CanonicalModel): TournamentRecord[] {
  const out: TournamentRecord[] = [];
  const top = (label: string, kind: string, f: (s: MapPlayerStat) => number | undefined): void => {
    let b: MapPlayerStat | undefined, bv = -Infinity;
    for (const s of model.mapStats) { const v = f(s); if (typeof v === "number" && v > bv) { bv = v; b = s; } }
    if (b) out.push({ kind, playerId: b.playerId, matchId: b.matchId, value: Math.round(bv), label });
  };
  top(tr("Mayor ACS en un mapa"), "top-map-acs", (s) => s.acs);
  top(tr("Más kills en un mapa"), "top-map-kills", (s) => s.kills);
  top(tr("Más clutches en un mapa"), "top-map-clutches", (s) => s.clutches);
  return out;
}

export function analyzeTournament(model: CanonicalModel): TournamentReport {
  const teams = analyzeTeams(model);
  const teamSuccess = new Map(teams.map((t) => [t.teamId, successOf(t)]));
  const players = analyzePlayers(model, tournamentType(model.tournament), teamSuccess);
  const awards = computeAwards(players, teams, model);
  const storyTags = computeStory(teams, model);

  const byRating = [...players].sort((a, b) => b.rating - a.rating || a.playerId.localeCompare(b.playerId)).map((p) => p.playerId);
  const byImpact = [...players].sort((a, b) => b.impact - a.impact || a.playerId.localeCompare(b.playerId)).map((p) => p.playerId);
  const byAcs = [...players].sort((a, b) => b.acs - a.acs || a.playerId.localeCompare(b.playerId)).map((p) => p.playerId);

  const champ = teams.find((t) => t.champion);
  const runner = teams.find((t) => t.runnerUp);
  const mvp = awards.find((a) => a.kind === "mvp");

  return {
    schemaVersion: ANALYZER_SCHEMA_VERSION,
    tournamentId: model.tournament.id,
    name: model.tournament.name,
    status: model.tournament.status,
    summary: { teams: teams.length, players: players.length, matches: model.matches.length, maps: model.maps.length, championTeamId: champ?.teamId, runnerUpTeamId: runner?.teamId, mvpPlayerId: mvp?.playerId },
    players, teams, awards, storyTags,
    records: records(model),
    rankings: { byRating, byImpact, byAcs },
    placements: [...model.standings].filter((s) => typeof s.position === "number").sort((a, b) => a.position! - b.position!).map((s) => ({ position: s.position!, teamId: s.teamId })),
    mvpCandidates: players.slice(0, 5).map((p) => ({ playerId: p.playerId, mvpScore: p.mvpScore })),
    eliminatedTeams: teams.filter((t) => t.eliminated).map((t) => t.teamId),
    qualifiedTeams: teams.filter((t) => t.qualified).map((t) => t.teamId),
    timeline: [...model.matches].sort((a, b) => (a.matchOrder ?? 0) - (b.matchOrder ?? 0)).map((m, i) => ({ matchId: m.id, order: m.matchOrder ?? i, stageId: m.stageId, round: m.round, teamAId: m.teamAId ?? "", teamBId: m.teamBId ?? "", scoreA: m.scoreA, scoreB: m.scoreB, winnerTeamId: m.winnerTeamId })),
  };
}
