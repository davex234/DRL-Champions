/**
 * FILTROS + ORDEN del Review Dashboard. Puros: no tocan el modelo, devuelven copias.
 * Facetas exactas (equipo/jugador/rareza/colección/torneo/estado/variante) y orden por
 * OVR / rareza / jugador / fecha.
 */
import type { RarityBucket } from "@/domain/packs/types";
import type { CardStatus } from "@/card-generator";
import type { ReviewCardRow, ReviewFacets, ReviewFilter, ReviewSortKey } from "./types";

const RARITY_RANK: Record<RarityBucket, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

export function applyReviewFilter(rows: ReviewCardRow[], f: ReviewFilter): ReviewCardRow[] {
  return rows.filter((r) =>
    (!f.team || r.team === f.team) &&
    (!f.player || r.player === f.player) &&
    (!f.rarity || r.rarityBucket === f.rarity) &&
    (!f.collection || r.collections.some((c) => c.id === f.collection)) &&
    (!f.tournament || r.tournamentId === f.tournament || r.tournamentName === f.tournament) &&
    (!f.status || r.status === f.status) &&
    (!f.variant || r.variantId === f.variant));
}

export function sortReviewRows(rows: ReviewCardRow[], key: ReviewSortKey): ReviewCardRow[] {
  const out = [...rows];
  switch (key) {
    case "ovr":
      return out.sort((a, b) => b.ovr - a.ovr || a.cardId.localeCompare(b.cardId));
    case "rarity":
      return out.sort((a, b) => RARITY_RANK[b.rarityBucket] - RARITY_RANK[a.rarityBucket] || b.ovr - a.ovr || a.cardId.localeCompare(b.cardId));
    case "player":
      return out.sort((a, b) => a.player.localeCompare(b.player) || b.ovr - a.ovr || a.cardId.localeCompare(b.cardId));
    case "date":
      return out.sort((a, b) => b.generatedAt - a.generatedAt || a.cardId.localeCompare(b.cardId));
  }
}

/** Valores distintos por faceta, ordenados, para los selects del dashboard. */
export function reviewFacets(rows: ReviewCardRow[]): ReviewFacets {
  const uniq = (xs: string[]): string[] => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const collections = new Map<string, string>();
  for (const r of rows) for (const c of r.collections) collections.set(c.id, c.name);
  return {
    teams: uniq(rows.map((r) => r.team)),
    players: uniq(rows.map((r) => r.player)),
    rarities: [...new Set(rows.map((r) => r.rarityBucket))].sort((a, b) => RARITY_RANK[a] - RARITY_RANK[b]),
    collections: [...collections].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    tournaments: uniq(rows.map((r) => r.tournamentName)),
    statuses: uniq(rows.map((r) => r.status)) as CardStatus[],
    variants: uniq(rows.map((r) => r.variantId)),
  };
}
