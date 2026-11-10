/**
 * ASSET LIFECYCLE & UPDATE ENGINE — tipos (Artwork Pipeline · Fase 5/6).
 *
 * Administra EXCLUSIVAMENTE el ciclo de vida de los assets del Artwork Manager: versiones,
 * fingerprints por CONTENIDO (jamás por ruta), diffs entre estados, actualización selectiva,
 * invalidación quirúrgica de cache, historial inmutable y rollback por asset. Nunca genera
 * cartas, nunca renderiza, nunca descarga, nunca toca una ArtworkComposition.
 */
import type { ArtworkAsset } from "@/artwork";
import type { LicenseKind } from "@/artwork-acquisition";

export const UPDATER_SCHEMA_VERSION = 1;

/* ── Entrada: un asset con su procedencia (del Manager o de Acquisition) ──── */

export interface IncomingAsset {
  asset: ArtworkAsset;
  /** Huella del CONTENIDO real (contentHash de Acquisition, o derivada del recurso virtual). */
  checksum?: string;
  provider?: string;
  license?: LicenseKind;
}

/* ── Versionado ───────────────────────────────────────────────────────────── */

export interface AssetVersion {
  version: number;
  asset: ArtworkAsset;
  /** Huella de contenido (checksum) de esta versión. */
  checksum: string;
  /** Fingerprint de ciclo de vida (contenido+dimensiones+formato+metadatos; SIN rutas). */
  fingerprint: string;
  provider?: string;
  license?: LicenseKind;
  createdAt: number;
  updatedAt: number;
}

export type ChangeKind =
  | "added" | "content-changed" | "renamed" | "provider-changed" | "alias-changed"
  | "license-changed" | "hash-changed" | "unchanged" | "removed" | "rolled-back";

export interface ChangeEvent {
  seq: number;
  at: number;
  actor: string;
  assetId: string;
  kind: ChangeKind;
  /** Versión resultante tras el cambio. */
  version: number;
  reason?: string;
  provider?: string;
}

export type AssetStatus = "active" | "removed" | "obsolete";

export interface VersionedAsset {
  assetId: string;
  status: AssetStatus;
  /** Versión vigente (índice en versions por `version`). */
  current: number;
  /** TODAS las versiones (jamás se pierde ninguna). */
  versions: AssetVersion[];
  /** Historial completo (jamás se sobrescribe). */
  history: ChangeEvent[];
}

/** Estado del ciclo de vida (serializable; la ENTRADA y SALIDA del updater). */
export interface LifecycleState {
  schemaVersion: number;
  assets: Record<string, VersionedAsset>;
  /** Secuencia global monótona de eventos. */
  seq: number;
}

/* ── Diff ─────────────────────────────────────────────────────────────────── */

export interface ModifiedAsset {
  assetId: string;
  changes: Exclude<ChangeKind, "added" | "unchanged" | "removed" | "rolled-back">[];
}

export interface AssetDiff {
  added: string[];
  modified: ModifiedAsset[];
  removed: string[];
  /** Presentes pero ya no referenciados (candidatos a limpieza; NUNCA se borran solos). */
  obsolete: string[];
  /** Sin cambios de contenido: su cache es 100% reutilizable. */
  reusable: string[];
  unchanged: string[];
}

/* ── Actualización ────────────────────────────────────────────────────────── */

export interface UpdateMeta {
  actor: string;
  at: number;
  reason?: string;
}

export interface CacheInvalidation {
  assetIds: string[];
  paths: string[];
}

export interface UpdateResult {
  diff: AssetDiff;
  /** SOLO lo modificado/eliminado (jamás se vacía toda la cache). */
  invalidated: CacheInvalidation;
  /** Versiones nuevas creadas en esta pasada. */
  newVersions: number;
}

/* ── Métricas ─────────────────────────────────────────────────────────────── */

export interface LifecycleMetrics {
  active: number;
  obsolete: number;
  removed: number;
  /** Assets actualizados en la última pasada. */
  updated: number;
  cacheInvalidated: number;
  /** Versiones totales almacenadas. */
  versions: number;
  events: number;
}
