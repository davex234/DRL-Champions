/**
 * SOCIAL 1.0 — DOMINIO PURO (Fase 29) · F85 SOCIAL 2.0 (bloqueo por dirección, presencia de servidor, límites, reto de 5 min).
 *
 * Amistades, bloqueos, retos y presencia como LECTURAS sobre lo que el servidor persiste
 * (`duel_friendships`, `duel_challenges`, `profiles.last_seen_at`, `duel_matches`). Aquí no se decide
 * ninguna transición: eso lo hacen las RPC atómicas. Se traduce, se ordena, se deriva.
 *
 * Sin React, sin red, sin reloj implícito.
 */
import { outcomeFor, sideOf, letterOf, type MatchFacts } from "@/domain/pvpLadder/ladder";

/* ───────────────────────────── amistad ───────────────────────────── */

export type FriendshipStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "BLOCKED";

export interface FriendshipRow {
  userLo: string;
  userHi: string;
  requesterId: string;
  status: FriendshipStatus;
  blockedBy: string | null;
  createdAt: number;
  respondedAt: number | null;
}

/** Cómo veo a otro jugador. Es lo que decide qué botón sale en su perfil. */
export type RelationState = "NONE" | "OUTGOING" | "INCOMING" | "FRIENDS" | "BLOCKED_BY_ME" | "BLOCKED_ME" | "SELF";

export const RELATION_LABEL: Record<RelationState, string> = {
  NONE: "Añadir amigo", OUTGOING: "Solicitud enviada", INCOMING: "Aceptar", FRIENDS: "Amigos",
  BLOCKED_BY_ME: "Bloqueado", BLOCKED_ME: "No disponible", SELF: "Tú",
};

/** Par canónico: `lo < hi`. Nunca `a === b`. */
export function pairKey(a: string, b: string): { lo: string; hi: string } | null {
  if (!a || !b || a === b) return null;
  return a < b ? { lo: a, hi: b } : { lo: b, hi: a };
}

/**
 * F85 · los bloqueos viven en `social_blocks` (uno por dirección; 0066). `blocks` dice si YO bloqueé y si EL OTRO me
 * bloqueó; un bloqueo manda sobre cualquier fila de amistad (que en la BD ya no puede coexistir con él).
 */
export interface BlockFacts { byMe: boolean; byThem: boolean }

export function relationFor(row: FriendshipRow | null, me: string, other: string, blocks: BlockFacts = { byMe: false, byThem: false }): RelationState {
  if (me === other) return "SELF";
  if (blocks.byMe) return "BLOCKED_BY_ME";
  if (blocks.byThem) return "BLOCKED_ME";
  if (!row) return "NONE";
  switch (row.status) {
    case "ACCEPTED": return "FRIENDS";
    case "PENDING": return row.requesterId === me ? "OUTGOING" : "INCOMING";
    case "BLOCKED": return row.blockedBy === me ? "BLOCKED_BY_ME" : "BLOCKED_ME";
    default: return "NONE";
  }
}

/** Acciones sociales permitidas para una relación. Un bloqueo apaga todo lo demás. */
export function actionsFor(r: RelationState): { add: boolean; accept: boolean; decline: boolean; cancel: boolean; unfriend: boolean; challenge: boolean; block: boolean; unblock: boolean } {
  return {
    add: r === "NONE",
    accept: r === "INCOMING",
    decline: r === "INCOMING",
    cancel: r === "OUTGOING",
    unfriend: r === "FRIENDS",
    challenge: r === "FRIENDS",
    block: r === "NONE" || r === "OUTGOING" || r === "INCOMING" || r === "FRIENDS",
    unblock: r === "BLOCKED_BY_ME",
  };
}

/** Solo amigos pueden retarse (decisión de la fase: reduce el spam). */
export const canChallenge = (r: RelationState): boolean => r === "FRIENDS";

/* ───────────────────────────── presencia ───────────────────────────── */

/**
 * F85 · PRESENCIA CON SEMÁNTICA EXPLÍCITA (solo la ven los amigos):
 *   EN PARTIDA  → tiene una partida PvP/privada VIVA (ciclo de vida canónico de `duel_matches`; no depende del latido).
 *   EN COLA     → búsqueda ranked viva (F76: QUEUED/PAIRING sin caducar) Y latido fresco (la entrada de cola dura hasta
 *                 10 min aunque se cierre la pestaña: sin latido no se afirma que siga buscando).
 *   EN LÍNEA    → último latido hace < 2 min. El pulso sale de CUALQUIER pestaña visible de la app cada 20 s (y escribe el
 *                 latido como mucho cada 40 s): dos pestañas o dos dispositivos mantienen el mismo `last_seen_at`; cerrar una no desconecta; si el navegador muere,
 *                 el TTL (2 min) lo pone desconectado. No hay «visto hace…» ni «activo recientemente».
 *   DESCONECTADO → lo demás.
 */
export type Presence = "IN_MATCH" | "IN_QUEUE" | "ONLINE" | "OFFLINE";

/** Ventana de «en línea» desde el último latido (TTL). */
export const PRESENCE_WINDOWS = { onlineMs: 2 * 60_000 } as const;

export const PRESENCE_LABEL: Record<Presence, string> = { IN_MATCH: "En partida", IN_QUEUE: "En cola ranked", ONLINE: "En línea", OFFLINE: "Desconectado" };

export function presenceOf(lastSeenAt: number | null, now: number, live: { inMatch?: boolean; inQueue?: boolean } = {}): Presence {
  if (live.inMatch) return "IN_MATCH";
  const fresh = lastSeenAt !== null && Number.isFinite(lastSeenAt) && now - lastSeenAt < PRESENCE_WINDOWS.onlineMs;
  if (live.inQueue && fresh) return "IN_QUEUE";
  return fresh ? "ONLINE" : "OFFLINE";
}

/**
 * Pulso: cada 20 s con la pestaña visible. Es lo que tarda, como mucho, en llegar un reto o una solicitud sin recargar
 * (F85 medido en producción con 45 s: 41,7 s de entrega; demasiado para un reto de 5 min).
 */
export const HEARTBEAT_MS = 20_000;
/** Con un reto MÍO esperando respuesta, el pulso se relee cada 5 s (entrar en la partida en segundos al ser aceptado). */
export const OUTGOING_POLL_MS = 5_000;
/**
 * El servidor solo escribe `last_seen_at` si el anterior tiene ≥ 40 s: el pulso es de LECTURA cada 20 s, pero escribe como
 * mucho una vez cada ~40–60 s por jugador (varias pestañas o dispositivos no multiplican escrituras). El latido más viejo de
 * una pestaña viva es `HEARTBEAT_WRITE_MIN_MS + HEARTBEAT_MS` (60 s) < TTL (2 min): nunca parpadea a desconectado.
 */
export const HEARTBEAT_WRITE_MIN_MS = 40_000;

const PRESENCE_RANK: Record<Presence, number> = { IN_MATCH: 0, IN_QUEUE: 1, ONLINE: 2, OFFLINE: 3 };

export interface FriendLike { username: string; presence: Presence }

/** Orden: en partida → en cola → en línea → desconectado → nombre. Determinista; sin «ranking» de amigos. */
export function sortFriends<T extends FriendLike>(list: T[]): T[] {
  return [...list].sort((a, b) => PRESENCE_RANK[a.presence] - PRESENCE_RANK[b.presence] || a.username.localeCompare(b.username));
}

/* ───────────────────────────── límites (espejo de 0066) ───────────────────────────── */

/** Amigos aceptados por jugador. */
export const FRIENDS_LIMIT = 300;
/** Solicitudes salientes pendientes a la vez. */
export const OUTGOING_PENDING_LIMIT = 50;
/** Retos creados por la misma pareja (retador → retado) en una hora. */
export const CHALLENGE_PAIR_PER_HOUR = 10;
/** Amigos por página en el hub (la primera viaja en la foto). */
export const FRIENDS_PAGE = 100;

/* ───────────────────────────── retos ───────────────────────────── */

export type ChallengeStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED" | "MATCHED";

/**
 * F85 · TTL de un reto: 5 minutos (antes 24 h). Un reto es una invitación a jugar AHORA: caduca por el reloj de la BD
 * (`expires_at`, evaluado al leer y al aceptar). Para retar a quien no está conectado, se le reta cuando lo esté.
 */
export const CHALLENGE_TTL_SECONDS = 5 * 60;

export interface ChallengeRow {
  id: string;
  challengerId: string;
  challengedId: string;
  status: ChallengeStatus;
  matchId: string | null;
  previousMatchId: string | null;
  createdAt: number;
  expiresAt: number;
  respondedAt: number | null;
}

/** Estado EFECTIVO: un PENDING con `expiresAt` pasado ya está caducado aunque la fila no se haya tocado. */
export function effectiveStatus(c: Pick<ChallengeRow, "status" | "expiresAt">, now: number): ChallengeStatus {
  if (c.status === "PENDING" && c.expiresAt <= now) return "EXPIRED";
  return c.status;
}

export const CHALLENGE_LABEL: Record<ChallengeStatus, string> = {
  PENDING: "Pendiente", ACCEPTED: "Aceptado", DECLINED: "Rechazado", EXPIRED: "Caducado", CANCELLED: "Cancelado", MATCHED: "En partida",
};

export type ChallengeDirection = "INCOMING" | "OUTGOING";

export const directionOf = (c: Pick<ChallengeRow, "challengerId" | "challengedId">, me: string): ChallengeDirection | null =>
  c.challengedId === me ? "INCOMING" : c.challengerId === me ? "OUTGOING" : null;

/** Qué puede hacer `me` con un reto, según su estado efectivo y su dirección. */
export function challengeActions(c: ChallengeRow, me: string, now: number): { accept: boolean; decline: boolean; cancel: boolean; open: boolean } {
  const s = effectiveStatus(c, now);
  const dir = directionOf(c, me);
  return {
    accept: s === "PENDING" && dir === "INCOMING",
    decline: s === "PENDING" && dir === "INCOMING",
    cancel: s === "PENDING" && dir === "OUTGOING",
    open: (s === "ACCEPTED" || s === "MATCHED") && c.matchId !== null && dir !== null,
  };
}

/* ───────────────────────────── bandeja y badge ───────────────────────────── */

export interface InboxItem {
  id: string;
  kind: "FRIEND_REQUEST" | "CHALLENGE" | "CHALLENGE_ACCEPTED" | "FRIEND_ACCEPTED";
  who: { userId: string; username: string; avatar: string };
  at: number;
  /** Solo para retos. */
  challengeId?: string;
  matchId?: string | null;
}

/** Lo pendiente de MI acción: solicitudes recibidas + retos recibidos pendientes. Más reciente primero. */
export function inboxOf(input: {
  incomingRequests: { userId: string; username: string; avatar: string; at: number }[];
  challenges: (ChallengeRow & { challenger: { userId: string; username: string; avatar: string }; challenged: { userId: string; username: string; avatar: string } })[];
  me: string;
  now: number;
}): InboxItem[] {
  const items: InboxItem[] = input.incomingRequests.map((r) => ({ id: `req:${r.userId}`, kind: "FRIEND_REQUEST", who: r, at: r.at }));
  for (const c of input.challenges) {
    const s = effectiveStatus(c, input.now);
    const dir = directionOf(c, input.me);
    if (dir === "INCOMING" && s === "PENDING") items.push({ id: `ch:${c.id}`, kind: "CHALLENGE", who: c.challenger, at: c.createdAt, challengeId: c.id, matchId: c.matchId });
    if (dir === "OUTGOING" && (s === "ACCEPTED" || s === "MATCHED")) items.push({ id: `chok:${c.id}`, kind: "CHALLENGE_ACCEPTED", who: c.challenged, at: c.respondedAt ?? c.createdAt, challengeId: c.id, matchId: c.matchId });
  }
  return items.sort((a, b) => b.at - a.at);
}

/** El número de la navegación: solicitudes recibidas + retos recibidos pendientes. */
export const badgeCount = (items: InboxItem[]): number => items.filter((i) => i.kind === "FRIEND_REQUEST" || i.kind === "CHALLENGE").length;

/* ───────────────────────────── búsqueda ───────────────────────────── */

export const SEARCH_MIN = 2;
export const SEARCH_LIMIT = 10;
/** F85 · páginas de búsqueda: como mucho 5 (50 resultados) por consulta: sin rastreo masivo. */
export const SEARCH_MAX_OFFSET = 40;

/**
 * Normaliza la consulta: recorta, minúsculas, sin `%` ni `\` (ni separadores de PostgREST); `null` si es corta.
 * F85 · el `_` SE CONSERVA: es un carácter legítimo de los nombres (`qa_campaign_…`). Antes se borraba y «qa_camp» no
 * encontraba a nadie; ahora es un literal que `likePrefix` escapa (no actúa como comodín de un carácter).
 */
export function normalizeQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const s = q.trim().toLowerCase().replace(/[%\\,()*]/g, "").slice(0, 32);
  if (s.length < SEARCH_MIN) return null;
  // Nunca se busca por correo: un «@» no es un nombre de usuario.
  if (s.includes("@")) return null;
  return s;
}

/** F85 · patrón `ilike` de PREFIJO para una consulta ya normalizada: el `_` va escapado (literal, no comodín). */
export const likePrefix = (q: string): string => `${q.replace(/_/g, "\\_")}%`;

/* ───────────────────────────── cara a cara ───────────────────────────── */

export interface H2H { wins: number; losses: number; draws: number; matches: number }

export interface H2HSplit { ranked: H2H; private: H2H; total: H2H }

const empty = (): H2H => ({ wins: 0, losses: 0, draws: 0, matches: 0 });

/** RANKED / PRIVADOS / TOTAL desde mi perspectiva, sin mezclar en silencio. */
export function h2hSplit(matches: (MatchFacts & { mode: "PVP" | "PVP_PRIVATE" | "PVE" })[], me: string, rival: string): H2HSplit {
  const out: H2HSplit = { ranked: empty(), private: empty(), total: empty() };
  for (const m of matches) {
    const s = sideOf(m, me); const r = sideOf(m, rival);
    if (!s || !r || s === r) continue;
    const l = letterOf(outcomeFor(m, me));
    if (!l) continue;
    const buckets = m.mode === "PVP" ? [out.ranked, out.total] : m.mode === "PVP_PRIVATE" ? [out.private, out.total] : [];
    for (const b of buckets) { b.matches++; if (l === "W") b.wins++; else if (l === "L") b.losses++; else b.draws++; }
  }
  return out;
}

export const h2hText = (h: H2H): string => `${h.wins}–${h.losses}${h.draws > 0 ? `–${h.draws}` : ""}`;

/* ───────────────────────────── rivales recientes ───────────────────────────── */

/** Últimos rivales ÚNICOS por orden de la partida más reciente. */
export function recentOpponents(matches: { at: number; rivalId: string }[], max = 8): { rivalId: string; lastAt: number; games: number }[] {
  const by = new Map<string, { rivalId: string; lastAt: number; games: number }>();
  for (const m of [...matches].sort((a, b) => b.at - a.at)) {
    if (!m.rivalId) continue;
    const cur = by.get(m.rivalId);
    if (cur) cur.games++; else by.set(m.rivalId, { rivalId: m.rivalId, lastAt: m.at, games: 1 });
  }
  return [...by.values()].slice(0, max);
}

/* ───────────────────────────── actividad (derivada, sin texto libre) ───────────────────────────── */

export type ActivityKind = "FRIENDS_NOW" | "PRIVATE_DUEL" | "RANKED_DUEL";

export interface ActivityItem { id: string; kind: ActivityKind; who: string; at: number; letter?: "W" | "L" | "D" | null }

export const ACTIVITY_LABEL: Record<ActivityKind, (who: string, letter?: "W" | "L" | "D" | null) => string> = {
  FRIENDS_NOW: (who) => `Ahora sois amigos: ${who}`,
  PRIVATE_DUEL: (who, l) => `Duelo privado contra ${who}${l === "W" ? " · victoria" : l === "L" ? " · derrota" : l === "D" ? " · empate" : ""}`,
  RANKED_DUEL: (who, l) => `Ranked contra ${who}${l === "W" ? " · victoria" : l === "L" ? " · derrota" : l === "D" ? " · empate" : ""}`,
};

export function activityOf(input: {
  friendships: { username: string; respondedAt: number | null; status: FriendshipStatus }[];
  matches: { id: string; at: number; rivalName: string; mode: "PVP" | "PVP_PRIVATE" | "PVE"; letter: "W" | "L" | "D" | null }[];
  max?: number;
}): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const f of input.friendships) if (f.status === "ACCEPTED" && f.respondedAt) items.push({ id: `f:${f.username}`, kind: "FRIENDS_NOW", who: f.username, at: f.respondedAt });
  for (const m of input.matches) if (m.mode !== "PVE") items.push({ id: `m:${m.id}`, kind: m.mode === "PVP" ? "RANKED_DUEL" : "PRIVATE_DUEL", who: m.rivalName, at: m.at, letter: m.letter });
  return items.sort((a, b) => b.at - a.at).slice(0, input.max ?? 8);
}
