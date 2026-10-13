/**
 * COLLECTION ROOM — MODELO CANÓNICO DE LA COLECCIÓN (Fase 37). PURO.
 *
 * Separa las dos cosas que la colección mezclaba:
 *
 *   DEFINICIÓN  (`CardDef`, catálogo público)   id `jugador__variante`, jugador, variante, OVR, stats de combate,
 *                                               equipo, rol, región. La misma para todo el mundo.
 *   INSTANCIA   (`user_cards`, privada)         uid, card_id, serial (si la variante se numera), mintedVersion.
 *                                               Una por copia real poseída.
 *
 * Sobre eso deriva, sin persistir nada nuevo: progreso del álbum (DEFINICIONES únicas, nunca copias), duplicados,
 * desgloses por rareza/rol/región/edición/equipo, sets casi completos, la mejor carta (criterio documentado),
 * prestigio VISUAL del serial, variantes por jugador, disponibilidad en sobres ACTIVOS y uso en equipos.
 *
 * Reglas que no se rompen aquí: el serial no toca stats ni recompensas; no se afirma procedencia (`obtained_at` no es
 * fiable); una carta no poseída nunca muestra serial; OVR y stats son los del catálogo (`domain/cards/combat.ts`).
 */
import type { CardDef, Player, Region, RoleId, VariantId } from "@/domain/cards/types";
import { DESIGNED_EDITIONS, getVariant } from "@/domain/cards/variants";
import { bucketForRank, BUCKET_LABEL, type PackDef, type RarityBucket } from "@/domain/packs/types";
import { isPurchasable } from "@/domain/packs/lifecycle";
import { isEligible } from "@/domain/packs/pool";
import type { CardRegistry } from "@/collection/registry";
import { canonicalCardTeam, canonicalTeam } from "@/data/teamIdentities";
import { ns } from "@/i18n/runtime";

const tr = ns("collection");

/* ───────────────────────────── identidad y rutas ───────────────────────────── */

/** Formato canónico de un id de definición (medido sobre el catálogo real: 772/772). */
export const CARD_ID_PATTERN = /^[a-z0-9-]{1,64}__[a-z0-9-]{1,32}$/;
export const isValidCardId = (id: unknown): id is string => typeof id === "string" && id.length <= 98 && CARD_ID_PATTERN.test(id);
export const cardHref = (cardId: string): string => `/coleccion/carta/${encodeURIComponent(cardId)}`;
export const compareHref = (a: string, b?: string | null): string =>
  `/coleccion/comparar?a=${encodeURIComponent(a)}${b ? `&b=${encodeURIComponent(b)}` : ""}`;

export const ROLE_ORDER: readonly RoleId[] = ["Duelista", "Iniciador", "Controlador", "Centinela", "Flex"];
export const REGION_ORDER: readonly Region[] = ["EMEA", "Americas", "Pacific", "China"];
export const BUCKET_ORDER: readonly RarityBucket[] = ["legendary", "epic", "rare", "uncommon", "common"];
/**
 * EDICIONES del producto: las 7 del catálogo diseñado (`Cartas\`, 2026-09-21), de mayor a menor rareza. La
 * edición de una carta es su `variantId`; la taxonomía anterior de grupos (regional, MVP, ganadores…) ya no
 * tiene cartas y no se enseña. Una carta fuera del catálogo diseñado (la serializada local de QA) forma su
 * propio set con su etiqueta.
 */
export const EDITION_ORDER: readonly VariantId[] = [...DESIGNED_EDITIONS]
  .sort((a, b) => getVariant(b).rank - getVariant(a).rank || getVariant(a).label.localeCompare(getVariant(b).label, "es"));
export const EDITION_LABEL: Readonly<Record<string, string>> = Object.fromEntries(EDITION_ORDER.map((id) => [id, getVariant(id).label]));
/** Edición de una carta (su `variantId`). */
export const editionOf = (card: Pick<CardDef, "variantId">): VariantId => card.variantId;
export { BUCKET_LABEL };

export const rarityOf = (card: Pick<CardDef, "variantId">): RarityBucket => bucketForRank(getVariant(card.variantId).rank);

/**
 * Clave de EQUIPO: la identidad verificada del catálogo de equipos cuando el alias se resuelve SIN ambigüedad (así
 * «Fnatic» y «FNC» son el mismo set); si no, el nombre tal cual (`raw:`). Nunca se fusionan alias ambiguos.
 */
export function teamKeyOf(team: string): { key: string; label: string } {
  const { key, label } = canonicalTeam(team);
  return { key, label };
}

/** Clave de EQUIPO de una CARTA: su equipo impreso (catálogo diseñado) o, si no lo trae, el del jugador. */
export function cardTeamKeyOf(card: Pick<CardDef, "team">, player: Pick<Player, "team"> | undefined): { key: string; label: string } {
  const { key, label } = canonicalCardTeam(card, player);
  return { key, label };
}

/* ───────────────────────────── hechos personales ───────────────────────────── */

export interface OwnedInstanceFact { uid: string; cardId: string; serial: number | null; mintedVersion: number | null }
export interface DeckUsageFact { id: string; name: string; active: boolean; cardUids: string[] }

export interface CollectionPersonalFacts {
  /**
   * Ejemplares conocidos. COLECCIONES ILIMITADAS · con `holdings` NO es la colección entera: es el mejor ejemplar de
   * cada carta más los que están en la vitrina o en un equipo. Sin `holdings` (demo local) sí son todos.
   */
  instances: OwnedInstanceFact[];
  /** Copias por carta (y cuántas numeradas) según el servidor. Manda sobre el recuento de `instances`. */
  holdings?: Readonly<Record<string, { count: number; numbered: number }>> | null;
  /** `null` = no disponible (p. ej. 0052 sin aplicar): no se inventan favoritos. */
  favorites: string[] | null;
  showcaseUids: string[] | null;
  decks: DeckUsageFact[] | null;
}

/* ───────────────────────────── serial ───────────────────────────── */

export type SerialPrestigeTier = "NUMBER_ONE" | "TOP_10" | "TOP_100";

/** Prestigio VISUAL del número de serie. No da stats, ni recompensas, ni valor. */
export function serialPrestige(serial: number | null | undefined): { tier: SerialPrestigeTier; label: string } | null {
  if (typeof serial !== "number" || !Number.isInteger(serial) || serial < 1) return null;
  if (serial === 1) return { tier: "NUMBER_ONE", label: "#1" };
  if (serial <= 10) return { tier: "TOP_10", label: tr("Top 10") };
  if (serial <= 100) return { tier: "TOP_100", label: tr("Top 100") };
  return null;
}

/** Formato canónico del serial (el mismo del visor): `#42/500`; sin tope, `#42`. */
export function formatSerial(serial: number | null | undefined, serialLimit?: number | null): string | null {
  if (typeof serial !== "number" || !Number.isInteger(serial) || serial < 1) return null;
  return serialLimit ? `#${serial}/${serialLimit}` : `#${serial}`;
}

/** Copias en orden canónico: serial ascendente (sin serial al final), después uid. */
export function sortInstances<T extends { uid: string; serial: number | null }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

/* ───────────────────────────── progreso ───────────────────────────── */

/** Porcentaje con un decimal, redondeado HACIA ABAJO: nunca «100,0 %» sin estar completo. */
export function completionPct(owned: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((Math.max(0, Math.min(owned, total)) * 1000) / total) / 10;
}

export const NEAR_MIN_PCT = 70;
/** Un set de menos de 5 cartas no es «casi completo» (mismo mínimo que los sets de maestría). */
export const NEAR_MIN_TOTAL = 5;

export const isNearComplete = (owned: number, total: number): boolean =>
  total >= NEAR_MIN_TOTAL && owned < total && owned * 100 >= NEAR_MIN_PCT * total;

export type CollectionSetKind = "team" | "region" | "role" | "rarity" | "edition";

export interface CollectionSetProgress {
  id: string;
  kind: CollectionSetKind;
  key: string;
  label: string;
  owned: number;
  total: number;
  pct: number;
  complete: boolean;
  near: boolean;
  missing: number;
}

/* ───────────────────────────── foto ───────────────────────────── */

export interface CardOwnership {
  cardId: string;
  count: number;
  instances: OwnedInstanceFact[];
  bestSerial: number | null;
  favorite: boolean;
  showcaseUids: string[];
  deckIds: string[];
  inActiveDeck: boolean;
}

export interface CollectionSnapshot {
  catalogTotal: number;
  uniqueOwned: number;
  totalCopies: number;
  /** Copias de más: totalCopies − uniqueOwned (solo de cartas del catálogo). */
  duplicates: number;
  completionPct: number;
  /** Copias cuyo `card_id` ya no está en el catálogo vigente: se cuentan aparte, nunca en el álbum. */
  unknownInstances: number;
  best: { cardId: string; uid: string; serial: number | null } | null;
  highestOvr: number | null;
  serials: { owned: number; number1: number; lowest: { cardId: string; uid: string; serial: number } | null };
  sets: Record<CollectionSetKind, CollectionSetProgress[]>;
  nearComplete: CollectionSetProgress[];
  favoritesAvailable: boolean;
  showcaseAvailable: boolean;
  decksAvailable: boolean;
  /** Fase 40 · equipos guardados (`null` si no se pudieron leer). Solo decide si se enseña el coach de la primera sesión. */
  decksCount: number | null;
  favorites: string[];
  byCard: Map<string, CardOwnership>;
}

type Resolve = (playerId: string) => Player | undefined;

function setProgress(kind: CollectionSetKind, key: string, label: string, owned: number, total: number): CollectionSetProgress {
  return {
    id: `${kind}:${key}`, kind, key, label, owned, total, pct: completionPct(owned, total),
    complete: total > 0 && owned >= total, near: isNearComplete(owned, total), missing: Math.max(0, total - owned),
  };
}

export function buildCollectionSnapshot(cards: readonly CardDef[], resolvePlayer: Resolve, personal: CollectionPersonalFacts): CollectionSnapshot {
  const catalog = new Map(cards.map((c) => [c.id, c]));
  const favorites = new Set((personal.favorites ?? []).filter((id) => catalog.has(id)));
  const showcase = new Set(personal.showcaseUids ?? []);
  const deckByUid = new Map<string, { id: string; active: boolean }[]>();
  for (const d of personal.decks ?? []) {
    for (const uid of d.cardUids) {
      const list = deckByUid.get(uid) ?? [];
      if (!list.some((x) => x.id === d.id)) list.push({ id: d.id, active: d.active });
      deckByUid.set(uid, list);
    }
  }

  const byCard = new Map<string, CardOwnership>();
  let unknownInstances = 0;
  for (const inst of personal.instances) {
    if (!catalog.has(inst.cardId)) { unknownInstances++; continue; }
    const row = byCard.get(inst.cardId) ?? { cardId: inst.cardId, count: 0, instances: [], bestSerial: null, favorite: favorites.has(inst.cardId), showcaseUids: [], deckIds: [], inActiveDeck: false };
    row.count++;
    row.instances.push(inst);
    if (inst.serial !== null && (row.bestSerial === null || inst.serial < row.bestSerial)) row.bestSerial = inst.serial;
    if (showcase.has(inst.uid)) row.showcaseUids.push(inst.uid);
    for (const d of deckByUid.get(inst.uid) ?? []) {
      if (!row.deckIds.includes(d.id)) row.deckIds.push(d.id);
      if (d.active) row.inActiveDeck = true;
    }
    byCard.set(inst.cardId, row);
  }
  for (const row of byCard.values()) {
    row.instances = sortInstances(row.instances);
    const h = personal.holdings?.[row.cardId];
    if (h) row.count = Math.max(h.count, row.instances.length);
  }

  const uniqueOwned = byCard.size;
  const totalCopies = [...byCard.values()].reduce((s, r) => s + r.count, 0);

  // Mejor carta: OVR ↓ → rareza de la variante ↓ → serial ↑ (sin serial al final) → id.
  let best: CollectionSnapshot["best"] = null;
  let bestKey: [number, number, number, string] | null = null;
  let number1 = 0; let serialsOwned = 0;
  let lowest: CollectionSnapshot["serials"]["lowest"] = null;
  for (const row of byCard.values()) {
    const def = catalog.get(row.cardId)!;
    const key: [number, number, number, string] = [def.ovr, getVariant(def.variantId).rank, row.bestSerial ?? Infinity, row.cardId];
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && (key[2] < bestKey[2] || (key[2] === bestKey[2] && key[3] < bestKey[3])))))) {
      bestKey = key;
      best = { cardId: row.cardId, uid: row.instances[0].uid, serial: row.instances[0].serial };
    }
    // Con `holdings`, las numeradas se cuentan del servidor; #1 y la serie más baja salen igualmente del mejor ejemplar
    // (la serie es única por carta y el mejor ejemplar es el de serie más baja).
    const held = personal.holdings?.[row.cardId];
    if (held) serialsOwned += held.numbered;
    for (const i of row.instances) {
      if (i.serial === null) continue;
      if (!held) serialsOwned++;
      if (i.serial === 1) number1++;
      if (!lowest || i.serial < lowest.serial || (i.serial === lowest.serial && row.cardId < lowest.cardId)) lowest = { cardId: row.cardId, uid: i.uid, serial: i.serial };
    }
  }

  // Sets derivados de hechos del catálogo.
  const tally = new Map<string, { kind: CollectionSetKind; key: string; label: string; owned: number; total: number }>();
  const bump = (kind: CollectionSetKind, key: string, label: string, owned: boolean) => {
    const id = `${kind}:${key}`;
    const t = tally.get(id) ?? { kind, key, label, owned: 0, total: 0 };
    t.total++; if (owned) t.owned++;
    tally.set(id, t);
  };
  for (const def of cards) {
    const player = resolvePlayer(def.playerId);
    const owned = byCard.has(def.id);
    const rarity = rarityOf(def);
    bump("rarity", rarity, BUCKET_LABEL[rarity], owned);
    const edition = editionOf(def);
    bump("edition", edition, EDITION_LABEL[edition] ?? getVariant(edition).label, owned);
    if (player) {
      bump("role", def.role ?? player.role, def.role ?? player.role, owned);
      bump("region", player.region, player.region, owned);
      const team = cardTeamKeyOf(def, player);
      bump("team", team.key, team.label, owned);
    }
  }
  const order = (kind: CollectionSetKind, a: CollectionSetProgress, b: CollectionSetProgress) => {
    const idx = (list: readonly string[], k: string) => { const i = list.indexOf(k); return i < 0 ? 99 : i; };
    if (kind === "rarity") return idx(BUCKET_ORDER, a.key) - idx(BUCKET_ORDER, b.key);
    if (kind === "role") return idx(ROLE_ORDER, a.key) - idx(ROLE_ORDER, b.key);
    if (kind === "region") return idx(REGION_ORDER, a.key) - idx(REGION_ORDER, b.key);
    if (kind === "edition") return idx(EDITION_ORDER, a.key) - idx(EDITION_ORDER, b.key);
    return b.pct - a.pct || b.owned - a.owned || a.label.localeCompare(b.label, "es");
  };
  const sets = { team: [], region: [], role: [], rarity: [], edition: [] } as Record<CollectionSetKind, CollectionSetProgress[]>;
  for (const t of tally.values()) sets[t.kind].push(setProgress(t.kind, t.key, t.label, t.owned, t.total));
  for (const kind of Object.keys(sets) as CollectionSetKind[]) sets[kind].sort((a, b) => order(kind, a, b));

  const nearComplete = (["team", "region", "role", "rarity", "edition"] as const)
    .flatMap((k) => sets[k].filter((s) => s.near))
    .sort((a, b) => b.pct - a.pct || a.missing - b.missing || a.id.localeCompare(b.id));

  return {
    catalogTotal: cards.length,
    uniqueOwned,
    totalCopies,
    duplicates: totalCopies - uniqueOwned,
    completionPct: completionPct(uniqueOwned, cards.length),
    unknownInstances,
    best,
    highestOvr: best ? catalog.get(best.cardId)!.ovr : null,
    serials: { owned: serialsOwned, number1, lowest },
    sets,
    nearComplete,
    favoritesAvailable: personal.favorites !== null,
    showcaseAvailable: personal.showcaseUids !== null,
    decksAvailable: personal.decks !== null,
    decksCount: personal.decks ? personal.decks.length : null,
    favorites: [...favorites].sort(),
    byCard,
  };
}

/* ───────────────────────────── variantes y disponibilidad ───────────────────────────── */

export interface PlayerVariantRow { cardId: string; variantId: string; label: string; rank: number; ovr: number; owned: boolean; count: number }

/** Todas las variantes (definiciones) de un jugador, de la más común a la más rara, con cuáles tienes. */
export function playerVariants(cards: readonly CardDef[], playerId: string, snap: Pick<CollectionSnapshot, "byCard"> | null): { rows: PlayerVariantRow[]; owned: number; total: number } {
  const rows = cards.filter((c) => c.playerId === playerId)
    .map((c) => {
      const v = getVariant(c.variantId);
      const own = snap?.byCard.get(c.id);
      return { cardId: c.id, variantId: c.variantId, label: v.label, rank: v.rank, ovr: c.ovr, owned: !!own, count: own?.count ?? 0 };
    })
    .sort((a, b) => a.rank - b.rank || a.cardId.localeCompare(b.cardId));
  return { rows, owned: rows.filter((r) => r.owned).length, total: rows.length };
}

export interface PackAvailability { packId: string; name: string }

/**
 * Sobres ACTIVOS (a la venta) cuyo pool, según las MISMAS reglas del motor de sobres (`isEligible`), puede contener
 * la carta. Solo dice «puede salir»: nunca una garantía ni una probabilidad inventada. DRAFT y RETIRED no se ofrecen.
 */
export function packsThatCanContain(registry: CardRegistry, packs: readonly PackDef[], card: CardDef): PackAvailability[] {
  return packs
    .filter((p) => isPurchasable(p) && isEligible(registry, p, card))
    .map((p) => ({ packId: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es") || a.packId.localeCompare(b.packId));
}

/* ───────────────────────────── sobre → colección ───────────────────────────── */

/** La carta a la que «Ver en mi colección» lleva tras abrir: la de variante más rara, luego OVR, luego id. */
export function bestOpenedCardId(opened: readonly { cardId: string }[], resolve: (id: string) => CardDef | undefined): string | null {
  let bestId: string | null = null; let bestRank = -1; let bestOvr = -1;
  for (const o of opened) {
    const def = resolve(o.cardId);
    if (!def || !isValidCardId(def.id)) continue;
    const rank = getVariant(def.variantId).rank;
    if (rank > bestRank || (rank === bestRank && (def.ovr > bestOvr || (def.ovr === bestOvr && bestId !== null && def.id < bestId)))) {
      bestId = def.id; bestRank = rank; bestOvr = def.ovr;
    }
  }
  return bestId;
}
