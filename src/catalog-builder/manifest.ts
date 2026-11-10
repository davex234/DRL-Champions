/**
 * MANIFEST (Fase 6) — CatalogVersion semántica + CatalogFingerprint + hashes por sección.
 * REUTILIZA `canonicalJson`/digest del Materializer (mismo SHA-256 de platform). El
 * fingerprint global permite cache/rollback/comparación/publicación incremental.
 *
 * Versionado `<temporada>.<minor>.<patch>`: temporada nueva ⇒ reset a `<t>.1.0`;
 * cambios estructurales (add/remove/retire) ⇒ minor+1; solo metadatos ⇒ patch+1.
 */
import { IMPORTER_SCHEMA_VERSION } from "@/importer";
import { ANALYZER_RESULT_SCHEMA_VERSION } from "@/analyzer";
import { CARD_GENERATOR_SCHEMA_VERSION } from "@/card-generator";
import { MATERIALIZER_SCHEMA_VERSION, canonicalJson, type Digest, type MaterializationResult } from "@/materializer";
import { APP_VERSION } from "@/platform/version";
import {
  CATALOG_BUILDER_SCHEMA_VERSION,
  type CatalogVersion, type CatalogManifest, type CatalogDiff,
} from "./types";

export function nextCatalogVersion(prev: CatalogVersion | undefined, season: number, diff: CatalogDiff): CatalogVersion {
  const structural = diff.added.length + diff.removed.length + diff.retired.length > 0;
  const m = prev?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m || Number(m[1]) !== season) return `${season}.1.0`;
  const [, , minor, patch] = m;
  return structural ? `${season}.${Number(minor) + 1}.0` : `${season}.${minor}.${Number(patch) + 1}`;
}

const hashOf = async (digest: Digest, value: unknown): Promise<string> =>
  digest(new TextEncoder().encode(canonicalJson(value)));

export interface ManifestInput {
  mat: MaterializationResult;
  catalogVersion: CatalogVersion;
  sections: Record<string, unknown>;
  counts: CatalogManifest["counts"];
  at: number;
  digest: Digest;
}

export async function buildManifest(i: ManifestInput): Promise<{ manifest: CatalogManifest; catalogFingerprint: string }> {
  const hashes: Record<string, string> = {};
  for (const key of Object.keys(i.sections).sort()) hashes[key] = await hashOf(i.digest, i.sections[key]);

  // Fingerprint GLOBAL: hash del conjunto de hashes de sección + versión (todo el catálogo).
  const catalogFingerprint = await hashOf(i.digest, { catalogVersion: i.catalogVersion, hashes });

  return {
    catalogFingerprint,
    manifest: {
      catalogVersion: i.catalogVersion,
      catalogFingerprint,
      generationId: i.mat.generationId,
      materializationFingerprints: i.mat.cards.map((c) => c.fingerprint).sort(),
      counts: i.counts,
      hashes,
      dependencies: {
        importerSchema: IMPORTER_SCHEMA_VERSION,
        analyzerSchema: ANALYZER_RESULT_SCHEMA_VERSION,
        generatorSchema: CARD_GENERATOR_SCHEMA_VERSION,
        materializerSchema: MATERIALIZER_SCHEMA_VERSION,
        catalogBuilderSchema: CATALOG_BUILDER_SCHEMA_VERSION,
        appVersion: APP_VERSION,
      },
      at: i.at,
    },
  };
}
