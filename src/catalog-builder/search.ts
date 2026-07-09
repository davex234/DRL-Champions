/**
 * SEARCH (Fase 6) — índice de búsqueda serializable/cacheable. Filas de carta REUTILIZANDO
 * el índice del CardRegistry (`registry.search()`, mismo formato hay-stack) + entradas de
 * jugador/equipo/colección/temporada/variante con tags. Determinista.
 */
import { getVariant } from "@/domain/cards/variants";
import type { MaterializationResult } from "@/materializer";
import type { CollectionsArtifact, SearchArtifact } from "./types";
import type { AppliedCatalog } from "./catalog";

export function buildSearch(mat: MaterializationResult, applied: AppliedCatalog, collections: CollectionsArtifact): SearchArtifact {
  const rows: SearchArtifact["rows"] = [];

  // Cartas: filas del CardRegistry (REUTILIZADAS) + tags editoriales de esta generación.
  const tagsBy = new Map(mat.cards.map((c) => [c.card.id, [...c.badges, ...c.narrativeTags, ...c.historicalTags, c.family].join(" ")]));
  for (const r of applied.registry.search()) {
    const extra = tagsBy.get(r.cardId);
    rows.push({ kind: "card", ref: r.cardId, hay: extra ? `${r.hay} ${extra.toLowerCase()}` : r.hay });
  }

  const teams = new Set<string>();
  for (const p of applied.artifact.players) {
    rows.push({ kind: "player", ref: p.id, hay: `${p.nick} ${p.fullName ?? ""} ${p.team} ${p.region} ${p.role}`.toLowerCase() });
    if (p.team) teams.add(p.team);
  }
  for (const t of [...teams].sort()) rows.push({ kind: "team", ref: t, hay: t.toLowerCase() });
  for (const c of collections.collections) rows.push({ kind: "collection", ref: c.id, hay: `${c.name} ${c.slug}`.toLowerCase() });
  for (const season of Object.keys(collections.series).length ? [String(mat.collectionPatch.season)] : []) {
    rows.push({ kind: "season", ref: season, hay: `temporada ${season}` });
  }
  const variantIds = new Set(applied.artifact.cards.map((c) => c.variantId));
  for (const v of [...variantIds].sort()) rows.push({ kind: "variant", ref: v, hay: `${v} ${getVariant(v).label}`.toLowerCase() });

  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref));
  return { rows };
}
