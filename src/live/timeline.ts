/**
 * LIVE ECOSYSTEM — TIMELINE / CARRERA.
 *
 * No snapshots: una línea temporal por entidad (Career → Season → Tournament → Card),
 * con la IDENTIDAD (intel) como ÚNICA AUTORIDAD: jamás dos jugadores/equipos/torneos/
 * cartas duplicados. Por TEMPORADA (no mezcla 2025/2026). PURO: estado plano, sin red.
 */
import { resolveIdentity } from "@/intel";
import type { PlayerHistory } from "@/intel";
import type { RawTournament } from "@/engine/types";

export interface CardRecord { season: number; tournamentId: string; family: string; rating: number; createdAt: number }
export interface TeamStint { teamId: string; season: number }
export interface PlayerCareer {
  id: string;          // id CANÓNICO (autoridad)
  nick: string;
  firstSeason: number;
  teams: TeamStint[];
  cards: CardRecord[];
  bestRating: number | null;
  families: string[];
}
export interface Timeline {
  players: Record<string, PlayerCareer>;
  teams: Record<string, { id: string; name: string }>;
  tournaments: Record<string, { id: string; season: number; name: string }>;
  /** Claves de carta ya acuñadas: `${playerId}:${family}:${season}` (anti-duplicado global). */
  cardKeys: Set<string>;
}

export const createTimeline = (): Timeline => ({ players: {}, teams: {}, tournaments: {}, cardKeys: new Set() });

/** Temporada (año) a partir de las fechas del torneo. */
export function seasonOf(t: RawTournament): number {
  const d = t.endDate ?? t.startDate;
  const y = d ? new Date(d).getUTCFullYear() : NaN;
  return Number.isFinite(y) ? y : new Date().getUTCFullYear();
}

/** id canónico de jugador (la autoridad). */
export const playerKey = (p: { id?: string; nick: string; realName?: string }): string =>
  resolveIdentity({ id: p.id, name: p.nick, realName: p.realName });
/** id canónico de equipo. */
export const teamKey = (t: { id?: string; name: string }): string => resolveIdentity({ id: t.id, name: t.name });

export function ensureTournament(tl: Timeline, t: RawTournament, season: number): { id: string; isNew: boolean } {
  const id = resolveIdentity({ id: t.id, name: t.name });
  const isNew = !tl.tournaments[id];
  if (isNew) tl.tournaments[id] = { id, season, name: t.name };
  return { id, isNew };
}

export function ensureTeam(tl: Timeline, raw: { id?: string; name: string }): string {
  const id = teamKey(raw);
  if (!tl.teams[id]) tl.teams[id] = { id, name: raw.name };
  return id;
}

/** Registra/actualiza al jugador. Detecta DEBUT (nuevo) y TRASPASO (cambia de equipo). */
export function ensurePlayer(
  tl: Timeline, raw: { id?: string; nick: string; realName?: string }, season: number, teamId: string,
): { id: string; isDebut: boolean; isTransfer: boolean; prevTeam: string | null } {
  const id = playerKey(raw);
  const existing = tl.players[id];
  if (!existing) {
    tl.players[id] = { id, nick: raw.nick, firstSeason: season, teams: [{ teamId, season }], cards: [], bestRating: null, families: [] };
    return { id, isDebut: true, isTransfer: false, prevTeam: null };
  }
  const prevTeam = existing.teams[existing.teams.length - 1]?.teamId ?? null;
  const isTransfer = prevTeam != null && prevTeam !== teamId;
  if (isTransfer) existing.teams.push({ teamId, season });
  return { id, isDebut: false, isTransfer, prevTeam };
}

/** Historial del jugador en el formato que consume el Card Decision (intel). */
export function historyFor(tl: Timeline, playerId: string): PlayerHistory {
  const c = tl.players[playerId];
  return { bestRating: c?.bestRating ?? null, ownsFamilies: c?.families ?? [] };
}

/** ¿Ya existe esta carta exacta? (jugador+familia+temporada). */
export const hasCard = (tl: Timeline, playerId: string, family: string, season: number): boolean =>
  tl.cardKeys.has(`${playerId}:${family}:${season}`);

/** Acuña una carta en la carrera. Devuelve isDuplicate si ya existía (no la duplica). */
export function recordCard(tl: Timeline, playerId: string, rec: CardRecord): { isDuplicate: boolean } {
  const key = `${playerId}:${rec.family}:${rec.season}`;
  if (tl.cardKeys.has(key)) return { isDuplicate: true };
  tl.cardKeys.add(key);
  const c = tl.players[playerId];
  if (c) {
    c.cards.push(rec);
    if (!c.families.includes(rec.family)) c.families.push(rec.family);
    c.bestRating = Math.max(c.bestRating ?? 0, rec.rating);
  }
  return { isDuplicate: false };
}
