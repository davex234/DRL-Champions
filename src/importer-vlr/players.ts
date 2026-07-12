/**
 * JUGADORES — fusión PURA de las dos fuentes de la misma persona:
 *   roster de la página del evento (nick + país + EQUIPO por pertenencia) y
 *   fila de la página de stats (nick + TAG + agentes + métricas).
 * La unión por nick/vlrId también deriva el mapeo TAG→equipo ("VIT"→"Team Vitality"), que VLR
 * nunca da explícito y que hace falta para asignar equipo a las filas de scoreboard.
 */
import { looseName } from "./parser";
import type { VlrTeam, VlrStatsRow, VlrRosterPlayer, VlrMatch } from "./types";

/** Jugador unificado listo para el RawSnapshot. */
export interface VlrPlayerMerged {
  vlrId?: string;
  nick: string;
  /** Nombre del equipo (el de la tarjeta del evento). */
  team?: string;
  country?: string;
  agents: string[];
}

/**
 * TAG de VLR (clave laxa) → nombre de equipo, por voto mayoritario de DOS fuentes:
 * unión roster⋈stats y filas de scoreboard (tag bajo el nick + lado del partido).
 */
export function buildTagToTeam(teams: VlrTeam[], statsRows: VlrStatsRow[], matches: VlrMatch[] = []): Map<string, string> {
  const nickToTeam = new Map<string, string>();
  const idToTeam = new Map<string, string>();
  for (const t of teams) for (const p of t.players) {
    nickToTeam.set(looseName(p.nick), t.name);
    if (p.vlrId) idToTeam.set(p.vlrId, t.name);
  }
  const votes = new Map<string, Map<string, number>>();
  const vote = (tagRaw: string, team: string): void => {
    const tag = looseName(tagRaw);
    if (!tag || !team) return;
    const byTeam = votes.get(tag) ?? new Map<string, number>();
    byTeam.set(team, (byTeam.get(team) ?? 0) + 1);
    votes.set(tag, byTeam);
  };
  for (const r of statsRows) {
    if (!r.teamTag) continue;
    const team = (r.vlrPlayerId && idToTeam.get(r.vlrPlayerId)) ?? nickToTeam.get(looseName(r.nick));
    if (team) vote(r.teamTag, team);
  }
  for (const m of matches) for (const mp of m.maps) for (const row of mp.playerStats) {
    if (row.teamTag) vote(row.teamTag, row.tableIdx === 0 ? m.teamA : m.teamB);
  }
  const out = new Map<string, string>();
  for (const [tag, byTeam] of votes) {
    let best: string | undefined, bestVotes = 0;
    for (const [team, v] of byTeam) if (v > bestVotes) { best = team; bestVotes = v; }
    if (best) out.set(tag, best);
  }
  return out;
}

/** Lista unificada: todo el roster del evento + jugadores que solo aparecen en stats (subs). */
export function buildPlayers(teams: VlrTeam[], statsRows: VlrStatsRow[], matches: VlrMatch[] = []): VlrPlayerMerged[] {
  const tagToTeam = buildTagToTeam(teams, statsRows, matches);
  const statsByNick = new Map<string, VlrStatsRow>();
  const statsById = new Map<string, VlrStatsRow>();
  for (const r of statsRows) {
    statsByNick.set(looseName(r.nick), r);
    if (r.vlrPlayerId) statsById.set(r.vlrPlayerId, r);
  }
  const out: VlrPlayerMerged[] = [];
  const seen = new Set<string>();
  const keyOf = (p: { vlrId?: string; nick: string }): string => p.vlrId ?? `n:${looseName(p.nick)}`;

  for (const t of teams) for (const p of t.players as VlrRosterPlayer[]) {
    const stat = (p.vlrId ? statsById.get(p.vlrId) : undefined) ?? statsByNick.get(looseName(p.nick));
    const key = keyOf(p);
    if (seen.has(key) || seen.has(`n:${looseName(p.nick)}`)) continue;
    seen.add(key);
    seen.add(`n:${looseName(p.nick)}`);
    out.push({ vlrId: p.vlrId ?? stat?.vlrPlayerId, nick: p.nick, team: t.name, country: p.country ?? stat?.country, agents: stat?.agents ?? [] });
  }
  for (const r of statsRows) {
    const key = keyOf({ vlrId: r.vlrPlayerId, nick: r.nick });
    if (seen.has(key) || seen.has(`n:${looseName(r.nick)}`)) continue;
    seen.add(key);
    out.push({
      vlrId: r.vlrPlayerId, nick: r.nick,
      team: r.teamTag ? tagToTeam.get(looseName(r.teamTag)) : undefined,
      country: r.country, agents: r.agents,
    });
  }
  return out;
}
