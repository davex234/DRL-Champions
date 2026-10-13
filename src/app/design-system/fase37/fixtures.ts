/**
 * ARNÉS QA · FASE 37 — FOTOS QA SYNTHETIC de la colección.
 *
 * Las COPIAS (instancias, seriales, favoritas, vitrina, equipos) son INVENTADAS para revisar estados difíciles
 * (#1, vitrina llena, sin conexión, colección completa…). Lo real: el catálogo (definiciones, OVR, stats, equipos,
 * sobres) y el dominio que deriva todo (`buildCollectionSnapshot`, el mismo de la ruta). Ninguna escena es un jugador.
 */
import type { CardDef } from "@/domain/cards/types";
import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { rarityOf, cardTeamKeyOf, type CollectionPersonalFacts, type CollectionSetKind, type OwnedInstanceFact } from "@/domain/collection/room";
import { normalizeText } from "@/collection/filter";
import type { CollectionQuery } from "@/domain/collection/query";
import type { CollectionAccess } from "@/components/collectionRoom/roomModel";
import { qaSerializedCard } from "@/app/design-system/serialFixture";

// El catálogo diseñado no tiene serializadas: la carta #1 del veterano es la carta local de QA (antes de medir nada).
const QA_SERIAL = qaSerializedCard();

let seq = 0;
const uid = () => `00000037-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const serialCursor = new Map<string, number>();
function serialFor(c: CardDef, forced?: number): number | null {
  const v = getVariant(c.variantId);
  if (!v.serialized) return null;
  const limit = v.serialLimit ?? 500;
  if (forced) return Math.min(forced, limit);
  const next = (serialCursor.get(c.id) ?? 140) + 37;
  serialCursor.set(c.id, next);
  return ((next - 1) % limit) + 1;
}

const own = (c: CardDef, copies = 1, forced: (number | undefined)[] = []): OwnedInstanceFact[] =>
  Array.from({ length: copies }, (_, k) => ({ uid: uid(), cardId: c.id, serial: serialFor(c, forced[k]), mintedVersion: 1 }));

const playerOf = (c: CardDef) => getPlayer(c.playerId)!;
const teamOf = (c: CardDef) => cardTeamKeyOf(c, playerOf(c)).key;
const firstWhere = (f: (c: CardDef, i: number) => boolean) => CARDS.find(f) ?? CARDS[0];

const TEAMS = (() => {
  const m = new Map<string, CardDef[]>();
  for (const c of CARDS) { if (!getPlayer(c.playerId)) continue; const k = teamOf(c); m.set(k, [...(m.get(k) ?? []), c]); }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
})();
export const TEAM_FULL = TEAMS[0][0];
export const TEAM_NEAR = TEAMS[1][0];

export const SERIAL_CARD = QA_SERIAL;
export const LEGEND_CARD = firstWhere((c) => rarityOf(c) === "legendary" && c.id !== SERIAL_CARD.id);
export const FLEX_CARD = firstWhere((c) => String(c.role ?? playerOf(c).role) === "Flex" && !getVariant(c.variantId).serialized);
export const COMMON_CARD = firstWhere((c) => rarityOf(c) === "common" && String(c.role ?? playerOf(c).role) !== "Flex");
const TAKEN = new Set([SERIAL_CARD.id, LEGEND_CARD.id, FLEX_CARD.id, COMMON_CARD.id]);
export const UNOWNED_CARD = firstWhere((c, i) => i % 2 === 1 && !TAKEN.has(c.id) && teamOf(c) !== TEAM_FULL && teamOf(c) !== TEAM_NEAR);

const VARIANTS_BY_PLAYER = (() => { const m = new Map<string, CardDef[]>(); for (const c of CARDS) m.set(c.playerId, [...(m.get(c.playerId) ?? []), c]); return m; })();
const MANY = [...VARIANTS_BY_PLAYER.values()].sort((a, b) => b.length - a.length || a[0].playerId.localeCompare(b[0].playerId))[0];
export const MANY_VARIANTS_CARD = MANY[0];
export const MANY_VARIANTS_OTHER = MANY[MANY.length - 1];
export const LONG_CARD = [...CARDS].sort((a, b) => {
  const la = `${playerOf(a).nick} ${playerOf(a).team}`.length; const lb = `${playerOf(b).nick} ${playerOf(b).team}`.length;
  return lb - la || a.id.localeCompare(b.id);
})[0];

/* ───────────── colecciones QA SYNTHETIC ───────────── */

const EMPTY: CollectionPersonalFacts = { instances: [], favorites: [], showcaseUids: [], decks: [] };
export const ANON: CollectionPersonalFacts = { instances: [], favorites: null, showcaseUids: null, decks: null };

function veteran(): CollectionPersonalFacts {
  const out: OwnedInstanceFact[] = [];
  const have = new Set<string>();
  const take = (c: CardDef, copies = 1, forced: (number | undefined)[] = []) => { if (have.has(c.id)) return; have.add(c.id); out.push(...own(c, copies, forced)); };
  take(SERIAL_CARD, 3, [1, 7, 88]); // 0 #1 · 1 #7 · 2 #88
  take(LEGEND_CARD); // 3
  take(FLEX_CARD, 2); // 4, 5
  take(COMMON_CARD, 4); // 6..9
  CARDS.forEach((c, i) => { if (i % 2 === 0 && c.id !== UNOWNED_CARD.id) take(c, i % 14 === 0 ? 2 : 1); });
  for (const c of TEAMS[0][1]) if (c.id !== UNOWNED_CARD.id) take(c);
  const near = TEAMS[1][1];
  near.slice(0, Math.floor(near.length * 0.8)).forEach((c) => take(c));
  const topOwned = [...have].map((id) => CARDS.find((c) => c.id === id)!).sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, 3).map((c) => c.id);
  return {
    instances: out,
    favorites: [...new Set([SERIAL_CARD.id, LEGEND_CARD.id, FLEX_CARD.id, ...topOwned, UNOWNED_CARD.id])],
    showcaseUids: [out[1].uid, out[3].uid],
    decks: [
      { id: "qa37-deck-1", name: "Equipo QA", active: true, cardUids: [out[0].uid, out[3].uid, out[4].uid, out[6].uid, out[10].uid] },
      { id: "qa37-deck-2", name: "Reserva QA", active: false, cardUids: [out[0].uid, out[7].uid, out[11].uid, out[12].uid, out[13].uid] },
    ],
  };
}

function starter(): CollectionPersonalFacts {
  const base = CARDS.filter((c) => getVariant(c.variantId).group === "base").slice(0, 26);
  const instances = [...base.flatMap((c, i) => own(c, i < 3 ? 2 : 1)), ...own(SERIAL_CARD, 1, [57])];
  return { instances, favorites: [], showcaseUids: [], decks: [{ id: "qa37-deck-s", name: "Equipo inicial", active: true, cardUids: instances.slice(0, 5).map((x) => x.uid) }] };
}

export const VETERAN = veteran();
export const STARTER = starter();
export const COMPLETE: CollectionPersonalFacts = { ...EMPTY, instances: CARDS.flatMap((c) => own(c)) };
export const FRESH = EMPTY;
const serialOnly = (serials: number[]): CollectionPersonalFacts => ({ ...EMPTY, instances: own(SERIAL_CARD, serials.length, serials) });

/* ───────────── búsquedas con datos del catálogo ───────────── */

export const SEARCH_PLAYER = playerOf(LEGEND_CARD).nick;
const accented = CARDS.map(playerOf).find((p) => normalizeText(p.team) !== p.team.toLowerCase() || normalizeText(p.nick) !== p.nick.toLowerCase());
/** Sin tildes ni mayúsculas: debe encontrar el nombre con tildes. */
export const SEARCH_DIACRITICS = accented ? normalizeText(accented.team !== accented.team.normalize("NFD").replace(/[̀-ͯ]/g, "") ? accented.team : accented.nick) : SEARCH_PLAYER.toUpperCase();
export const SEARCH_TEAM = playerOf(TEAMS[1][1][0]).team;

/* ───────────── escenas ───────────── */

export interface HubScene { kind: "hub"; note: string; facts: CollectionPersonalFacts; access: CollectionAccess; loading?: boolean; offline?: boolean; stale?: boolean; query?: Partial<CollectionQuery>; book?: CollectionSetKind; packs?: number }
export interface DetailScene { kind: "detail"; note: string; cardId: string; facts: CollectionPersonalFacts; access: CollectionAccess; loading?: boolean; offline?: boolean; availabilityError?: boolean; flipped?: boolean; message?: string }
export interface CompareScene { kind: "compare"; note: string; a: string; b: string | null; facts: CollectionPersonalFacts }
export type Scene = HubScene | DetailScene | CompareScene;

const hub = (note: string, o: Partial<HubScene> = {}): HubScene => ({ kind: "hub", note, facts: VETERAN, access: "server", ...o });
const detail = (note: string, o: Partial<DetailScene> = {}): DetailScene => ({ kind: "detail", note, cardId: SERIAL_CARD.id, facts: VETERAN, access: "server", ...o });

export const SCENES: Record<string, Scene> = {
  "hub-veteran": hub("colección grande con duplicadas, seriales, favoritas, vitrina y equipos"),
  "hub-fresh": hub("cuenta nueva sin cartas y con 2 sobres", { facts: FRESH, packs: 2 }),
  "hub-starter": hub("colección inicial (27 copias)", { facts: STARTER }),
  "hub-complete": hub("catálogo completo: 100 % sin duplicadas", { facts: COMPLETE }),
  "hub-anon": hub("sin sesión: catálogo público", { facts: ANON, access: "anon" }),
  "hub-local": hub("modo local (sin Supabase): sin favoritos, vitrina ni equipos del servidor", { facts: { ...STARTER, favorites: null, showcaseUids: null, decks: null }, access: "local" }),
  "hub-loading": hub("cargando la foto del servidor", { facts: EMPTY, loading: true }),
  "hub-offline": hub("sin conexión: última foto conservada", { offline: true, stale: true }),
  "hub-error-stale": hub("el servidor falló: última foto conservada", { stale: true }),
  "hub-favorites-unavailable": hub("favoritos no disponibles (0052 sin aplicar)", { facts: { ...VETERAN, favorites: null } }),
  "book-team": hub("libro por equipos", { book: "team" }),
  "book-region": hub("libro por regiones", { book: "region" }),
  "book-role": hub("libro por roles", { book: "role" }),
  "book-rarity": hub("libro por rarezas", { book: "rarity" }),
  "book-edition": hub("libro por ediciones", { book: "edition" }),
  "album-owned": hub("álbum: solo conseguidas", { query: { own: "owned" } }),
  "album-missing": hub("álbum: no conseguidas", { query: { own: "missing" } }),
  "album-search": hub(`búsqueda por jugador «${SEARCH_PLAYER}»`, { query: { q: SEARCH_PLAYER } }),
  "album-search-diacritics": hub(`búsqueda sin tildes «${SEARCH_DIACRITICS}»`, { query: { q: SEARCH_DIACRITICS } }),
  "album-search-team": hub(`búsqueda por equipo «${SEARCH_TEAM}»`, { query: { q: SEARCH_TEAM } }),
  "album-no-results": hub("búsqueda sin resultados", { query: { q: "zzqx" } }),
  "album-rarity": hub("filtro: legendarias", { query: { rarity: ["legendary"] } }),
  "album-role": hub("filtro: rol Flex", { query: { role: ["Flex"] as CollectionQuery["role"] } }),
  "album-region": hub("filtro: región Pacific", { query: { region: ["Pacific"] as CollectionQuery["region"] } }),
  "album-team": hub("filtro: equipo casi completo", { query: { team: [TEAM_NEAR] } }),
  "album-ovr": hub("filtro: OVR 85–93", { query: { minOvr: 85, maxOvr: 93 } }),
  "album-duplicates": hub("filtro: solo duplicadas", { query: { dup: true } }),
  "album-favorites": hub("filtro: solo favoritas", { query: { fav: true } }),
  "album-combined": hub("filtros combinados con chips activos", { query: { own: "owned", rarity: ["rare", "epic"], region: ["EMEA"] as CollectionQuery["region"], minOvr: 70 } }),
  "album-sort-ovr-asc": hub("orden: OVR ascendente", { query: { sort: "ovr-asc" } }),
  "album-sort-copies": hub("orden: copias", { query: { sort: "copies" } }),
  "detail-owned": detail("carta serializada con 3 copias (#1, #7, #88), vitrina y equipo activo"),
  "detail-flipped": detail("reverso de la carta", { flipped: true }),
  "detail-unowned": detail("carta no conseguida", { cardId: UNOWNED_CARD.id }),
  "detail-anon": detail("sin sesión: definición pública", { cardId: LEGEND_CARD.id, facts: ANON, access: "anon" }),
  "detail-local": detail("modo local", { cardId: COMMON_CARD.id, facts: { ...VETERAN, favorites: null, showcaseUids: null, decks: null }, access: "local" }),
  "detail-duplicates": detail("común con 4 copias sin serial", { cardId: COMMON_CARD.id }),
  "detail-top10": detail("serial Top 10 (#7)", { facts: serialOnly([7]) }),
  "detail-top100": detail("serial Top 100 (#88)", { facts: serialOnly([88]) }),
  "detail-serial-plain": detail("serial sin prestigio (#250)", { facts: serialOnly([250]) }),
  "detail-favorite-on": detail("favorita marcada", { cardId: LEGEND_CARD.id }),
  "detail-favorites-unavailable": detail("favoritos no disponibles", { facts: { ...VETERAN, favorites: null } }),
  "detail-showcase-full": detail("vitrina llena (3)", { cardId: FLEX_CARD.id, facts: { ...VETERAN, showcaseUids: [VETERAN.instances[1].uid, VETERAN.instances[3].uid, VETERAN.instances[6].uid] } }),
  "detail-offline": detail("sin conexión: acciones desactivadas", { offline: true }),
  "detail-legendary": detail("legendaria", { cardId: LEGEND_CARD.id }),
  "detail-flex": detail("rol Flex con 2 copias", { cardId: FLEX_CARD.id }),
  "detail-many-variants": detail("jugador con más variantes", { cardId: MANY_VARIANTS_CARD.id }),
  "detail-availability-error": detail("fallo al calcular sobres: bloque aislado", { availabilityError: true }),
  "detail-decks-error": detail("equipos no disponibles: bloque aislado", { facts: { ...VETERAN, decks: null } }),
  "detail-message": detail("mensaje tras añadir a vitrina", { message: "Añadida a tu vitrina." }),
  "detail-loading": detail("cargando tus copias", { loading: true, facts: EMPTY }),
  "detail-long-labels": detail("nombre y equipo más largos del catálogo", { cardId: LONG_CARD.id }),
  "compare-picker": { kind: "compare", note: "elegir con qué comparar (primero las tuyas)", a: SERIAL_CARD.id, b: null, facts: VETERAN },
  "compare-two": { kind: "compare", note: "serializada frente a legendaria", a: SERIAL_CARD.id, b: LEGEND_CARD.id, facts: VETERAN },
  "compare-variants": { kind: "compare", note: "dos variantes del mismo jugador", a: MANY_VARIANTS_CARD.id, b: MANY_VARIANTS_OTHER.id, facts: VETERAN },
  "compare-same": { kind: "compare", note: "la misma carta: todo «=»", a: SERIAL_CARD.id, b: SERIAL_CARD.id, facts: VETERAN },
  "compare-unowned": { kind: "compare", note: "no conseguida frente a común", a: UNOWNED_CARD.id, b: COMMON_CARD.id, facts: VETERAN },
};
