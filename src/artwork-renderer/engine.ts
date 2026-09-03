/**
 * RENDERER ENGINE — orquesta el render de cartas y generaciones: cache en memoria por
 * renderKey (cero renders duplicados), render INCREMENTAL contra el manifest existente en
 * disco (una carta ya renderizada con la misma huella no se re-rasteriza), assets
 * materializados una sola vez (AssetMaterializer) y salida oficial:
 *
 *   <outputDir>/cards/<CardId>.png|.webp · thumbnails/<CardId>.png ·
 *   previews/<CardId>.webp · manifest.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artworkHash, type ArtworkEngine } from "@/artwork";
import type { ArtworkComposition } from "@/artwork-composer";
import { exportPng, exportWebp } from "./export";
import { renderFingerprint, renderKey, renderMetadata, sha256 } from "./fingerprint";
import { AssetMaterializer, type LocalReader } from "./images";
import { makePreview } from "./preview";
import { assertRenderable, buildCardSvg } from "./renderer";
import { makeThumbnail } from "./thumbnail";
import {
  DEFAULT_SIZES, RENDERER_SCHEMA_VERSION, RENDER_VERSION,
  type RenderManifest, type RenderOptions, type RenderStats, type RenderedArtwork, type RenderedFile,
} from "./types";

export interface RendererOptions extends Partial<Omit<RenderOptions, "outputDir" | "now">> {
  outputDir: string;
  now: number;
  reader?: LocalReader;
}

export class ArtworkRenderer {
  readonly opts: RenderOptions;
  private assets: AssetMaterializer;
  private memo = new Map<string, RenderedArtwork>();
  /** Entradas del manifest previo en disco (render incremental). */
  private previous = new Map<string, RenderedArtwork>();
  private stats: RenderStats = { cards: 0, rendered: 0, cacheHits: 0, assetLoads: 0, assetReuses: 0, totalBytes: 0 };

  constructor(artwork: ArtworkEngine, opts: RendererOptions) {
    this.opts = {
      card: opts.card ?? DEFAULT_SIZES.card,
      thumbnail: opts.thumbnail ?? DEFAULT_SIZES.thumbnail,
      preview: opts.preview ?? DEFAULT_SIZES.preview,
      outputDir: opts.outputDir,
      now: opts.now,
      generationId: opts.generationId,
    };
    this.assets = new AssetMaterializer(artwork, opts.reader);
    this.loadPrevious();
  }

  private loadPrevious(): void {
    const path = join(this.opts.outputDir, "manifest.json");
    if (!existsSync(path)) return;
    try {
      const m = JSON.parse(readFileSync(path, "utf8")) as RenderManifest;
      for (const c of m.cards ?? []) this.previous.set(c.cardId, c);
    } catch { /* manifest ilegible ⇒ render completo */ }
  }

  private fileOk(f: RenderedFile): boolean {
    return existsSync(join(this.opts.outputDir, f.path));
  }

  /** Renderiza UNA composición (o la sirve de cache/incremental). Jamás re-decide capas. */
  async renderCard(comp: ArtworkComposition): Promise<RenderedArtwork> {
    assertRenderable(comp); // también en rutas de cache: inválida ⇒ rechazada SIEMPRE
    const key = renderKey(comp, this.opts);
    this.stats.cards++;

    const memo = this.memo.get(key);
    if (memo) { this.stats.cacheHits++; return { ...memo, fromCache: true }; }

    const prev = this.previous.get(comp.cardId);
    if (prev && prev.renderKey === key && prev.files.every((f) => this.fileOk(f))) {
      const hit: RenderedArtwork = { ...prev, fromCache: true };
      this.memo.set(key, hit);
      this.stats.cacheHits++;
      return hit;
    }

    const meta = renderMetadata(comp, this.opts);
    const svg = buildCardSvg(comp, this.opts.card, this.assets);
    const png = await exportPng(svg, meta);
    const webp = await exportWebp(svg, meta);
    const thumb = await makeThumbnail(png, this.opts.thumbnail, meta);
    const preview = await makePreview(png, this.opts.preview, meta);

    const files: RenderedFile[] = [
      this.write("png", `cards/${comp.cardId}.png`, png, this.opts.card),
      this.write("webp", `cards/${comp.cardId}.webp`, webp, this.opts.card),
      this.write("thumbnail", `thumbnails/${comp.cardId}.png`, thumb, this.opts.thumbnail),
      this.write("preview", `previews/${comp.cardId}.webp`, preview, this.opts.preview),
    ];

    const out: RenderedArtwork = {
      cardId: comp.cardId,
      generationId: meta.generationId,
      artworkFingerprint: comp.fingerprint,
      renderKey: key,
      renderFingerprint: renderFingerprint(meta),
      metadata: meta,
      files,
      fromCache: false,
      placeholdersUsed: comp.placeholdersUsed,
    };
    this.memo.set(key, out);
    this.stats.rendered++;
    this.stats.totalBytes += files.reduce((a, f) => a + f.bytes, 0);
    return out;
  }

  private write(kind: RenderedFile["kind"], rel: string, buf: Buffer, size: { width: number; height: number }): RenderedFile {
    const abs = join(this.opts.outputDir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, buf);
    return { kind, path: rel, bytes: buf.length, sha256: sha256(buf), width: size.width, height: size.height };
  }

  /** Renderiza una generación completa y escribe el manifest oficial. */
  async renderGeneration(comps: ArtworkComposition[], generationId: string): Promise<RenderManifest> {
    const cards: RenderedArtwork[] = [];
    for (const comp of comps) cards.push(await this.renderCard(comp));

    const stats = this.snapshotStats();
    const core = {
      schemaVersion: RENDERER_SCHEMA_VERSION,
      renderVersion: RENDER_VERSION,
      generationId,
      renderedAt: this.opts.now,
      sizes: { card: this.opts.card, thumbnail: this.opts.thumbnail, preview: this.opts.preview },
      cards,
      stats,
    };
    // Huella SIN estados de cache ni contadores: dos renders equivalentes ⇒ misma huella.
    const manifest: RenderManifest = {
      ...core,
      fingerprint: artworkHash(JSON.stringify({
        ...core,
        stats: undefined,
        cards: cards.map(({ fromCache: _fc, ...rest }) => rest),
      })),
    };
    mkdirSync(this.opts.outputDir, { recursive: true });
    writeFileSync(join(this.opts.outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  snapshotStats(): RenderStats {
    return { ...this.stats, assetLoads: this.assets.loads, assetReuses: this.assets.reuses };
  }
}
