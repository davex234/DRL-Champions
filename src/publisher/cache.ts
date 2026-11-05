/**
 * CACHE MANAGER (Fase 7) — invalidación INCREMENTAL por huellas: CatalogFingerprint (build ya
 * publicada ⇒ no-op idempotente), MaterializationFingerprints (qué cambió de verdad) y
 * GenerationId. Solo se refresca lo necesario; los pools de packs solo los del artefacto.
 */
import type { CatalogBuildResult } from "@/catalog-builder";
import type { CacheInvalidation } from "./types";
import { runtimeFingerprint, knownMaterializationFingerprints } from "./runtime";

export function planInvalidation(build: CatalogBuildResult): CacheInvalidation {
  const alreadyPublished = build.catalogFingerprint !== "" && build.catalogFingerprint === runtimeFingerprint();
  const known = knownMaterializationFingerprints();
  const newFingerprints = build.manifest.materializationFingerprints.filter((f) => !known.has(f));
  const structural = newFingerprints.length > 0 || build.diff.removed.length > 0 || build.diff.retired.length > 0;
  return {
    alreadyPublished,
    newFingerprints,
    pools: alreadyPublished ? [] : build.packs.invalidated,
    refreshSearch: !alreadyPublished && structural,
    refreshCollections: !alreadyPublished && (build.collections.collections.length > 0),
    refreshMarket: !alreadyPublished && build.marketplace.entries.length > 0,
    refreshNews: !alreadyPublished && build.news.length > 0,
  };
}

export function commitFingerprints(build: CatalogBuildResult): void {
  const known = knownMaterializationFingerprints();
  for (const f of build.manifest.materializationFingerprints) known.add(f);
}
