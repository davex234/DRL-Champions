/**
 * CATALOG BUILDER ENGINE (Fase 6) — orquestador: MaterializationResult + ctx →
 * CatalogBuildResult (artefactos completos: catálogo lógico + índices + colecciones +
 * pools + craft + mercado + búsqueda + noticias + manifiesto + stats + diff + validación).
 * PURO: nunca escribe archivos/stores/catálogo vivo, nunca publica. Incremental: las
 * huellas del Materializer marcan lo intacto; solo se regenera lo afectado.
 */
import { defaultDigest, type MaterializationResult } from "@/materializer";
import {
  CATALOG_BUILDER_SCHEMA_VERSION,
  type CatalogBuilderCtx, type CatalogBuildResult,
} from "./types";
import { applyCatalog, buildIndexes } from "./catalog";
import { buildDiff } from "./diff";
import { buildCollections } from "./collections";
import { buildPacks } from "./packs";
import { buildCraft } from "./craft";
import { buildMarketplace } from "./marketplace";
import { buildSearch } from "./search";
import { buildNews } from "./news";
import { buildManifest, nextCatalogVersion } from "./manifest";
import { buildStats } from "./stats";
import { validateBuild } from "./validation";
import { cardsForPlayer } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";

export async function buildCatalog(mat: MaterializationResult, ctx: CatalogBuilderCtx): Promise<CatalogBuildResult> {
  const at = ctx.now ?? mat.provenance.at;
  const digest = ctx.digest ?? defaultDigest;

  // 1. Catálogo lógico incremental + índices (CardRegistry reutilizado).
  const applied = applyCatalog(mat, ctx);
  const existingCards: CardDef[] = ctx.existingCards ?? dedup(ctx.roster.flatMap((p) => cardsForPlayer(p)));

  // 2. Diff + versión semántica.
  const diff = buildDiff(mat, existingCards);
  const catalogVersion = nextCatalogVersion(ctx.previousVersion, mat.collectionPatch.season, diff);

  // 3. Artefactos.
  const indexes = buildIndexes(applied, mat, ctx);
  const collections = buildCollections(mat, ctx.existingCollections ?? [], applied);
  const packs = buildPacks(mat, applied);
  const craft = buildCraft(mat);
  const marketplace = buildMarketplace(mat);
  const search = buildSearch(mat, applied, collections);
  const news = buildNews(mat, diff, at);
  const stats = buildStats({ mat, catalog: applied.artifact, diff, collections, packs, craft, marketplace, search });

  // 4. Manifiesto (hashes por sección + CatalogFingerprint global).
  const { manifest, catalogFingerprint } = await buildManifest({
    mat,
    catalogVersion,
    sections: {
      catalog: applied.artifact, indexes, collections, packs, craft, marketplace, search, news, stats, diff,
    },
    counts: {
      players: applied.artifact.players.length,
      cards: applied.artifact.cards.length,
      collections: collections.collections.length,
      packs: packs.pools.length,
      craftLinks: craft.links.length,
      marketEntries: marketplace.entries.length,
      searchRows: search.rows.length,
      news: news.length,
    },
    at,
    digest,
  });

  // 5. Validación (cero estados imposibles).
  const partial: Omit<CatalogBuildResult, "validation"> = {
    schemaVersion: CATALOG_BUILDER_SCHEMA_VERSION,
    catalogVersion,
    catalogFingerprint,
    generationId: mat.generationId,
    manifest,
    catalog: applied.artifact,
    indexes, collections, packs, craft, marketplace, search, news, stats, diff,
    unchanged: mat.unchanged,
    skipped: mat.skipped,
  };
  return { ...partial, validation: validateBuild(partial) };
}

function dedup(cards: CardDef[]): CardDef[] {
  const seen = new Set<string>();
  const out: CardDef[] = [];
  for (const c of cards) { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } }
  return out;
}
