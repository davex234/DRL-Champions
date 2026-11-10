/**
 * DEDUPE — un recurso jamás se almacena dos veces: detección por HASH de contenido
 * normalizado, por SUJETO (categoría+subjectId ya adquirido), por ALIAS y por ORIGEN
 * (mismo proveedor + sourceRef). Devuelve el asset original al detectar duplicado.
 */
import type { ArtworkAsset } from "@/artwork";
import type { AcquisitionTarget, AssetCandidate } from "./types";

export class DedupeIndex {
  private byContentHash = new Map<string, ArtworkAsset>();
  private bySubject = new Map<string, ArtworkAsset>();
  private byAlias = new Map<string, ArtworkAsset>();
  private bySource = new Map<string, ArtworkAsset>();

  /** ¿Ya existe este recurso? (contenido, sujeto, alias u origen). */
  find(target: AcquisitionTarget, contentHash: string, candidate?: AssetCandidate): ArtworkAsset | undefined {
    return this.byContentHash.get(contentHash)
      ?? this.bySubject.get(`${target.category}:${target.subjectId}`)
      ?? target.searchTerms.map((t) => this.byAlias.get(`${target.category}|${t}`)).find(Boolean)
      ?? (candidate ? this.bySource.get(`${candidate.providerId}|${candidate.sourceRef}`) : undefined);
  }

  register(target: AcquisitionTarget, contentHash: string, asset: ArtworkAsset, candidate?: AssetCandidate): void {
    this.byContentHash.set(contentHash, asset);
    this.bySubject.set(`${target.category}:${target.subjectId}`, asset);
    for (const t of target.searchTerms) this.byAlias.set(`${target.category}|${t}`, asset);
    if (candidate) this.bySource.set(`${candidate.providerId}|${candidate.sourceRef}`, asset);
  }

  get size(): number { return this.bySubject.size; }
}
