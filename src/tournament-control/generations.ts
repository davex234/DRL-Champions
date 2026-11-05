/**
 * GENERATIONS — detalle de una generación registrada y COMPARADOR entre dos registros:
 * cartas nuevas/eliminadas, OVR y rarezas modificados, cambios de badges, de colección y
 * editoriales. Diff puro por cardId sobre las generaciones YA decididas; nada se recalcula.
 */
import type { EditorialState } from "@/editorial";
import type {
  BadgeChange, CollectionChange, EditorialChange, GenerationComparison, GenerationRecord,
  OvrChange, RarityChange,
} from "./types";

/* ── Detalle ──────────────────────────────────────────────────────────────── */

export interface GenerationDetail {
  recordId: string;
  generationId: string;
  tournamentId: string;
  tournamentName: string;
  season: number;
  source: GenerationRecord["source"];
  revisionOf?: string;
  cards: number;
  byKind: Record<string, number>;
  byRarity: Record<string, number>;
  byDecision: Record<string, number>;
  players: { resolved: number; created: number; ambiguous: number };
  grants: number;
  badges: number;
  omitted: number;
  retired: number;
  estimatedValueTotal: number;
}

export function generationDetail(rec: GenerationRecord): GenerationDetail {
  const byKind: Record<string, number> = {};
  const byRarity: Record<string, number> = {};
  for (const c of rec.generation.cards) {
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    byRarity[c.rarityBucket] = (byRarity[c.rarityBucket] ?? 0) + 1;
  }
  const s = rec.generation.summary;
  return {
    recordId: rec.recordId,
    generationId: rec.generationId,
    tournamentId: rec.tournamentId,
    tournamentName: rec.tournamentName,
    season: rec.season,
    source: rec.source,
    revisionOf: rec.revisionOf,
    cards: rec.generation.cards.length,
    byKind,
    byRarity,
    byDecision: s.byDecision,
    players: s.players,
    grants: s.grants,
    badges: s.badges,
    omitted: s.omitted,
    retired: rec.generation.retired.length,
    estimatedValueTotal: s.estimatedValueTotal,
  };
}

/* ── Comparador ───────────────────────────────────────────────────────────── */

const stateOf = (rec: GenerationRecord, cardId: string): EditorialState | "sin-caso" =>
  rec.editorial?.states[cardId] ?? "sin-caso";

/** Diferencias entre dos registros (generaciones YA producidas; diff puro por cardId). */
export function compareGenerations(a: GenerationRecord, b: GenerationRecord): GenerationComparison {
  const cardsA = new Map(a.generation.cards.map((c) => [c.cardId, c]));
  const cardsB = new Map(b.generation.cards.map((c) => [c.cardId, c]));
  const allIds = [...new Set([...cardsA.keys(), ...cardsB.keys()])].sort();

  const addedCards: string[] = [];
  const removedCards: string[] = [];
  const ovrChanged: OvrChange[] = [];
  const rarityChanged: RarityChange[] = [];
  const badgesChanged: BadgeChange[] = [];
  const collectionChanged: CollectionChange[] = [];
  const editorialChanged: EditorialChange[] = [];

  const collA = new Set(a.generation.collection.items.map((i) => i.cardId));
  const collB = new Set(b.generation.collection.items.map((i) => i.cardId));

  for (const id of allIds) {
    const ca = cardsA.get(id);
    const cb = cardsB.get(id);
    if (!ca) { addedCards.push(id); continue; }
    if (!cb) { removedCards.push(id); continue; }

    if (ca.ovr !== cb.ovr) ovrChanged.push({ cardId: id, from: ca.ovr, to: cb.ovr });
    if (ca.rarityBucket !== cb.rarityBucket) rarityChanged.push({ cardId: id, from: ca.rarityBucket, to: cb.rarityBucket });

    const setA = new Set(ca.badges);
    const setB = new Set(cb.badges);
    const added = cb.badges.filter((x) => !setA.has(x)).sort();
    const removed = ca.badges.filter((x) => !setB.has(x)).sort();
    if (added.length || removed.length) badgesChanged.push({ cardId: id, added, removed });

    if (collA.has(id) !== collB.has(id)) collectionChanged.push({ cardId: id, inA: collA.has(id), inB: collB.has(id) });

    const sa = stateOf(a, id);
    const sb = stateOf(b, id);
    if (sa !== sb) editorialChanged.push({ cardId: id, from: sa, to: sb });
  }

  // Cambios editoriales también en cartas exclusivas de un lado (si ambos tienen caso).
  for (const id of [...addedCards, ...removedCards]) {
    const sa = stateOf(a, id);
    const sb = stateOf(b, id);
    if (sa !== sb && (sa !== "sin-caso" || sb !== "sin-caso")) editorialChanged.push({ cardId: id, from: sa, to: sb });
  }
  editorialChanged.sort((x, y) => (x.cardId < y.cardId ? -1 : x.cardId > y.cardId ? 1 : 0));

  return {
    a: a.recordId,
    b: b.recordId,
    addedCards,
    removedCards,
    ovrChanged,
    rarityChanged,
    badgesChanged,
    collectionChanged,
    editorialChanged,
    identical: !addedCards.length && !removedCards.length && !ovrChanged.length &&
      !rarityChanged.length && !badgesChanged.length && !collectionChanged.length && !editorialChanged.length,
  };
}
