/**
 * DRL ESPORTS SYNC — normalización Raw → fila SQL (snake_case) lista para
 * upsert. Aquí se calculan métricas derivadas (rating, +/-) con
 * `@/domain/esports/ratings`, de modo que nunca se confía en valores crudos.
 */
import { deriveMapStats } from "@/domain/esports/ratings";
import { normalizeStatus, type RawCircuit, type RawTournament, type RawTeam, type RawMatch, type RawMatchMap, type RawMapPlayer } from "./source";

const iso = (s: string | undefined): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

export function circuitRow(r: RawCircuit) {
  return {
    id: r.id, name: r.name, tier: r.tier ?? "vct-international",
    region: r.region ?? null, scope: r.scope ?? "regional",
    parent_circuit_id: r.parentCircuitId ?? null,
  };
}

export function eventRow(r: RawTournament) {
  return {
    id: r.id, name: r.name, type: r.type ?? "other", status: normalizeStatus(r.status),
    region: r.region ?? null, circuit_id: r.circuitId ?? null, tier: r.tier ?? null,
    slug: r.slug ?? null, prize_pool: r.prizePool ?? null, location: r.location ?? null,
    country: r.country ?? null, vlr_url: r.vlrUrl ?? null,
    start_date: iso(r.startDate), end_date: iso(r.endDate), source: "vlr",
  };
}

export function teamRow(r: RawTeam) {
  return {
    id: r.id, name: r.name, tag: r.tag ?? null, full_name: r.fullName ?? null,
    region: r.region ?? null, country: r.country ?? null, logo: r.logo ?? null,
  };
}

export function matchRow(r: RawMatch, stageId: string | null) {
  const best = r.bestOf ?? (r.format === "bo5" ? 5 : r.format === "bo1" ? 1 : 3);
  return {
    id: r.id, event_id: r.eventId, stage_id: stageId,
    team_a_id: r.teamAId, team_b_id: r.teamBId,
    team_a: r.teamAId, team_b: r.teamBId, // respaldo legacy (0002)
    start_time: iso(r.startTime), status: normalizeStatus(r.status),
    format: r.format ?? "bo3", best_of: best, round: r.round ?? null,
    match_order: r.matchOrder ?? null, score_a: r.scoreA ?? null, score_b: r.scoreB ?? null,
    winner_team_id: r.winnerTeamId ?? null, winner_team: r.winnerTeamId ?? null,
    mvp_player_id: r.mvpPlayerId ?? null, patch: r.patch ?? null,
    vod_url: r.vodUrl ?? null, vlr_url: r.vlrUrl ?? null,
  };
}

export function matchMapRow(matchId: string, m: RawMatchMap) {
  const winner = m.winnerTeamId
    ?? (m.scoreA != null && m.scoreB != null ? (m.scoreA > m.scoreB ? "a" : m.scoreB > m.scoreA ? "b" : null) : null);
  return {
    match_id: matchId, map_id: m.mapId ?? null, map_order: m.mapOrder,
    score_a: m.scoreA ?? null, score_b: m.scoreB ?? null,
    // 'a'/'b' marcadores son placeholders; el orquestador resuelve al teamId real.
    winner_team_id: winner === "a" || winner === "b" ? null : (m.winnerTeamId ?? null),
    picked_by: m.pickedBy ?? null, side_start: m.sideStart ?? null, duration: m.duration ?? null,
  };
}

/** Fila de scoreboard por jugador en un mapa, con métricas derivadas. */
export function mapPlayerStatRow(matchMapId: string, matchId: string, p: RawMapPlayer) {
  const rounds = p.rounds ?? 0;
  const d = deriveMapStats({
    kills: p.kills ?? 0, deaths: p.deaths ?? 0, assists: p.assists ?? 0,
    combatScore: p.combatScore, damage: p.damage, rounds,
    kast: p.kast, hsPct: p.hsPct, firstKills: p.fk, firstDeaths: p.fd,
  });
  return {
    match_map_id: matchMapId, match_id: matchId, player_id: p.playerId,
    team_id: p.teamId, agent_id: p.agentId ?? null,
    acs: p.acs ?? (d.acs || null), kills: p.kills ?? null, deaths: p.deaths ?? null,
    assists: p.assists ?? null, kast: p.kast ?? (d.kast || null), adr: d.adr || null,
    hs_pct: p.hsPct ?? null, fk: p.fk ?? null, fd: p.fd ?? null,
    clutches: p.clutches ?? null, plus_minus: d.plusMinus, rating: d.rating,
  };
}
