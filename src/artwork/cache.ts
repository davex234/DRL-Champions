/**
 * CACHE — un asset nunca se carga dos veces: cache por id con deduplicación por HASH de
 * contenido (dos ids con el mismo contenido comparten entrada) y coalescing de cargas en
 * vuelo (dos peticiones concurrentes del mismo asset = una sola lectura).
 */
import type { ArtworkAsset, CacheStats, LoadedArtwork } from "./types";

export class ArtworkCache {
  private byId = new Map<string, LoadedArtwork>();
  private byContentHash = new Map<string, LoadedArtwork>();
  private inFlight = new Map<string, Promise<LoadedArtwork>>();
  private stats: CacheStats = { hits: 0, misses: 0, loaded: 0 };

  /** Carga vía `load` solo si no está ya en cache (por id) ni en vuelo. */
  async getOrLoad(asset: ArtworkAsset, load: (a: ArtworkAsset) => Promise<LoadedArtwork>): Promise<LoadedArtwork> {
    const hit = this.byId.get(asset.id);
    if (hit) { this.stats.hits++; return hit; }
    const flying = this.inFlight.get(asset.id);
    if (flying) { this.stats.hits++; return flying; }

    this.stats.misses++;
    const p = (async () => {
      const loaded = await load(asset);
      // Dedupe por contenido: mismo hash ⇒ misma entrada compartida.
      const same = this.byContentHash.get(loaded.contentHash);
      const entry = same ?? loaded;
      if (!same) { this.byContentHash.set(loaded.contentHash, entry); this.stats.loaded++; }
      this.byId.set(asset.id, entry);
      return entry;
    })();
    this.inFlight.set(asset.id, p);
    try {
      return await p;
    } finally {
      this.inFlight.delete(asset.id);
    }
  }

  peek(assetId: string): LoadedArtwork | undefined { return this.byId.get(assetId); }
  peekByHash(contentHash: string): LoadedArtwork | undefined { return this.byContentHash.get(contentHash); }

  get size(): number { return this.byId.size; }
  /** Entradas de contenido ÚNICAS realmente cargadas. */
  get uniqueLoaded(): number { return this.byContentHash.size; }
  snapshot(): CacheStats { return { ...this.stats }; }
  clear(): void {
    this.byId.clear();
    this.byContentHash.clear();
    this.inFlight.clear();
    this.stats = { hits: 0, misses: 0, loaded: 0 };
  }
}
