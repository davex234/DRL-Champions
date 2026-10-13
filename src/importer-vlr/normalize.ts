/**
 * NORMALIZE — formas intermedias `Vlr*` → `RawSnapshot` OFICIAL del Data Import Engine.
 *
 * PURO y determinista. Aquí NO se decide nada de juego (ni OVR, ni rarezas, ni cartas): solo se
 * traduce al contrato `Raw*` que el Importer ya sabe parsear/normalizar/validar. Las referencias
 * entre entidades van POR NOMBRE (equipo/nick), exactamente como espera el normalizer del
 * Importer (resolución vía IdentityResolver).
 */
import type {
  RawBracket, RawBracketNode,
  RawSnapshot, RawMatch, RawMatchMap, RawMapPlayerStat, RawStage, RawTeam, RawPlayer,
  RawStanding, RawAwards, RawPlayerTournamentStat,
} from "@/importer";
import { looseName, parseVlrDates, utcTsToIso } from "./parser";
import { buildPlayers, buildTagToTeam } from "./players";
import { prizeToAwards } from "./standings";
import type { VlrEventRef, VlrEventInfo, VlrTeam, VlrStatsRow, VlrMatch, VlrPlacement } from "./types";
import type { VlrBracketStructure } from "./brackets";

/** Tier VCT reconocible desde el nombre del torneo/circuito. `undefined` si no es inferible. */
export function inferTier(eventName: string, circuitName?: string): string | undefined {
  const s = `${eventName} ${circuitName ?? ""}`.toLowerCase();
  if (s.includes("game changers")) return "game-changers";
  if (s.includes("ascension")) return "ascension";
  if (s.includes("challengers")) return "challengers";
  if (s.includes("masters") || s.includes("champions")) return "vct-international";
  return undefined;
}

/** Región reconocible ("Americas"/"EMEA"/"Pacific"/"China"; internacional si el tier lo es). */
export function inferRegion(eventName: string, circuitName: string | undefined, tier: string | undefined): string | undefined {
  const s = `${eventName} ${circuitName ?? ""}`.toLowerCase();
  if (s.includes("americas")) return "Americas";
  if (s.includes("emea")) return "EMEA";
  if (s.includes("pacific")) return "Pacific";
  if (s.includes("china")) return "China";
  return tier === "vct-international" ? "International" : undefined;
}

const matchStatus = (text?: string): string => {
  const v = (text ?? "").toLowerCase();
  if (v.includes("completed") || v.includes("final")) return "finished";
  if (v.includes("live")) return "live";
  return "upcoming";
};

const stageKind = (label: string): string => {
  const v = label.toLowerCase();
  if (v.includes("group")) return "group";
  if (v.includes("swiss")) return "swiss";
  if (v.includes("playoff") || v.includes("bracket") || v.includes("final")) return "playoff";
  if (v.includes("showmatch")) return "showmatch";
  return "bracket";
};

/** "Thu, August 1, 2024" (label del listado) → "YYYY-MM-DD". */
const dayToIso = (day?: string): string | undefined =>
  parseVlrDates(day?.replace(/^[A-Za-z]+,\s*/, "")).start;

/** Construye el `RawSnapshot` oficial. Determinista: mismo HTML parseado ⇒ mismo snapshot. */
export function toRawSnapshot(
  ref: VlrEventRef,
  info: VlrEventInfo,
  vlrTeams: VlrTeam[],
  statsRows: VlrStatsRow[],
  vlrMatches: VlrMatch[],
  placements: VlrPlacement[] = [],
  structure?: VlrBracketStructure,
): RawSnapshot {
  const tournamentId = `vlr-${ref.eventId}`;
  const tagToTeam = buildTagToTeam(vlrTeams, statsRows, vlrMatches);
  const teamToTag = new Map<string, string>();
  for (const r of statsRows) {
    if (!r.teamTag) continue;
    const team = tagToTeam.get(looseName(r.teamTag));
    if (team && !teamToTag.has(looseName(team))) teamToTag.set(looseName(team), r.teamTag);
  }

  // Equipos = tarjetas del evento ∪ equipos que juegan partidos (la página del evento no
  // siempre lista todas las tarjetas). El id de VLR sale de la cabecera del partido si falta.
  const vlrIdByTeam = new Map<string, string>();
  for (const t of vlrTeams) if (t.vlrId) vlrIdByTeam.set(looseName(t.name), t.vlrId);
  for (const m of vlrMatches) for (const tr of m.teamRefs ?? []) {
    if (!vlrIdByTeam.has(looseName(tr.name))) vlrIdByTeam.set(looseName(tr.name), tr.vlrId);
  }
  const teams: RawTeam[] = vlrTeams.map((t) => ({
    id: t.vlrId, name: t.name, tag: teamToTag.get(looseName(t.name)), slug: undefined,
  }));
  const teamSeen = new Set(teams.map((t) => looseName(t.name)));
  for (const m of vlrMatches) for (const name of [m.teamA, m.teamB]) {
    const key = looseName(name);
    if (!name || teamSeen.has(key)) continue;
    teamSeen.add(key);
    teams.push({ id: vlrIdByTeam.get(key), name, tag: teamToTag.get(key) });
  }
  // También voto tag→equipo aplicado a la inversa por scoreboards (equipos sin fila de stats).
  for (const [tagLoose, teamName] of tagToTeam) {
    const key = looseName(teamName);
    if (!teamToTag.has(key)) {
      const t = teams.find((x) => looseName(x.name) === key);
      if (t && !t.tag) {
        const original = statsRows.find((r) => looseName(r.teamTag ?? "") === tagLoose)?.teamTag;
        const fromScoreboard = vlrMatches.flatMap((m) => m.maps).flatMap((mp) => mp.playerStats)
          .find((r) => looseName(r.teamTag ?? "") === tagLoose)?.teamTag;
        t.tag = original ?? fromScoreboard;
      }
    }
  }

  const players: RawPlayer[] = buildPlayers(vlrTeams, statsRows, vlrMatches).map((p) => ({
    id: p.vlrId, nick: p.nick, team: p.team, country: p.country, agents: p.agents,
  }));

  // Fases derivadas de los labels reales del listado ("Group Stage", "Playoffs").
  const stageLabels: string[] = [];
  for (const m of vlrMatches) {
    if (m.stage && !stageLabels.some((s) => looseName(s) === looseName(m.stage))) stageLabels.push(m.stage);
  }
  const stages: RawStage[] = stageLabels.map((label, i) => ({
    id: `st-${looseName(label) || i}`, name: label, kind: stageKind(label), orderIdx: i,
  }));
  const stageIdOf = (label?: string): string | undefined =>
    label ? stages.find((s) => looseName(s.name) === looseName(label))?.id : undefined;

  const matches: RawMatch[] = vlrMatches.map((m, i) => ({
    id: m.vlrId,
    stageId: stageIdOf(m.stage),
    teamA: m.teamA,
    teamB: m.teamB,
    startTime: utcTsToIso(m.utcTs) ?? dayToIso(m.dayText),
    status: matchStatus(m.statusText),
    format: m.bestOf ? `bo${m.bestOf}` : undefined,
    bestOf: m.bestOf,
    round: m.series,
    matchOrder: i + 1,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    winner: m.winner,
  }));

  /*
   * ESTRUCTURA DEL CUADRO (Fase 24.4) → `RawBracket`, el modelo canónico que el importador ya
   * tenía definido y nadie rellenaba. Un bracket por (grupo, rama); un nodo por caja con partido.
   * Solo entran aristas CONFIRMADAS por la gramática del markup; lo demás no existe aquí.
   */
  const brackets: RawBracket[] = [];
  if (structure?.present) {
    const matchIds = new Set(matches.map((m) => m.id));
    const edgeByFrom = new Map(structure.edges.map((e) => [e.fromMatchId, e]));
    for (const cont of structure.containers) {
      const bid = `br-${looseName(cont.group ?? "bracket") || "bracket"}-${cont.side}`;
      const labels = cont.columns.map((c) => looseName(c.label));
      const kind = labels.some((l) => /opening|decider|winners/.test(l)) ? "gsl" : cont.side === "lower" ? "double-elim" : "single-elim";
      const nodes: RawBracketNode[] = [];
      cont.columns.forEach((col, depthFromStart) => {
        col.items.forEach((it, slot) => {
          if (!it.matchId || !matchIds.has(it.matchId)) return;
          const e = edgeByFrom.get(it.matchId);
          nodes.push({
            id: `bn-${it.matchId}`, round: cont.columns.length - 1 - depthFromStart, slot,
            matchId: it.matchId,
            winnerToNodeId: e?.toMatchId ? `bn-${e.toMatchId}` : undefined,
            winnerToSlot: e?.toSlot,
            winnerQualifies: e?.qualificationKey,
            winnerQualifiesLabel: e?.qualificationLabel,
            evidence: e ? e.evidence : undefined,
            confidence: e ? e.confidence : undefined,
          });
        });
      });
      const stageId = stageIdOf(vlrMatches.find((m) => nodes.some((n) => n.matchId === m.vlrId))?.stage) ?? stages[0]?.id ?? "st-bracket";
      if (nodes.length) brackets.push({ id: bid, stageId, kind, nodes });
    }
  }

  const maps: RawMatchMap[] = [];
  const mapStats: RawMapPlayerStat[] = [];
  for (const m of vlrMatches) {
    for (const mp of m.maps) {
      maps.push({
        id: mp.gameId, matchId: m.vlrId, map: mp.name, mapOrder: mp.order,
        scoreA: mp.scoreA, scoreB: mp.scoreB, winner: mp.winner, pickedBy: mp.pickedBy,
      });
      for (const row of mp.playerStats) {
        const teamByTag = row.teamTag ? tagToTeam.get(looseName(row.teamTag)) : undefined;
        mapStats.push({
          matchMapId: mp.gameId, matchId: m.vlrId, player: row.nick,
          team: teamByTag ?? (row.tableIdx === 0 ? m.teamA : m.teamB),
          agent: row.agent, acs: row.acs, kills: row.kills, deaths: row.deaths, assists: row.assists,
          kast: row.kast, adr: row.adr, hsPct: row.hsPct, fk: row.fk, fd: row.fd, rating: row.rating,
        });
      }
    }
  }

  const statuses = matches.map((m) => m.status);
  const tournamentStatus = statuses.some((s) => s === "live") ? "live"
    : matches.length > 0 && statuses.every((s) => s === "finished") ? "finished" : "upcoming";
  const tier = inferTier(info.name, info.circuitName);
  const circuitId = info.circuitSlug?.replace(/^\//, "");

  /*
   * ── CLASIFICACIÓN FINAL ──
   *
   * De la tabla «Prize Distribution» de la página del evento salen DOS cosas, y las dos por
   * NOMBRE de equipo, que es la convención de referencias de todo este normalizador:
   *
   *   · `awards.champion` / `runnerUp` — solo si el puesto es inequívoco (ver `prizeToAwards`).
   *     Es el eslabón que le faltaba a `champion-edition`: de aquí sale `championTeamId`, y de
   *     ahí el narrativeTag `champion` que concede la variante a TODO el roster del campeón.
   *   · `standings` — una fila por puesto, que es además el camino de reserva que ya buscaba
   *     `analyzer/team.ts` (`standings[position === 1]`) cuando no hay awards.
   *
   * Sin tabla no hay nada de esto y el torneo se queda sin campeón. Es el estado correcto:
   * un torneo en curso no tiene ganador, y adivinarlo sería inventarlo.
   */
  const awards: RawAwards | undefined = placements.length
    ? { ...prizeToAwards(placements), placements: placements.map((p) => ({ position: p.position, team: p.teamName, prize: p.prize, points: p.points })) }
    : undefined;

  const standings: RawStanding[] = placements.map((p) => ({
    id: `${tournamentId}:${looseName(p.teamName)}`,
    team: p.teamName,
    position: p.position,
    points: p.points,
  }));

  /*
   * ── AGREGADOS DE TORNEO ──
   *
   * Solo se emite fila si la fuente publicó la fracción de clutch completa. Un jugador sin
   * ese dato NO aparece aquí con ceros: no tener dato y tener cero son cosas distintas, y
   * confundirlas es exactamente lo que haría que un jugador ganase el premio de clutch por
   * omisión.
   */
  const playerTournamentStats: RawPlayerTournamentStat[] = statsRows
    .filter((r) => r.clutchesWon !== undefined && r.clutchSituations !== undefined)
    .map((r) => ({
      player: r.nick,
      team: r.teamTag ? tagToTeam.get(looseName(r.teamTag)) : undefined,
      maps: r.mapsPlayed,
      rounds: r.roundsPlayed,
      clutchesWon: r.clutchesWon,
      clutchSituations: r.clutchSituations,
      clutchPct: r.clutchPct,
    }));

  return {
    brackets,
    tournament: {
      id: tournamentId,
      name: info.name,
      type: "vlr-event",
      circuitId,
      tier,
      region: inferRegion(info.name, info.circuitName, tier),
      status: tournamentStatus,
      slug: ref.slug,
      prizePool: info.prizePool,
      location: info.location,
      country: info.country,
      startDate: info.startDate,
      endDate: info.endDate,
      year: info.startDate ? +info.startDate.slice(0, 4) : undefined,
    },
    circuit: info.circuitName && circuitId
      ? { id: circuitId, name: info.circuitName, tier, scope: tier === "vct-international" ? "international" : "regional" }
      : undefined,
    stages,
    teams,
    players,
    matches,
    maps,
    mapStats,
    playerTournamentStats,
    standings,
    awards,
  };
}
