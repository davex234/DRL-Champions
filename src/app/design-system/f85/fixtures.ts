/**
 * FIXTURES QA SYNTHETIC · F85 — solo para el arnés `/design-system/f85` y sus capturas. Reutiliza los de la Fase 29
 * (misma forma que `GET /api/game/social`) y añade lo nuevo de Social 2.0: listas grandes (0/1/20/200+), nombres
 * largos, perfil bloqueado, comparación pública y el aviso de reto recibido. Inventado y etiquetado; nunca se envía.
 */
import { sortFriends, FRIENDS_LIMIT, type Presence } from "@/domain/social/social";
import type { FriendView, SocialSnapshot, SocialPlayerView, SocialCompare, ChallengeView } from "@/server/services/social";
import { FULL, EMPTY, CHALLENGES, PLAYER_STRANGER, ME, RIVAL, QA_NOW, badges } from "../fase29/fixtures";

const D = 24 * 3600_000;
const PRES: Presence[] = ["ONLINE", "IN_MATCH", "IN_QUEUE", "OFFLINE", "OFFLINE", "OFFLINE"];
const AV = ["🐉", "🦉", "🐺", "🦅", "🐙", "🦁", "🐍", "🦋", "🐻", "🦊"];

function friends(n: number, longNames = false): FriendView[] {
  return sortFriends(Array.from({ length: n }, (_, i) => {
    const rating = i % 4 === 3 ? null : 820 + ((i * 37) % 560);
    return {
      userId: `00000000-0000-4000-8000-${String(5000 + i).padStart(12, "0")}`,
      username: longNames ? `QA_NombreMuyLargoDeJugador_${String(i).padStart(3, "0")}` : `QA-Amigo-${String(i + 1).padStart(3, "0")}`,
      avatar: AV[i % AV.length], ...badges(i, rating), presence: PRES[i % PRES.length], lastSeenAt: null, since: QA_NOW - (i + 1) * D,
      rating: rating === null ? null : { rating, gamesPlayed: 12, provisional: false },
    };
  }));
}

const withFriends = (list: FriendView[], total = list.length): SocialSnapshot => ({ ...EMPTY, friends: list, counts: { ...EMPTY.counts, friends: total }, friendsLimit: FRIENDS_LIMIT });

export const ONE = withFriends(friends(1));
export const TWENTY = withFriends(friends(20));
/** 200+ amigos: la primera página (100) y el total real → «Ver más amigos». */
export const MANY = withFriends(friends(240).slice(0, 100), 240);
export const MANY_MORE = friends(240).slice(100, 200);
export const LONG = { ...FULL, friends: friends(6, true), counts: { ...FULL.counts, friends: 6 } };

export const PLAYER_BLOCKED: SocialPlayerView = {
  ...PLAYER_STRANGER, relation: "BLOCKED_BY_ME",
  actions: { add: false, accept: false, decline: false, cancel: false, unfriend: false, challenge: false, block: false, unblock: true },
  presence: null, rating: null, rank: null,
};
export const PLAYER_LONG: SocialPlayerView = { ...PLAYER_STRANGER, player: { ...PLAYER_STRANGER.player, username: "QA_NombreMuyLargoDeJugadorQueNoCabe" } };

export const COMPARE: SocialCompare = {
  relation: "FRIENDS",
  you: { player: ME, rank: badges(3, 1032).rank, rating: 1032, seasonLevel: 14, matches: 87, winrate: 52, uniqueCards: 118, totalCards: 331, collectionsCompleted: 1, badges: 2 },
  them: { player: RIVAL, rank: badges(0, 1246).rank, rating: 1246, seasonLevel: 22, matches: 143, winrate: 58, uniqueCards: 176, totalCards: 331, collectionsCompleted: 3, badges: 3 },
};
/** Rival sin ranked ni temporada: los huecos se dicen («—»), no se rellenan. */
export const COMPARE_SPARSE: SocialCompare = {
  ...COMPARE, them: { ...COMPARE.them, player: { ...RIVAL, username: "QA_NombreMuyLargoDeJugadorQueNoCabe" }, rank: null, rating: null, seasonLevel: null, matches: 0, winrate: null, uniqueCards: 9, collectionsCompleted: 0, badges: 0 },
};

export const INCOMING_CARD: ChallengeView = CHALLENGES[0];
export const REMATCH_CARD: ChallengeView = CHALLENGES[1];
export const LONG_CARD: ChallengeView = { ...CHALLENGES[0], challenger: { ...CHALLENGES[0].challenger, username: "QA_NombreMuyLargoDeJugadorQueNoCabe" } };
