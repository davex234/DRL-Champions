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

/**
 * Fila de `players`. El sync daba de alta equipos pero NO jugadores, y
 * `map_player_stats.player_id` tiene FK real contra `players(id)`: sin esta fila, escribir un
 * scoreboard real falla. Es el paso que faltaba, no una tabla nueva.
 */
export function playerRow(r: { id: string; nick: string; full_name?: string | null; team_id?: string | null; region?: string | null; role?: string | null; country?: string | null; status?: string }) {
  return {
    id: r.id, nick: r.nick, full_name: r.full_name ?? null, team_id: r.team_id ?? null,
    region: r.region ?? null, role: r.role ?? null, country: r.country ?? null,
    status: r.status ?? "active",
  };
}

/**
 * `nameOf` traduce id → nombre legible para las columnas LEGACY `team_a`/`team_b`/`winner_team`.
 *
 * No es cosmético: `pickemLifecycle` construye los enunciados leyendo ESAS columnas. Antes se
 * escribía en ellas el id del equipo, así que un Pick'em real habría preguntado «¿quién gana
 * vlr-t-2593 vs vlr-t-1001?». La semilla siempre guardó ahí el nombre; esto hace que la
 * sincronización guarde lo mismo. Pick'ems no se toca: se le entrega el dato correcto.
 */
export function matchRow(r: RawMatch, stageId: string | null, nameOf?: (teamId: string) => string | undefined) {
  const best = r.bestOf ?? (r.format === "bo5" ? 5 : r.format === "bo1" ? 1 : 3);
  const label = (id: string | undefined): string | null => (id ? nameOf?.(id) ?? id : null);
  return {
    id: r.id, event_id: r.eventId, stage_id: stageId,
    team_a_id: r.teamAId, team_b_id: r.teamBId,
    team_a: label(r.teamAId), team_b: label(r.teamBId), // legacy (0002): NOMBRE legible
    start_time: iso(r.startTime), status: normalizeStatus(r.status),
    format: r.format ?? "bo3", best_of: best, round: r.round ?? null,
    match_order: r.matchOrder ?? null, score_a: r.scoreA ?? null, score_b: r.scoreB ?? null,
    winner_team_id: r.winnerTeamId ?? null, winner_team: label(r.winnerTeamId),
    mvp_player_id: r.mvpPlayerId ?? null, patch: r.patch ?? null,
    vod_url: r.vodUrl ?? null, vlr_url: r.vlrUrl ?? null,
  };
}

/**
 * Fase 24.4 · fila PARCIAL de `matches` con la estructura confirmada del cuadro, o `null`.
 *
 * Va aparte de `matchRow` a propósito: el upsert de partidos NO lleva estas columnas, así que
 * una reimportación que no encuentre el cuadro (markup cambiado, página parcial) no borra la
 * estructura ya confirmada. Solo se escribe lo CONFIRMED; lo desconocido no toca nada.
 */
export function progressionRow(m: RawMatch, now = new Date()): Record<string, unknown> | null {
  const p = m.progression;
  if (!p || p.confidence !== "CONFIRMED") return null;
  if (!p.winnerTo && !p.loserTo && !p.winnerQualifies) return null;
  if (p.winnerTo?.matchId === m.id || p.loserTo?.matchId === m.id) return null; // autoarista: nunca
  return {
    id: m.id,
    winner_to_match_id: p.winnerTo?.matchId ?? null,
    winner_to_slot: p.winnerTo?.slot ?? null,
    loser_to_match_id: p.loserTo?.matchId ?? null,
    loser_to_slot: p.loserTo?.slot ?? null,
    winner_qualifies: p.winnerQualifies?.key ?? null,
    winner_qualifies_label: p.winnerQualifies?.label ?? null,
    progression_evidence: p.evidence,
    progression_confidence: "CONFIRMED",
    progression_version: p.version ?? null,
    progression_synced_at: now.toISOString(),
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
    // `adr` medido si la fuente lo publica (vlr.gg lo da por ronda y no da daño total),
    // derivado si no. Mismo criterio que ya se aplicaba a `acs` y `kast`.
    assists: p.assists ?? null, kast: p.kast ?? (d.kast || null), adr: p.adr ?? (d.adr || null),
    hs_pct: p.hsPct ?? null, fk: p.fk ?? null, fd: p.fd ?? null,
    clutches: p.clutches ?? null, plus_minus: d.plusMinus, rating: d.rating,
  };
}
