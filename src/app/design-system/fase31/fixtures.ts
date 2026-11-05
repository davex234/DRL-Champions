/**
 * FIXTURES QA SYNTHETIC · FASE 31 — solo para el arnés `/design-system/fase31` y sus capturas.
 * Jugadores, ratings, logros reclamados y ejemplares INVENTADOS; las cartas son definiciones REALES
 * del catálogo (para pintar con `PlayerCard`) con uids y series ficticios. La foto se construye con
 * la MISMA función del servidor (`buildPlayerIdentity`). Las rutas reales NO usan estos datos.
 */
import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { OwnedCard, VariantId } from "@/domain/cards/types";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { buildPlayerIdentity, type IdentityFacts, type CardLookup, type PlayerIdentitySnapshot } from "@/domain/profile/identity";

export const QA_NOW = Date.UTC(2026, 8, 14, 18, 30);
const D = 86_400_000;

export const SELF_ID = "00000000-0000-4000-8000-0000000000aa";
export const RIVAL_ID = "00000000-0000-4000-8000-0000000000bb";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export const lookup: CardLookup = (cardId) => {
  const def = CARD_BY_ID.get(cardId);
  if (!def) return null;
  const p = getPlayer(def.playerId);
  const v = getVariant(def.variantId as VariantId);
  if (!p || !v) return null;
  return { cardId, variantId: def.variantId, variantLabel: v.label, rank: v.rank, serialLimit: v.serialLimit ?? null, ovr: def.ovr, nick: p.nick, team: p.team ?? null, role: p.role ?? null, glow: v.palette.primary };
};
export const rankOf = (cardId: string) => { const d = CARD_BY_ID.get(cardId); return d ? getVariant(d.variantId as VariantId).rank : null; };

/** Cartas reales ordenadas por rareza: la vitrina QA expone las mejores, de jugadores distintos. */
const SORTED = [...CARDS].sort((a, b) => getVariant(b.variantId as VariantId).rank - getVariant(a.variantId as VariantId).rank || b.ovr - a.ovr);
const DISTINCT_PLAYERS = (() => {
  const seen = new Set<string>(); const out: typeof CARDS = [];
  for (const c of SORTED) { if (seen.has(c.playerId)) continue; seen.add(c.playerId); out.push(c); if (out.length >= 60) break; }
  return out;
})();
const serialized = DISTINCT_PLAYERS.filter((c) => getVariant(c.variantId as VariantId).serialized);
const LEAD = serialized[0] ?? DISTINCT_PLAYERS[0];
const SECOND = DISTINCT_PLAYERS.find((c) => c.id !== LEAD.id) ?? LEAD;
const THIRD = DISTINCT_PLAYERS.find((c) => c.id !== LEAD.id && c.id !== SECOND.id) ?? SECOND;

/** Colección QA: 3 copias de la carta líder (#3, #47, #211), y una copia de 48 cartas más. */
export const OWNED: OwnedCard[] = [
  { uid: uid(1), cardId: LEAD.id, serial: 3, obtainedAt: QA_NOW - 40 * D },
  { uid: uid(2), cardId: LEAD.id, serial: 47, obtainedAt: QA_NOW - 12 * D },
  { uid: uid(3), cardId: LEAD.id, serial: 211, obtainedAt: QA_NOW - 2 * D },
  // Fase 57 · «todas menos la líder» por id (antes `slice(1, 49)` suponía que la líder era la primera; con la carta
  // serializada de QA registrada por otro arnés no lo es, y SECOND quedaba fuera de la colección).
  ...DISTINCT_PLAYERS.filter((c) => c.id !== LEAD.id).slice(0, 48).map((c, i) => ({ uid: uid(10 + i), cardId: c.id, serial: getVariant(c.variantId as VariantId).serialized ? 100 + i * 7 : undefined, obtainedAt: QA_NOW - (i + 1) * D })),
];
export const LEAD_CARD_ID = LEAD.id;

const instanceFacts = (o: OwnedCard) => ({ uid: o.uid, cardId: o.cardId, serial: o.serial ?? null, mintedVersion: null, obtainedAt: o.obtainedAt });
const find = (cardId: string, serial?: number) => OWNED.find((o) => o.cardId === cardId && (serial === undefined || o.serial === serial))!;

const CATALOG = ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, description: a.description, icon: a.icon }));

const RANKED = { rating: 1258, gamesPlayed: 38, provisional: false, wins: 21, losses: 14, draws: 3, position: 124, rankedTotal: 512, winrate: 58, form: ["W", "W", "L", "W", "D"] as ("W" | "L" | "D")[], streak: { kind: "W" as const, n: 2 } };
const RIVALS = ["Kaelis", "Nyra", "Brann", "Sable", "Orion"];
const MATCHES = RIVALS.map((name, i) => ({
  matchId: `00000000-0000-4000-8000-0000000m000${i}`, at: QA_NOW - (i + 1) * 5 * 3600_000,
  outcome: ["WIN", "WIN", "LOSS", "WIN", "DRAW"][i], letter: (["W", "W", "L", "W", "D"] as const)[i],
  scoreYou: [6, 7, 3, 6, 5][i], scoreRival: [4, 3, 7, 5, 5][i],
  rival: { userId: uid(900 + i), username: name, avatar: ["🐉", "🦉", "🐺", "🦅", "🐙"][i] },
}));

/** Fase 56 · exportada para reutilizar los mismos hechos QA en el arnés del perfil 4.0. */
export function facts(over: Partial<IdentityFacts> & { profileId?: string; username?: string; showcase?: OwnedCard[]; featured?: string[] } = {}): IdentityFacts {
  const showcase = over.showcase ?? [find(LEAD.id, 3), find(SECOND.id), find(THIRD.id)];
  const owned = over.instanceCardIds ? [] : OWNED;
  return {
    profile: { id: over.profileId ?? SELF_ID, username: over.username ?? "QA · David", avatar: "🐉", xp: 48_200, equipped: {}, packsOpened: 142 },
    cosmetics: { title: { label: "Analista", color: "#19e3ff" }, frame: { color: "#ffce4f" }, banner: { label: "NEXUS S1", color: "#ff2e63" } },
    ranked: RANKED, highestRating: 1302, recentMatches: MATCHES,
    instanceCardIds: owned.map((o) => o.cardId),
    showcaseInstances: showcase.map(instanceFacts),
    teams: [{ total: 6, ownedDistinct: 6 }, { total: 8, ownedDistinct: 8 }, { total: 9, ownedDistinct: 4 }],
    totalCards: CARDS.length,
    customization: { showcaseUids: showcase.map((o) => o.uid), featuredIds: over.featured ?? ["coleccionista", "sobres-100", "primer-mvp"], version: 4, updatedAt: QA_NOW - D },
    claimed: [{ id: "coleccionista", claimedAt: QA_NOW - 3 * D }, { id: "sobres-100", claimedAt: QA_NOW - 9 * D }, { id: "primer-mvp", claimedAt: QA_NOW - 20 * D }, { id: "completa-heretics", claimedAt: QA_NOW - 30 * D }],
    catalog: CATALOG,
    pickems: [
      { pickemEventId: "qa-pe-1", title: "QA Invitational 2026", points: 64, correct: 8, total: 12, scoredAt: QA_NOW - 2 * D },
      { pickemEventId: "qa-pe-2", title: "QA Open Primavera", points: 30, correct: 4, total: 9, scoredAt: QA_NOW - 60 * D },
    ],
    h2h: null, privateDuels: 7,
    ...over,
  };
}

const snap = (f: IdentityFacts, viewerId: string | null): PlayerIdentitySnapshot => buildPlayerIdentity(f, { viewerId, now: QA_NOW, lookup, rankOf });

export const OWN_FULL = snap(facts(), SELF_ID);
export const PUBLIC_FULL = snap({ ...facts({ profileId: RIVAL_ID, username: "QA · Kaelis" }), h2h: { ranked: { wins: 3, losses: 2, draws: 0, matches: 5 }, private: { wins: 4, losses: 1, draws: 1, matches: 6 }, total: { wins: 7, losses: 3, draws: 1, matches: 11 } } }, SELF_ID);
export const PUBLIC_ANON = snap(facts({ profileId: RIVAL_ID, username: "QA · Kaelis" }), null);
export const NEW_PLAYER = snap({ ...facts({ showcase: [], featured: [] }), profile: { id: SELF_ID, username: "QA · Nuevo", avatar: "🎮", xp: 0, equipped: {}, packsOpened: 0 }, cosmetics: { title: null, frame: null, banner: null }, ranked: null, highestRating: null, recentMatches: [], instanceCardIds: [], showcaseInstances: [], teams: [], claimed: [], pickems: [], privateDuels: 0, customization: null }, SELF_ID);
export const NO_CARDS_PUBLIC = snap({ ...facts({ profileId: RIVAL_ID, username: "QA · Sin cartas", showcase: [], featured: [] }), instanceCardIds: [], showcaseInstances: [], teams: [], claimed: [], customization: null }, SELF_ID);
export const EMPTY_SHOWCASE_SELF = snap(facts({ showcase: [] }), SELF_ID);
export const EMPTY_SHOWCASE_PUBLIC = snap(facts({ profileId: RIVAL_ID, username: "QA · Kaelis", showcase: [] }), SELF_ID);
export const SHOWCASE_ONE = snap(facts({ showcase: [find(LEAD.id, 3)] }), SELF_ID);
export const LOW_SERIAL = snap(facts({ showcase: [find(LEAD.id, 3), find(SECOND.id)] }), RIVAL_ID);
export const UNAVAILABLE = snap({ ...facts(), showcaseInstances: [instanceFacts(find(LEAD.id, 3))] }, SELF_ID);
export const NO_ACHIEVEMENTS = snap({ ...facts({ featured: [] }), claimed: [] }, SELF_ID);
export const ACHIEVEMENTS_NOT_FEATURED = snap(facts({ featured: [] }), SELF_ID);
export const UNRANKED = snap({ ...facts({ profileId: RIVAL_ID, username: "QA · Sin ranked" }), ranked: null, highestRating: null, recentMatches: [] }, SELF_ID);
export const NO_PICKEMS = snap({ ...facts(), pickems: [] }, SELF_ID);

export const CLAIMED = OWN_FULL.self!.claimedAchievements;
