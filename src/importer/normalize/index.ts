/**
 * NORMALIZER — estructura saneada → MODELO CANÓNICO (`@/importer/model`, reutiliza `domain/esports`).
 *
 * Resuelve identidad (equipos/jugadores/coaches → id canónico estable, prefijado por tipo para evitar
 * colisiones), parsea fechas con el `parseIso` PURO inyectado, remapea TODAS las referencias y
 * construye índices `Map` O(1). 100% determinista (todo el no-determinismo se inyecta por `ctx`).
 */
import { normalizeKey } from "@/intel/identity";
import type { ParsedSnapshot } from "../parse";
import { IMPORTER_SCHEMA_VERSION, type ImportCtx, type CanonicalModel, type ImportIssue } from "../types";
import type {
  Tournament, Circuit, CircuitScope, Stage, StageKind, ProTeam, ProPlayer, Match, MatchStatus,
  MatchFormat, MatchMap, MapPlayerStat, Standing, StandingStatus, CircuitTier, Season, Group,
  Bracket, Round, ProCoach, ProCoachStatus, Roster, RosterChange, ObjectiveAwards, BracketKind, RoundType,
} from "../model";

// ── Coerción determinista a los enums del dominio ──
function coerceStatus(s?: string): MatchStatus {
  const v = (s ?? "").toLowerCase();
  if (v === "finished" || v === "completed" || v === "ended") return "finished";
  if (v === "live" || v === "ongoing") return "live";
  return "upcoming";
}
function coerceFormat(f?: string, bestOf?: number): MatchFormat {
  const v = (f ?? "").toLowerCase();
  if (v === "bo1" || bestOf === 1) return "bo1";
  if (v === "bo5" || bestOf === 5) return "bo5";
  return "bo3";
}
const bestOfFor = (f: MatchFormat): number => (f === "bo1" ? 1 : f === "bo5" ? 5 : 3);
const inSet = <T extends string>(v: string | undefined, set: readonly T[], dflt: T): T =>
  (set as readonly string[]).includes((v ?? "").toLowerCase()) ? ((v as string).toLowerCase() as T) : dflt;
const coerceStageKind = (k?: string): StageKind => inSet(k, ["group", "swiss", "playoff", "bracket", "showmatch"], "bracket");
const coerceTier = (t?: string): CircuitTier => inSet(t, ["vct-international", "challengers", "game-changers", "ascension", "tier2", "tier3"], "tier2");
const coerceScope = (s?: string): CircuitScope => inSet(s, ["international", "regional", "national"], "regional");
const coerceStandingStatus = (s?: string): StandingStatus => inSet(s, ["active", "qualified", "eliminated"], "active");
const coerceCoachStatus = (s?: string): ProCoachStatus => inSet(s, ["active", "inactive", "retired"], "active");
const coerceBracketKind = (s?: string): BracketKind => inSet(s, ["single-elim", "double-elim", "gsl", "swiss", "round-robin"], "single-elim");
const coerceRoundType = (s?: string): RoundType => inSet(s, ["pistol", "eco", "force", "buy", "bonus", "unknown"], "unknown");
const coerceSide = (s?: string): "attack" | "defense" | undefined => {
  const v = (s ?? "").toLowerCase();
  return v === "attack" || v === "atk" ? "attack" : v === "defense" || v === "def" ? "defense" : undefined;
};

// ── Resolución de referencias (por id de fuente o por nombre) ──
interface RefMap { byRaw: Map<string, string>; byName: Map<string, string> }
function resolveRef(map: RefMap, ref: string, prefix: string): string {
  return map.byRaw.get(ref) ?? map.byName.get(normalizeKey(ref)) ?? `${prefix}:${normalizeKey(ref) || "unknown"}`;
}

export function normalizeSnapshot(p: ParsedSnapshot, ctx: ImportCtx): { model: CanonicalModel; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const { identity, clock } = ctx;
  const iso = clock.parseIso;

  // Equipos → id canónico "t:<base>"
  const teamRef: RefMap = { byRaw: new Map(), byName: new Map() };
  const teams: ProTeam[] = [];
  const teamSeen = new Map<string, ProTeam>();
  for (const t of p.teams) {
    const id = `t:${identity.resolve({ id: t.id, name: t.name }, "team")}`;
    if (t.id) teamRef.byRaw.set(t.id, id);
    teamRef.byName.set(normalizeKey(t.name), id);
    if (!teamSeen.has(id)) {
      const team: ProTeam = { id, name: t.name, tag: t.tag, fullName: t.fullName, region: t.region, country: t.country, slug: t.slug, active: t.active ?? true };
      teams.push(team); teamSeen.set(id, team);
    } else {
      issues.push({ kind: "duplicate", severity: "info", entity: "team", ref: id, message: `equipo duplicado colapsado: ${t.name}` });
    }
  }

  // Jugadores → "p:<base>"
  const playerRef: RefMap = { byRaw: new Map(), byName: new Map() };
  const players: ProPlayer[] = [];
  const playerSeen = new Map<string, ProPlayer>();
  for (const pl of p.players) {
    const id = `p:${identity.resolve({ id: pl.id, name: pl.nick, realName: pl.fullName }, "player")}`;
    if (pl.id) playerRef.byRaw.set(pl.id, id);
    playerRef.byName.set(normalizeKey(pl.nick), id);
    if (!playerSeen.has(id)) {
      const player: ProPlayer = {
        id, nick: pl.nick, fullName: pl.fullName, teamId: pl.team ? resolveRef(teamRef, pl.team, "t") : undefined,
        region: pl.region, role: pl.role, country: pl.country, status: pl.status ?? "active",
        agents: pl.agents ?? [], isSubstitute: pl.isSubstitute ?? false,
      };
      players.push(player); playerSeen.set(id, player);
    } else {
      issues.push({ kind: "duplicate", severity: "info", entity: "player", ref: id, message: `jugador duplicado colapsado: ${pl.nick}` });
    }
  }

  // Coaches → "c:<base>"
  const coachRef: RefMap = { byRaw: new Map(), byName: new Map() };
  const coaches: ProCoach[] = [];
  const coachSeen = new Map<string, ProCoach>();
  for (const c of p.coaches) {
    const id = `c:${identity.resolve({ id: c.id, name: c.name, realName: c.fullName }, "coach")}`;
    if (c.id) coachRef.byRaw.set(c.id, id);
    coachRef.byName.set(normalizeKey(c.name), id);
    if (!coachSeen.has(id)) {
      const coach: ProCoach = { id, name: c.name, fullName: c.fullName, teamId: c.team ? resolveRef(teamRef, c.team, "t") : undefined, region: c.region, country: c.country, status: coerceCoachStatus(c.status) };
      coaches.push(coach); coachSeen.set(id, coach);
    } else {
      issues.push({ kind: "duplicate", severity: "info", entity: "coach", ref: id, message: `coach duplicado colapsado: ${c.name}` });
    }
  }

  // Torneo
  const tournament: Tournament = {
    id: p.tournament.id, name: p.tournament.name, type: p.tournament.type ?? "", circuitId: p.tournament.circuitId,
    tier: p.tournament.tier ? coerceTier(p.tournament.tier) : undefined, region: p.tournament.region,
    status: coerceStatus(p.tournament.status), slug: p.tournament.slug, prizePool: p.tournament.prizePool,
    location: p.tournament.location, country: p.tournament.country, startDate: p.tournament.startDate, endDate: p.tournament.endDate,
  };

  const circuit: Circuit | undefined = p.circuit
    ? { id: p.circuit.id, name: p.circuit.name, tier: coerceTier(p.circuit.tier), scope: coerceScope(p.circuit.scope), region: p.circuit.region }
    : undefined;

  // Temporada (objetiva)
  const year = p.season?.year ?? p.tournament.year ?? (p.tournament.startDate && /^\d{4}/.test(p.tournament.startDate) ? +p.tournament.startDate.slice(0, 4) : undefined);
  const season: Season | undefined = p.season || year != null
    ? {
        id: p.season?.id ?? (year != null ? `season-${year}` : `season-${tournament.id}`),
        name: p.season?.name ?? (year != null ? `Season ${year}` : tournament.name),
        year: year ?? 0, circuitId: tournament.circuitId, tier: tournament.tier,
        startDate: iso(p.tournament.startDate), endDate: iso(p.tournament.endDate), tournamentIds: [tournament.id],
      }
    : undefined;

  const stages: Stage[] = p.stages.map((s, i) => ({ id: s.id, eventId: tournament.id, slug: s.slug ?? s.id, name: s.name, kind: coerceStageKind(s.kind), orderIdx: s.orderIdx ?? i }));
  const groups: Group[] = p.groups.map((g) => ({ id: g.id, stageId: g.stageId, label: g.label, teamIds: g.teams.map((r) => resolveRef(teamRef, r, "t")) }));
  const brackets: Bracket[] = p.brackets.map((b) => ({ id: b.id, stageId: b.stageId, kind: coerceBracketKind(b.kind), nodes: b.nodes.map((n) => ({ id: n.id, round: n.round, slot: n.slot ?? 0, matchId: n.matchId, winnerToNodeId: n.winnerToNodeId, loserToNodeId: n.loserToNodeId })) }));

  const matches: Match[] = p.matches.map((m) => {
    const fmt = coerceFormat(m.format, m.bestOf);
    return {
      id: m.id, eventId: tournament.id, stageId: m.stageId, teamAId: resolveRef(teamRef, m.teamA, "t"), teamBId: resolveRef(teamRef, m.teamB, "t"),
      startTime: iso(m.startTime), status: coerceStatus(m.status), format: fmt, bestOf: m.bestOf ?? bestOfFor(fmt),
      round: m.round, matchOrder: m.matchOrder, scoreA: m.scoreA, scoreB: m.scoreB,
      winnerTeamId: m.winner ? resolveRef(teamRef, m.winner, "t") : undefined, mvpPlayerId: m.mvp ? resolveRef(playerRef, m.mvp, "p") : undefined,
    };
  });

  const maps: MatchMap[] = p.maps.map((mm) => ({ id: mm.id, matchId: mm.matchId, mapId: mm.map, mapOrder: mm.mapOrder ?? 0, scoreA: mm.scoreA, scoreB: mm.scoreB, winnerTeamId: mm.winner ? resolveRef(teamRef, mm.winner, "t") : undefined, pickedBy: mm.pickedBy ? resolveRef(teamRef, mm.pickedBy, "t") : undefined }));

  const mapStats: MapPlayerStat[] = p.mapStats.map((s) => {
    const playerId = resolveRef(playerRef, s.player, "p");
    return { id: s.id ?? `${s.matchMapId}:${playerId}`, matchMapId: s.matchMapId, matchId: s.matchId, playerId, teamId: s.team ? resolveRef(teamRef, s.team, "t") : undefined, agentId: s.agent, acs: s.acs, kills: s.kills, deaths: s.deaths, assists: s.assists, kast: s.kast, adr: s.adr, hsPct: s.hsPct, fk: s.fk, fd: s.fd, clutches: s.clutches, rating: s.rating };
  });

  const rounds: Round[] = p.rounds.map((r) => ({ id: r.id ?? `${r.matchMapId}:r${r.index}`, matchMapId: r.matchMapId, index: r.index, winnerTeamId: r.winner ? resolveRef(teamRef, r.winner, "t") : undefined, side: coerceSide(r.side), type: coerceRoundType(r.type), plant: r.plant, defuse: r.defuse }));

  const standings: Standing[] = p.standings.map((s) => {
    const teamId = resolveRef(teamRef, s.team, "t");
    const mapsWon = s.mapsWon ?? 0, mapsLost = s.mapsLost ?? 0, roundsWon = s.roundsWon ?? 0, roundsLost = s.roundsLost ?? 0;
    return { id: s.id ?? `${tournament.id}:${teamId}`, eventId: tournament.id, stageId: s.stageId, teamId, position: s.position, wins: s.wins ?? 0, losses: s.losses ?? 0, ties: s.ties ?? 0, mapsWon, mapsLost, mapDiff: mapsWon - mapsLost, roundsWon, roundsLost, roundDiff: roundsWon - roundsLost, points: s.points ?? 0, groupLabel: s.groupLabel, status: coerceStandingStatus(s.status) };
  });

  const rosterChanges: RosterChange[] = p.rosterChanges.map((rc) => {
    const teamId = resolveRef(teamRef, rc.team, "t"), playerId = resolveRef(playerRef, rc.player, "p");
    return { id: rc.id ?? `${teamId}:${playerId}`, teamId, playerId, role: rc.role, joinedAt: iso(rc.joinedAt), leftAt: iso(rc.leftAt), isActive: rc.isActive ?? !rc.leftAt };
  });
  const rosters: Roster[] = teams.map((t) => ({ teamId: t.id, playerIds: players.filter((pl) => pl.teamId === t.id).map((pl) => pl.id), coachId: coaches.find((c) => c.teamId === t.id)?.id, changes: rosterChanges.filter((rc) => rc.teamId === t.id) }));

  const awards: ObjectiveAwards | undefined = p.awards
    ? { tournamentId: tournament.id, championTeamId: p.awards.champion ? resolveRef(teamRef, p.awards.champion, "t") : undefined, runnerUpTeamId: p.awards.runnerUp ? resolveRef(teamRef, p.awards.runnerUp, "t") : undefined, mvpPlayerId: p.awards.mvp ? resolveRef(playerRef, p.awards.mvp, "p") : undefined, placements: (p.awards.placements ?? []).map((pl) => ({ position: pl.position, teamId: resolveRef(teamRef, pl.team, "t"), prize: pl.prize, points: pl.points })) }
    : undefined;

  const model: CanonicalModel = {
    schemaVersion: ctx.schemaVersion ?? IMPORTER_SCHEMA_VERSION,
    circuit, season, tournament, stages, groups, brackets, teams, players, coaches, rosters, matches, maps, mapStats, rounds, standings, awards,
    index: {
      teamById: new Map(teams.map((t) => [t.id, t])),
      playerById: new Map(players.map((pl) => [pl.id, pl])),
      coachById: new Map(coaches.map((c) => [c.id, c])),
      matchById: new Map(matches.map((m) => [m.id, m])),
      mapById: new Map(maps.map((mm) => [mm.id, mm])),
    },
  };
  return { model, issues };
}
