/**
 * CACHE — evita trabajo repetido en las tres etapas caras: descargas (por sourceRef),
 * validaciones (por huella del contenido) y normalizaciones (por huella + categoría).
 * En memoria, con coalescing de descargas en vuelo. Estadísticas para el informe.
 */
import { artworkHash } from "@/artwork";
import type { CandidateValidation, NormalizedAsset } from "./types";

export class AcquisitionCache {
  private downloads = new Map<string, Uint8Array>();
  private inFlight = new Map<string, Promise<Uint8Array>>();
  private validations = new Map<string, CandidateValidation>();
  private normalizations = new Map<string, NormalizedAsset>();
  stats = { downloadHits: 0, validationHits: 0, normalizationHits: 0 };

  async download(sourceRef: string, fetch: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const hit = this.downloads.get(sourceRef);
    if (hit) { this.stats.downloadHits++; return hit; }
    const flying = this.inFlight.get(sourceRef);
    if (flying) { this.stats.downloadHits++; return flying; }
    const p = fetch().then((bytes) => { this.downloads.set(sourceRef, bytes); return bytes; });
    this.inFlight.set(sourceRef, p);
    try { return await p; } finally { this.inFlight.delete(sourceRef); }
  }

  contentKey(bytes: Uint8Array): string { return artworkHash(bytes); }

  async validate(key: string, run: () => Promise<CandidateValidation>): Promise<CandidateValidation> {
    const hit = this.validations.get(key);
    if (hit) { this.stats.validationHits++; return hit; }
    const v = await run();
    this.validations.set(key, v);
    return v;
  }

  async normalize(key: string, run: () => Promise<NormalizedAsset>): Promise<NormalizedAsset> {
    const hit = this.normalizations.get(key);
    if (hit) { this.stats.normalizationHits++; return hit; }
    const n = await run();
    this.normalizations.set(key, n);
    return n;
  }
}
