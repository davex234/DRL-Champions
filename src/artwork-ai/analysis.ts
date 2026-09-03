/**
 * ANALYSIS — extracción de métricas OBJETIVAS de un asset, en solo lectura: dimensiones,
 * alpha, ratio de transparencia, opacidad en bordes, nitidez (stddev de luminancia),
 * compresión (bytes/píxel) y huella del contenido decodificado. Un asset ilegible jamás
 * rompe el análisis: se marca corrupt/ausente y se sigue.
 */
import sharp from "sharp";
import { artworkHash, type ArtworkEngine } from "@/artwork";
import type { PixelAnalysis } from "./types";

sharp.concurrency(1);

/** Analiza los BYTES de una imagen (lectura pura; jamás re-codifica ni escribe). */
export async function analyzePixels(bytes: Uint8Array): Promise<PixelAnalysis> {
  try {
    const img = sharp(Buffer.from(bytes));
    const meta = await img.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;

    let transparent = 0;
    let lumSum = 0, lumSq = 0;
    const total = info.width * info.height;
    for (let i = 0; i < total; i++) {
      const o = i * ch;
      if (data[o + 3] < 16) transparent++;
      const lum = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) / 255;
      lumSum += lum;
      lumSq += lum * lum;
    }
    const mean = lumSum / total;
    const sharpness = Math.min(1, Math.sqrt(Math.max(0, lumSq / total - mean * mean)) * 2);

    // Opacidad pegada al borde (índice de recorte / fondo sin eliminar).
    let edgeOpaque = 0, edgeCount = 0;
    const sample = (x: number, y: number): void => {
      const o = (y * info.width + x) * ch;
      edgeCount++;
      if (data[o + 3] >= 240) edgeOpaque++;
    };
    for (let x = 0; x < info.width; x += Math.max(1, Math.floor(info.width / 64))) {
      sample(x, 0); sample(x, info.height - 1);
    }
    for (let y = 0; y < info.height; y += Math.max(1, Math.floor(info.height / 64))) {
      sample(0, y); sample(info.width - 1, y);
    }

    return {
      width, height,
      hasAlpha: meta.hasAlpha ?? false,
      transparentRatio: transparent / total,
      edgeOpaqueRatio: edgeCount ? edgeOpaque / edgeCount : 0,
      sharpness,
      bytesPerPixel: total ? bytes.length / total : 0,
      contentHash: artworkHash(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
      corrupt: false,
    };
  } catch {
    return {
      width: 0, height: 0, hasAlpha: false, transparentRatio: 0, edgeOpaqueRatio: 0,
      sharpness: 0, bytesPerPixel: 0, contentHash: artworkHash(bytes), corrupt: true,
    };
  }
}

export type QualityReader = (publicPath: string) => Uint8Array;

/**
 * Análisis de píxeles para TODOS los assets legibles del Manager (locales vía reader,
 * data-svg NO se rasteriza: metadatos). Remotos/css ⇒ null (análisis por metadatos).
 */
export async function analyzeManagerPixels(
  artwork: ArtworkEngine, reader?: QualityReader,
): Promise<Map<string, PixelAnalysis | null>> {
  const out = new Map<string, PixelAnalysis | null>();
  const byPath = new Map<string, PixelAnalysis | null>();
  for (const a of artwork.registry.list()) {
    if (a.placeholder) continue;
    // Formatos que libvips no decodifica (ico): análisis por metadatos, sin falsos corruptos.
    if (!a.path.startsWith("/") || !reader || a.format === "ico") { out.set(a.id, null); continue; }
    let hit = byPath.get(a.path);
    if (hit === undefined) {
      try { hit = await analyzePixels(reader(a.path)); } catch { hit = null; }
      byPath.set(a.path, hit);
    }
    out.set(a.id, hit);
  }
  return out;
}
