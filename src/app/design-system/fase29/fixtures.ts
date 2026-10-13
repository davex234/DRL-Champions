/**
 * FIXTURES QA SYNTHETIC · FASE 29 — solo para el arnés `/design-system/fase29` y sus capturas.
 * Misma forma que `GET /api/game/social` (snapshot, búsqueda, perfil social, partida privada);
 * jugadores, amistades, retos y presencias INVENTADOS y etiquetados. Nunca se escriben ni se envían.
 * Las relaciones, estados de reto y bandeja usan el vocabulario real del dominio (`domain/social`).
 */
import { inboxOf, sortFriends, activityOf, CHALLENGE_TTL_SECONDS, PRESENCE_WINDOWS, FRIENDS_LIMIT, type Presence, type ChallengeStatus } from "@/domain/social/social";
import type {
  SocialSnapshot, SocialPlayer, FriendView, RequestView, ChallengeView, RecentOpponentView, SearchHit, SocialPlayerView, PrivateMatchInfo, SocialBadges,
} from "@/server/services/social";
// F85 · rango F84 y equipo favorito F89 en las filas (mismas funciones puras que el servidor).
import { deriveRank, rankChip } from "@/domain/ranked/config";
import { teamFact } from "@/domain/profile/favoriteTeam";

export const QA_NOW = Date.UTC(2026, 8, 14, 15, 30);
const MIN = 60_000, H = 3600_000, D = 24 * H;

const NAMES = ["Kaelis", "Nyra", "Brann", "Sable", "Orion", "Lume", "Tarek", "Ivy", "Rook", "Zephyr", "Mira", "Dax", "Sol", "Kira"];
const AV = ["🐉", "🦉", "🐺", "🦅", "🐙", "🦁", "🐍", "🦋", "🐻", "🦊", "🐬", "🦄", "🐝", "🦈"];

export const ME: SocialPlayer = { userId: "00000000-0000-4000-8000-0000000000aa", username: "QA · tú", avatar: "🎮" };
const player = (i: number): SocialPlayer => ({ userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, username: NAMES[i % NAMES.length], avatar: AV[i % AV.length] });
export const RIVAL = player(0); // Kaelis

/** F85 · rango sintético: clasificado si tiene rating, si no, colocación 2/5. Equipo favorito solo en algunos. */
const TEAMS = ["fnatic", "g2", null, "sentinels", null, "paper-rex", null];
export function badges(i: number, rating: number | null): SocialBadges {
  const t = TEAMS[i % TEAMS.length];
  const team = t ? teamFact(t) : null;
  return {
    rank: rating === null ? { state: "PLACEMENT", label: "Colocación 2/5", rank: null } : { state: "RANKED", label: deriveRank(rating).label, rank: rankChip(deriveRank(rating)) },
    team: team ? { id: team.id, name: team.name, tag: team.tag, logo: team.logo } : null,
  };
}

const friend = (i: number, presence: Presence, rating: number | null, sinceDays: number): FriendView => ({
  ...player(i), ...badges(i, rating), presence, lastSeenAt: null, since: QA_NOW - sinceDays * D,
  rating: rating === null ? null : { rating, gamesPlayed: rating > 1100 ? 24 : 6, provisional: rating <= 1100 },
});

export const FRIENDS: FriendView[] = sortFriends([
  friend(0, "ONLINE", 1246, 30),
  friend(1, "IN_MATCH", 1187, 12),
  friend(2, "IN_QUEUE", null, 3),
  friend(3, "ONLINE", 1032, 40),
  friend(4, "OFFLINE", 1301, 60),
  friend(5, "OFFLINE", 998, 5),
  friend(6, "OFFLINE", null, 90),
]);

const challenge = (i: number, dir: "INCOMING" | "OUTGOING", status: ChallengeStatus, ageMin: number, over: Partial<ChallengeView> = {}): ChallengeView => {
  const other = player(i);
  const createdAt = QA_NOW - ageMin * MIN;
  const expiresAt = createdAt + CHALLENGE_TTL_SECONDS * 1000;
  const pending = status === "PENDING";
  return {
    id: `00000000-0000-4000-8000-00000000c${String(i).padStart(3, "0")}`,
    status, direction: dir,
    challenger: dir === "INCOMING" ? other : ME, challenged: dir === "INCOMING" ? ME : other,
    matchId: status === "MATCHED" || status === "ACCEPTED" ? `00000000-0000-4000-8000-00000000d${String(i).padStart(3, "0")}` : null,
    previousMatchId: null, createdAt, expiresAt, respondedAt: pending ? null : createdAt + 5 * MIN,
    actions: { accept: pending && dir === "INCOMING", decline: pending && dir === "INCOMING", cancel: pending && dir === "OUTGOING", open: (status === "MATCHED" || status === "ACCEPTED") },
    rivalRank: badges(i, 1100 + i * 40).rank, matchLive: status === "MATCHED" || status === "ACCEPTED",
    ...over,
  };
};

export const CHALLENGES: ChallengeView[] = [
  // F85 · un reto dura 5 min: las edades se miden en SEGUNDOS para los pendientes.
  challenge(0, "INCOMING", "PENDING", 1),
  challenge(3, "INCOMING", "PENDING", 3, { previousMatchId: "00000000-0000-4000-8000-00000000d999" }),
  challenge(1, "OUTGOING", "PENDING", 2),
  challenge(4, "OUTGOING", "MATCHED", 90),
  challenge(2, "OUTGOING", "DECLINED", 6 * 60),
  challenge(5, "INCOMING", "EXPIRED", 2 * 24 * 60),
  challenge(6, "OUTGOING", "CANCELLED", 3 * 24 * 60),
];

export const INCOMING: RequestView[] = [
  { player: player(7), at: QA_NOW - 8 * MIN, ...badges(7, 1150) },
  { player: player(8), at: QA_NOW - 5 * H, ...badges(8, null) },
];
export const OUTGOING: RequestView[] = [{ player: player(9), at: QA_NOW - 2 * D, ...badges(9, 1010) }];
export const BLOCKED: SocialPlayer[] = [player(10)];

export const RECENT: RecentOpponentView[] = [
  // F85 · presencia solo de amigos (los demás, `null`).
  { ...player(11), ...badges(11, 1188), lastAt: QA_NOW - 35 * MIN, games: 3, relation: "NONE", presence: null },
  { ...player(0), ...badges(0, 1246), lastAt: QA_NOW - 2 * H, games: 5, relation: "FRIENDS", presence: "ONLINE" },
  { ...player(12), ...badges(12, 970), lastAt: QA_NOW - D, games: 1, relation: "OUTGOING", presence: null },
  { ...player(13), ...badges(13, null), lastAt: QA_NOW - 3 * D, games: 2, relation: "INCOMING", presence: null },
];

function snapshot(over: Partial<SocialSnapshot> = {}): SocialSnapshot {
  const friends = over.friends ?? FRIENDS;
  const incoming = over.incoming ?? INCOMING;
  const outgoing = over.outgoing ?? OUTGOING;
  const blocked = over.blocked ?? BLOCKED;
  const challenges = over.challenges ?? CHALLENGES;
  const recentOpponents = over.recentOpponents ?? RECENT;
  const inbox = inboxOf({
    incomingRequests: incoming.map((r) => ({ ...r.player, at: r.at })),
    challenges: challenges.map((c) => ({ ...c, challengerId: c.challenger.userId, challengedId: c.challenged.userId })),
    me: ME.userId, now: QA_NOW,
  });
  const activity = activityOf({
    friendships: friends.map((f) => ({ username: f.username, respondedAt: f.since, status: "ACCEPTED" as const })),
    matches: recentOpponents.map((o, i) => ({ id: `m${i}`, at: o.lastAt, rivalName: o.username, mode: i % 2 ? "PVP" as const : "PVP_PRIVATE" as const, letter: (["W", "L", "D"] as const)[i % 3] })),
  });
  return {
    self: ME,
    selfTag: "7K4M92X", // F86.2 · mi #TAG en la cabecera social (fixture QA)
    counts: {
      friends: friends.length, incoming: incoming.length, outgoing: outgoing.length,
      challengesIn: challenges.filter((c) => c.status === "PENDING" && c.direction === "INCOMING").length,
      challengesOut: challenges.filter((c) => c.status === "PENDING" && c.direction === "OUTGOING").length,
      blocked: blocked.length,
    },
    friends, incoming, outgoing, blocked, challenges, recentOpponents,
    inbox, badge: inbox.filter((i) => i.kind === "FRIEND_REQUEST" || i.kind === "CHALLENGE").length, activity,
    serverNow: QA_NOW, presenceWindows: { ...PRESENCE_WINDOWS }, challengeTtlSeconds: CHALLENGE_TTL_SECONDS,
    friendsLimit: FRIENDS_LIMIT, version: "qa",
    ...over,
  };
}

/** Jugador con vida social: amigos en los tres estados, bandeja llena, retos de todos los tipos. */
export const FULL = snapshot();
/** Primera vez: sin amigos, sin solicitudes, sin retos, sin rivales. */
export const EMPTY = snapshot({ friends: [], incoming: [], outgoing: [], blocked: [], challenges: [], recentOpponents: [] });
/** Solo amigos, sin nada pendiente (bandeja vacía, badge 0). */
export const QUIET = snapshot({ incoming: [], outgoing: [], blocked: [], challenges: [CHALLENGES[3], CHALLENGES[4]] });
/** Rivales recientes sin ser amigos aún (el camino «añadir tras un duelo»). */
export const AFTER_DUEL = snapshot({ friends: [], incoming: [], outgoing: [], challenges: [], recentOpponents: RECENT.map((r) => ({ ...r, relation: "NONE" as const })) });

/** 0068 · tags QA SYNTHETIC con formato canónico (no son de cuentas reales). */
export const SEARCH_HITS: SearchHit[] = [
  { ...player(0), ...badges(0, 1246), relation: "FRIENDS", presence: "ONLINE", rating: { rating: 1246, gamesPlayed: 24, provisional: false }, tag: "K7M2QXA" },
  { ...player(7), ...badges(7, 1150), relation: "INCOMING", presence: null, rating: null, tag: "R4HN9TB" },
  { ...player(9), ...badges(9, 1010), relation: "OUTGOING", presence: null, rating: { rating: 1010, gamesPlayed: 4, provisional: true }, tag: "W8C3PZE" },
  { ...player(11), ...badges(11, 1188), relation: "NONE", presence: null, rating: { rating: 1188, gamesPlayed: 15, provisional: false }, tag: "G5VJ6UD" },
  { ...player(10), ...badges(10, null), relation: "BLOCKED_BY_ME", presence: null, rating: null, tag: "Y2FS7KM" },
];

const h2h = (rw: number, rl: number, rd: number, pw: number, pl: number, pd: number) => ({
  ranked: { wins: rw, losses: rl, draws: rd, matches: rw + rl + rd },
  private: { wins: pw, losses: pl, draws: pd, matches: pw + pl + pd },
  total: { wins: rw + pw, losses: rl + pl, draws: rd + pd, matches: rw + rl + rd + pw + pl + pd },
});

const rating = (r: number, g: number) => ({ rating: r, gamesPlayed: g, wins: Math.round(g * 0.55), losses: Math.round(g * 0.4), draws: g - Math.round(g * 0.55) - Math.round(g * 0.4), provisional: g < 10, updatedAt: QA_NOW - 3 * H });

/** Perfil social de un AMIGO con reto recibido pendiente y cara a cara mixto. */
export const PLAYER_FRIEND: SocialPlayerView = {
  player: RIVAL, relation: "FRIENDS",
  actions: { add: false, accept: false, decline: false, cancel: false, unfriend: true, challenge: true, block: true, unblock: false },
  presence: "ONLINE", lastSeenAt: null, rating: rating(1246, 24), rank: badges(0, 1246).rank,
  h2h: h2h(3, 2, 0, 4, 1, 1), pendingChallenge: CHALLENGES[0],
  recentPrivate: [
    { matchId: "00000000-0000-4000-8000-00000000e001", at: QA_NOW - 2 * H, letter: "W", scoreYou: 6, scoreRival: 4 },
    { matchId: "00000000-0000-4000-8000-00000000e002", at: QA_NOW - D, letter: "L", scoreYou: 3, scoreRival: 7 },
    { matchId: "00000000-0000-4000-8000-00000000e003", at: QA_NOW - 3 * D, letter: "D", scoreYou: 5, scoreRival: 5 },
  ],
  friendsSince: QA_NOW - 30 * D,
};

/** Perfil social de un DESCONOCIDO: solo «Añadir amigo» y «Bloquear»; sin cara a cara. */
export const PLAYER_STRANGER: SocialPlayerView = {
  player: player(11), relation: "NONE",
  actions: { add: true, accept: false, decline: false, cancel: false, unfriend: false, challenge: false, block: true, unblock: false },
  presence: null, lastSeenAt: null, rating: rating(1188, 15), rank: badges(11, 1188).rank,
  h2h: h2h(1, 0, 0, 0, 0, 0), pendingChallenge: null, recentPrivate: [], friendsSince: null,
};

/** Solicitud enviada, esperando: el botón es solo estado. */
export const PLAYER_SENT: SocialPlayerView = {
  ...PLAYER_STRANGER, player: player(9), relation: "OUTGOING",
  actions: { add: false, accept: false, decline: false, cancel: true, unfriend: false, challenge: false, block: true, unblock: false },
  presence: null, lastSeenAt: null, rating: rating(1010, 4), rank: badges(9, 1010).rank, h2h: h2h(0, 0, 0, 0, 0, 0),
};

/** La partida privada: quién hay enfrente y el cara a cara para la arena y el resultado. */
export const PRIVATE_INFO: PrivateMatchInfo = {
  matchId: "00000000-0000-4000-8000-00000000d004", mode: "PVP_PRIVATE",
  you: ME, rival: RIVAL, relation: "FRIENDS", h2h: h2h(3, 2, 0, 5, 1, 1), closedBySide: null, yourSide: "A",
  challengeId: CHALLENGES[3].id, cup: null,
};
