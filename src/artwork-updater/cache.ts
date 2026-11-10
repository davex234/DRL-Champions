/**
 * CACHE — invalidación QUIRÚRGICA: solo los assets modificados o eliminados del diff (ids +
 * rutas), jamás toda la cache. Incluye el puente con el Renderer: qué composiciones quedan
 * afectadas por una invalidación (para re-renderizar SOLO esas cartas).
 */
import type { ArtworkComposition } from "@/artwork-composer";
import type { AssetDiff, CacheInvalidation, IncomingAsset, LifecycleState } from "./types";
import { currentVersion } from "./versions";

/** Claves a invalidar de un diff (SOLO modificados + eliminados). */
export function invalidationOf(diff: AssetDiff, state: LifecycleState, incoming: IncomingAsset[]): CacheInvalidation {
  const byId = new Map(incoming.map((i) => [i.asset.id, i]));
  const assetIds = [...diff.modified.map((m) => m.assetId), ...diff.removed].sort();
  const paths = [...new Set(assetIds.flatMap((id) => {
    const next = byId.get(id)?.asset.path;
    const prev = state.assets[id] ? currentVersion(state.assets[id]).asset.path : undefined;
    return [next, prev].filter((p): p is string => !!p);
  }))].sort();
  return { assetIds, paths };
}

/**
 * Composiciones afectadas por una invalidación (las ÚNICAS que un host debe re-renderizar).
 * Solo LEE `assetsUsed` de composiciones ya existentes: jamás las modifica.
 */
export function affectedCompositions(comps: ArtworkComposition[], invalidated: CacheInvalidation): string[] {
  const ids = new Set(invalidated.assetIds);
  return comps.filter((c) => c.assetsUsed.some((ref) => ids.has(ref))).map((c) => c.cardId).sort();
}

/** Cache genérica de trabajo con invalidación selectiva (jamás clear-all). */
export class SelectiveCache<T> {
  private byAssetId = new Map<string, T>();
  invalidations = 0;

  set(assetId: string, value: T): void { this.byAssetId.set(assetId, value); }
  get(assetId: string): T | undefined { return this.byAssetId.get(assetId); }
  get size(): number { return this.byAssetId.size; }

  /** Invalida SOLO las claves indicadas; el resto de la cache queda intacto. */
  invalidate(inv: CacheInvalidation): number {
    let n = 0;
    for (const id of inv.assetIds) if (this.byAssetId.delete(id)) n++;
    this.invalidations += n;
    return n;
  }
}
