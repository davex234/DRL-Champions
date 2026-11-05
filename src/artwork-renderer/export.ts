/**
 * EXPORT — rasterización y codificación DETERMINISTAS con sharp/libvips (ya presente en el
 * proyecto vía next; concurrencia fijada a 1 y opciones de codec fijas ⇒ byte a byte
 * reproducible en el mismo entorno). Cada imagen lleva la metadata del render embebida
 * (EXIF ImageDescription: GenerationId · CardId · ArtworkFingerprint · RenderVersion ·
 * fecha lógica). Sin red, sin fuentes remotas, sin servicios.
 */
import sharp from "sharp";
import type { RenderMetadata, RenderSize } from "./types";

sharp.concurrency(1);
sharp.simd(false);

const exifOf = (meta: RenderMetadata): { IFD0: Record<string, string> } => ({
  IFD0: { ImageDescription: JSON.stringify(meta) },
});

/** SVG maestro → PNG (compresión fija, metadata embebida). */
export async function exportPng(svg: string, meta: RenderMetadata): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 72 })
    .withExif(exifOf(meta))
    .png({ compressionLevel: 9, effort: 7, palette: false })
    .toBuffer();
}

/** SVG maestro → WEBP lossless (esfuerzo fijo, metadata embebida). */
export async function exportWebp(svg: string, meta: RenderMetadata): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 72 })
    .withExif(exifOf(meta))
    .webp({ lossless: true, effort: 4 })
    .toBuffer();
}

/** Reescala un PNG maestro a un tamaño derivado, conservando la metadata. */
export async function resizeTo(master: Buffer, size: RenderSize, format: "png" | "webp", meta: RenderMetadata): Promise<Buffer> {
  const base = sharp(master).resize(size.width, size.height, { fit: "fill", kernel: "lanczos3" }).withExif(exifOf(meta));
  return format === "png"
    ? base.png({ compressionLevel: 9, effort: 7, palette: false }).toBuffer()
    : base.webp({ lossless: true, effort: 4 }).toBuffer();
}

/** Decodifica dimensiones y metadata embebida (para verificación). */
export async function inspectImage(buf: Buffer): Promise<{ width: number; height: number; format: string; description: string }> {
  const m = await sharp(buf).metadata();
  const description = m.exif ? m.exif.toString("latin1") : "";
  return { width: m.width ?? 0, height: m.height ?? 0, format: m.format ?? "", description };
}
