/**
 * Conversión fila SQL (snake_case) → tipo de dominio (camelCase) para el
 * sistema competitivo. Funciones puras, reutilizables por todos los repos.
 */
import type {
  Circuit, Tournament, Stage, ProTeam, ProPlayer, Agent, GameMap,
  Match, MatchMap, MapPlayerStat, PlayerMatchStat, Standing, TeamStats,
  PlayerEventStats, CircuitTier, CircuitScope, StageKind, MatchFormat,
  MatchStatus, AgentRole, StandingStatus, TeamStatsScope,
} from "@/domain/esports/types";
import type {
  CircuitRow, EventRow, StageRow, TeamRow, PlayerRow, AgentRow, MapRow,
  MatchRow, MatchMapRow, MapPlayerStatRow, PlayerStatRow, StandingRow,
  TeamStatsRow, PlayerEventStatsRow,
} from "@/lib/supabase/esports.types";

const ms = (iso: string | null): number | undefined =>
  iso ? new Date(iso).getTime() : undefined;
const num = (n: number | null): number | undefined => (n == null ? undefined : Number(n));

export function toCircuit(r: CircuitRow): Circuit {
  return {
    id: r.id, name: r.name, tier: r.tier as CircuitTier,
    region: r.region ?? undefined, scope: r.scope as CircuitScope,
    parentCircuitId: r.parent_circuit_id ?? undefined,
    logo: r.logo ?? undefined, color: r.color ?? undefined,
  };
}

export function toTournament(r: EventRow): Tournament {
  return {
    id: r.id, name: r.name, type: r.type,
    circuitId: r.circuit_id ?? undefined, tier: (r.tier as CircuitTier) ?? undefined,
    region: r.region ?? undefined, status: r.status as MatchStatus,
    slug: r.slug ?? undefined, prizePool: num(r.prize_pool),
    location: r.location ?? undefined, country: r.country ?? undefined,
    logo: r.logo ?? undefined, vlrUrl: r.vlr_url ?? undefined,
    startDate: r.start_date ?? undefined, endDate: r.end_date ?? undefined,
  };
}

export function toStage(r: StageRow): Stage {
  return { id: r.id, eventId: r.event_id, slug: r.slug, name: r.name, kind: r.kind as StageKind, orderIdx: r.order_idx };
}

export function toTeam(r: TeamRow): ProTeam {
  return {
    id: r.id, name: r.name, tag: r.tag ?? undefined, fullName: r.full_name ?? undefined,
    region: r.region ?? undefined, country: r.country ?? undefined, slug: r.slug ?? undefined,
    logo: r.logo ?? undefined, color: r.color ?? undefined, worldRanking: num(r.world_ranking),
    earnings: num(r.earnings), vlrUrl: r.vlr_url ?? undefined, active: r.active,
  };
}

export function toPlayer(r: PlayerRow): ProPlayer {
  return {
    id: r.id, nick: r.nick, fullName: r.full_name ?? undefined, teamId: r.team_id ?? undefined,
    region: r.region ?? undefined, role: r.role ?? undefined, country: r.country ?? undefined,
    image: r.image ?? undefined, status: r.status, agents: r.agents ?? [],
    vlrUrl: r.vlr_url ?? undefined, earnings: num(r.earnings), twitter: r.twitter ?? undefined,
    number: num(r.number), isSubstitute: r.is_substitute,
  };
}

export function toAgent(r: AgentRow): Agent {
  return { id: r.id, name: r.name, role: r.role as AgentRole, icon: r.icon ?? undefined };
}

export function toMap(r: MapRow): GameMap {
  return { id: r.id, name: r.name, activePool: r.active_pool };
}

export function toMatch(r: MatchRow): Match {
  return {
    id: r.id, eventId: r.event_id ?? undefined, stageId: r.stage_id ?? undefined,
    teamAId: r.team_a_id ?? undefined, teamBId: r.team_b_id ?? undefined,
    startTime: ms(r.start_time), status: r.status as MatchStatus,
    format: (r.format as MatchFormat) ?? "bo3", bestOf: r.best_of, round: r.round ?? undefined,
    matchOrder: num(r.match_order), scoreA: num(r.score_a), scoreB: num(r.score_b),
    winnerTeamId: r.winner_team_id ?? undefined, mvpPlayerId: r.mvp_player_id ?? undefined,
    patch: r.patch ?? undefined, vodUrl: r.vod_url ?? undefined, vlrUrl: r.vlr_url ?? undefined,
  };
}

export function toMatchMap(r: MatchMapRow): MatchMap {
  return {
    id: r.id, matchId: r.match_id, mapId: r.map_id ?? undefined, mapOrder: r.map_order,
    scoreA: num(r.score_a), scoreB: num(r.score_b), winnerTeamId: r.winner_team_id ?? undefined,
    pickedBy: r.picked_by ?? undefined, sideStart: r.side_start ?? undefined, duration: num(r.duration),
  };
}

export function toMapPlayerStat(r: MapPlayerStatRow): MapPlayerStat {
  return {
    id: r.id, matchMapId: r.match_map_id, matchId: r.match_id, playerId: r.player_id ?? undefined,
    teamId: r.team_id ?? undefined, agentId: r.agent_id ?? undefined, acs: num(r.acs),
    kills: num(r.kills), deaths: num(r.deaths), assists: num(r.assists), kast: num(r.kast),
    adr: num(r.adr), hsPct: num(r.hs_pct), fk: num(r.fk), fd: num(r.fd),
    clutches: num(r.clutches), plusMinus: num(r.plus_minus), rating: num(r.rating),
  };
}

export function toPlayerMatchStat(r: PlayerStatRow): PlayerMatchStat {
  return {
    matchId: r.match_id ?? "", playerId: r.player_id ?? "", teamId: r.team_id ?? undefined,
    agentId: r.agent_id ?? undefined, acs: num(r.acs), kills: num(r.kills), deaths: num(r.deaths),
    assists: num(r.assists), hsPct: num(r.hs_pct), clutches: num(r.clutches), kast: num(r.kast),
    adr: num(r.adr), kd: num(r.kd), fk: num(r.fk), fd: num(r.fd), rating: num(r.rating),
    plusMinus: num(r.plus_minus), mapsPlayed: num(r.maps_played), rounds: num(r.rounds),
  };
}

export function toStanding(r: StandingRow): Standing {
  return {
    id: r.id, eventId: r.event_id, stageId: r.stage_id ?? undefined, teamId: r.team_id,
    position: num(r.position), wins: r.wins, losses: r.losses, ties: r.ties,
    mapsWon: r.maps_won, mapsLost: r.maps_lost, mapDiff: r.map_diff,
    roundsWon: r.rounds_won, roundsLost: r.rounds_lost, roundDiff: r.round_diff,
    points: r.points, groupLabel: r.group_label ?? undefined, status: r.status as StandingStatus,
  };
}

export function toTeamStats(r: TeamStatsRow): TeamStats {
  return {
    id: r.id, teamId: r.team_id, eventId: r.event_id ?? undefined, scope: r.scope as TeamStatsScope,
    matchesPlayed: r.matches_played, matchesWon: r.matches_won, matchesLost: r.matches_lost,
    mapsPlayed: r.maps_played, mapsWon: r.maps_won, mapsLost: r.maps_lost,
    roundsWon: r.rounds_won, roundsLost: r.rounds_lost, attackWinPct: num(r.attack_win_pct),
    defenseWinPct: num(r.defense_win_pct), pistolWinPct: num(r.pistol_win_pct),
  };
}

export function toPlayerEventStats(r: PlayerEventStatsRow): PlayerEventStats {
  return {
    id: r.id, playerId: r.player_id, eventId: r.event_id, rating: num(r.rating), acs: num(r.acs),
    kd: num(r.kd), adr: num(r.adr), kast: num(r.kast), hsPct: num(r.hs_pct),
    fkPerMap: num(r.fk_per_map), maps: r.maps, rounds: r.rounds, mvpCount: r.mvp_count,
  };
}
