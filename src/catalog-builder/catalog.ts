/**
 * CATALOG (Fase 6) — reconstrucción INCREMENTAL del catálogo lógico: aplica el CatalogPatch
 * (F5) sobre el snapshot inyectado — las cartas sin cambios NO se recomputan (se toman tal
 * cual del catálogo actual). Índices vía `CardRegistry` (Collection Engine REUTILIZADO) +
 * índices adicionales por procedencia/pertenencia. Jamás toca el catálogo vivo.
 */
import { CardRegistry } from "@/collection/registry";
import { cardsForPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import type { Player, CardDef } from "@/domain/cards/types";
import type { MaterializationResult } from "@/materializer";
import type { CatalogArtifact, CatalogIndexes, CatalogBuilderCtx } from "./types";

export interface AppliedCatalog {
  artifact: CatalogArtifact;
  registry: CardRegistry;
  lookup: (id: string) => Player | undefined;
}

/** Aplica el CatalogPatch en memoria: roster/cartas nuevas + updates + removes. Incremental. */
export function applyCatalog(mat: MaterializationResult, ctx: CatalogBuilderCtx): AppliedCatalog {
  const patch = mat.catalogPatch;

  // Jugadores: roster actual + updates de accolades + drafts nuevos.
  const players: Player[] = ctx.roster.map((p) => {
    const up = patch.playersUpdate.find((u) => u.playerId === p.id);
    return up ? { ...p, accolades: [...p.accolades, ...up.addAccolades] } : p;
  });
  players.push(...patch.playersAdd);
  players.sort((a, b) => a.id.localeCompare(b.id));

  // Cartas: snapshot actual (sin recomputar) + add/update del patch − removes.
  const existing = ctx.existingCards ?? dedup(ctx.roster.flatMap((p) => cardsForPlayer(p)));
  const removed = new Set(patch.cardsRemove);
  const byId = new Map(existing.filter((c) => !removed.has(c.id)).map((c) => [c.id, c]));
  for (const c of patch.cardsUpdate) if (byId.has(c.id)) byId.set(c.id, c);
  for (const c of patch.cardsAdd) byId.set(c.id, c);
  const cards = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  const playerById = new Map(players.map((p) => [p.id, p]));
  const lookup = (id: string): Player | undefined => playerById.get(id);
  return { artifact: { players, cards }, registry: new CardRegistry(cards, lookup), lookup };
}

const push = (m: Record<string, string[]>, k: string, id: string): void => {
  (m[k] ??= []).push(id);
};

/** Índices completos del catálogo (serializables). */
export function buildIndexes(applied: AppliedCatalog, mat: MaterializationResult, ctx: CatalogBuilderCtx): CatalogIndexes {
  const { artifact, registry, lookup } = applied;
  const byPlayer: Record<string, string[]> = {};
  const byTeam: Record<string, string[]> = {};
  const byRegion: Record<string, string[]> = {};
  const byVariant: Record<string, string[]> = {};
  const byGroup: Record<string, string[]> = {};
  const byRarity: Record<RarityBucket, string[]> = { common: [], uncommon: [], rare: [], epic: [], legendary: [] };

  for (const c of artifact.cards) {
    push(byPlayer, c.playerId, c.id);
    const p = lookup(c.playerId);
    if (p) { push(byTeam, p.team, c.id); push(byRegion, p.region, c.id); }
    push(byVariant, c.variantId, c.id);
    const v = getVariant(c.variantId);
    push(byGroup, v.group, c.id);
    byRarity[bucketForRank(v.rank)].push(c.id);
  }

  // Procedencia: generación actual + procedencia conocida de builds anteriores (incremental).
  const bySeason: Record<string, string[]> = {};
  const byFamily: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const m of mat.cards) { push(bySeason, String(m.season), m.card.id); push(byFamily, m.family, m.card.id); seen.add(m.card.id); }
  for (const k of ctx.knownProvenance ?? []) {
    if (seen.has(k.cardId)) continue;
    push(bySeason, String(k.season), k.cardId);
    push(byFamily, k.family, k.cardId);
  }

  const byCollection: Record<string, string[]> = {};
  for (const col of mat.collectionPatch.add) byCollection[col.id] = col.items.map((i) => i.cardId);
  for (const up of mat.collectionPatch.update) byCollection[up.collectionId] = up.addItems.map((i) => i.cardId);

  const byPack: Record<string, string[]> = {};
  for (const pool of mat.packPatch.pools) byPack[pool.packId] = pool.add.map((e) => e.cardId);

  const byMarket = {
    tradable: mat.marketPatch.entries.filter((e) => e.tradable).map((e) => e.cardId).sort(),
    restricted: mat.marketPatch.entries.filter((e) => !e.tradable).map((e) => e.cardId).sort(),
  };

  const byCraft: Record<string, string[]> = {};
  for (const l of mat.craftPatch.links) for (const r of l.recipes) push(byCraft, r, l.cardId);

  return { byPlayer, byTeam, byRegion, byVariant, byGroup, byRarity, bySeason, byFamily, byCollection, byPack, byMarket, byCraft, sets: registry.allSets() };
}

function dedup(cards: CardDef[]): CardDef[] {
  const seen = new Set<string>();
  const out: CardDef[] = [];
  for (const c of cards) { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } }
  return out;
}
