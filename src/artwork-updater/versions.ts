/**
 * VERSIONS — modelo de versionado inmutable: cada asset acumula AssetVersion (v1, v2, …)
 * con checksum, fingerprint, proveedor, licencia y fechas LÓGICAS. Añadir una versión
 * jamás toca las anteriores; el historial solo crece.
 */
import { contentChecksum, lifecycleFingerprint } from "./fingerprint";
import type { AssetVersion, IncomingAsset, VersionedAsset } from "./types";

export function makeVersion(incoming: IncomingAsset, version: number, at: number): AssetVersion {
  const checksum = contentChecksum(incoming);
  return {
    version,
    asset: incoming.asset,
    checksum,
    fingerprint: lifecycleFingerprint(incoming.asset, checksum, incoming.license),
    provider: incoming.provider,
    license: incoming.license,
    createdAt: at,
    updatedAt: at,
  };
}

/** Versión vigente de un asset versionado. */
export function currentVersion(v: VersionedAsset): AssetVersion {
  return v.versions.find((x) => x.version === v.current) ?? v.versions[v.versions.length - 1];
}

/** Una versión concreta (o undefined). */
export function getVersion(v: VersionedAsset, version: number): AssetVersion | undefined {
  return v.versions.find((x) => x.version === version);
}
