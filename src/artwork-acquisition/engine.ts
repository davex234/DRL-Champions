/**
 * ACQUISITION ENGINE — el pipeline completo por objetivo:
 *
 *   asset requerido → identidad → buscar candidatos → seleccionar → descargar → validar →
 *   normalizar → hash → deduplicar → registrar (Artwork Manager)
 *
 * Salida EXCLUSIVA: ArtworkAsset registrados + informe. Jamás renderiza, jamás compone,
 * jamás toca una ArtworkComposition. Determinista con proveedores/reloj inyectados.
 */
import { artworkHash, type ArtworkEngine } from "@/artwork";
import type { CardGenerationResult } from "@/card-generator";
import { AcquisitionCache } from "./cache";
import { DedupeIndex } from "./dedupe";
import { downloadCandidate } from "./download";
import { normalizeCandidate } from "./normalization";
import { rankProviders, selectCandidate } from "./providers";
import { AcquisitionRegistry } from "./registry";
import { scanGeneration } from "./resolver";
import { validateCandidate } from "./validation";
import {
  ACQUISITION_SCHEMA_VERSION,
  type AcquiredAsset, type AcquisitionReport, type AcquisitionTarget, type AssetCandidate,
  type AssetProvider, type ValidationIssue,
} from "./types";

export interface AcquisitionOptions {
  providers: AssetProvider[];
  /** Raíz donde se almacenan los assets normalizados (producción: `public/`). */
  assetsRoot: string;
  /** Reloj lógico del informe. */
  now: number;
  /** Máximo de candidatos a probar por objetivo (el resto se ignora). */
  maxAttempts?: number;
}

export class AcquisitionEngine {
  private cache = new AcquisitionCache();
  private dedupe = new DedupeIndex();
  private registry: AcquisitionRegistry;
  private fileByContent = new Map<string, string>();

  constructor(private artwork: ArtworkEngine, private opts: AcquisitionOptions) {
    this.registry = new AcquisitionRegistry(artwork, opts.assetsRoot);
  }

  /** Ejecuta el pipeline para UN objetivo. Jamás lanza: todo termina en un outcome. */
  async acquireTarget(target: AcquisitionTarget): Promise<AcquiredAsset & { found: number }> {
    const existing = this.artwork.registry.forSubject(target.category, target.subjectId);
    if (existing) return { target, outcome: "already-available", asset: existing, found: 0 };

    const providers = await rankProviders(this.opts.providers);
    const byId = new Map(providers.map((p) => [p.id, p]));
    const candidates: AssetCandidate[] = [];
    for (const p of providers) {
      try { candidates.push(...await p.search(target)); } catch { /* proveedor caído ⇒ se salta */ }
    }
    if (!candidates.length) return { target, outcome: "pending", found: 0 };

    const issues: ValidationIssue[] = [];
    const pool = [...candidates];
    for (let attempt = 0; attempt < (this.opts.maxAttempts ?? 3) && pool.length; attempt++) {
      const candidate = selectCandidate(pool)!;
      pool.splice(pool.indexOf(candidate), 1);

      const bytes = await downloadCandidate(candidate, byId, this.cache);
      if (!bytes) { issues.push({ code: "CORRUPT", message: `descarga fallida: ${candidate.sourceRef}` }); continue; }

      const key = `${this.cache.contentKey(bytes)}|${target.category}`;
      const v = await this.cache.validate(key, () => validateCandidate(bytes, target.category));
      if (!v.ok) { issues.push(...v.issues); continue; }

      const norm = await this.cache.normalize(key, () => normalizeCandidate(bytes, target));

      // Deduplicación: contenido/sujeto/alias/origen ya adquirido ⇒ reutilizar, no almacenar.
      const dup = this.dedupe.find(target, norm.contentHash, candidate);
      if (dup) {
        const asset = this.registry.registerAt(target, dup.path, norm);
        this.dedupe.register(target, norm.contentHash, asset, candidate);
        return { target, outcome: "reused", providerId: candidate.providerId, candidate, asset, contentHash: norm.contentHash, found: candidates.length };
      }

      const asset = this.registry.register(norm);
      this.fileByContent.set(norm.contentHash, asset.path);
      this.dedupe.register(target, norm.contentHash, asset, candidate);
      return { target, outcome: "downloaded", providerId: candidate.providerId, candidate, asset, contentHash: norm.contentHash, found: candidates.length };
    }

    return { target, outcome: "rejected", issues, found: candidates.length };
  }

  /** Recorre TODA la generación: detecta faltantes, adquiere y registra. */
  async acquireForGeneration(gen: CardGenerationResult): Promise<AcquisitionReport> {
    const scan = scanGeneration(this.artwork, gen);
    const results: AcquiredAsset[] = [];
    let found = 0;
    for (const target of scan.targets) {
      const r = await this.acquireTarget(target);
      found += r.found;
      results.push(r);
    }

    const count = (o: AcquiredAsset["outcome"]): number => results.filter((r) => r.outcome === o).length;
    const core = {
      schemaVersion: ACQUISITION_SCHEMA_VERSION,
      generationId: gen.generationId,
      at: this.opts.now,
      required: scan.targets.length + scan.available.length,
      available: scan.available.length + count("already-available"),
      downloaded: count("downloaded"),
      reused: count("reused"),
      rejected: count("rejected"),
      pending: count("pending"),
      found,
      results,
      cache: { ...this.cache.stats },
    };
    return { ...core, fingerprint: artworkHash(JSON.stringify({ ...core, at: 0, cache: undefined })) };
  }

  /** Ficheros únicos escritos (cero duplicados de contenido). */
  get uniqueFiles(): number { return this.fileByContent.size; }
}
