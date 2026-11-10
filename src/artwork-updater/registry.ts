/**
 * REGISTRY — snapshot del estado a comparar: convierte el contenido del Artwork Manager (o
 * la salida de Acquisition) en un mapa determinista assetId → IncomingAsset. Los
 * placeholders oficiales NO forman parte del ciclo de vida (no se versionan ni caducan).
 */
import type { ArtworkEngine } from "@/artwork";
import type { IncomingAsset } from "./types";

/** Snapshot del Manager (solo assets reales; orden estable por id). */
export function snapshotManager(artwork: ArtworkEngine): IncomingAsset[] {
  return artwork.registry.list()
    .filter((a) => !a.placeholder)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((asset) => ({ asset }));
}

/** Índice por assetId (entrada del diff). */
export function indexIncoming(incoming: IncomingAsset[]): Map<string, IncomingAsset> {
  const out = new Map<string, IncomingAsset>();
  for (const i of incoming) out.set(i.asset.id, i);
  return out;
}
