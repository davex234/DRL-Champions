/**
 * NORMALIZATION — todo candidato aceptado se convierte al ESTÁNDAR del repositorio:
 * PNG + WEBP lossless al tamaño de su categoría, nombre por convención del Manager,
 * metadatos y huella deterministas (sharp con opciones fijas, igual que el Renderer).
 */
import sharp from "sharp";
import { artworkHash, type ArtworkCategory } from "@/artwork";
import { REQUIREMENTS } from "./validation";
import type { AcquisitionTarget, NormalizedAsset } from "./types";

sharp.concurrency(1);

/** Nombre de fichero estándar del sujeto (convención del Artwork Manager). */
export function standardFileName(category: ArtworkCategory, subjectId: string): string {
  return `${subjectId}.png`;
}

export async function normalizeCandidate(bytes: Uint8Array, target: AcquisitionTarget): Promise<NormalizedAsset> {
  const req = REQUIREMENTS[target.category];
  const width = req?.normalizedWidth ?? 256;
  const height = Math.round(width / (req?.aspect ?? 1));

  const base = sharp(Buffer.from(bytes))
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
    .ensureAlpha();

  const png = await base.clone().png({ compressionLevel: 9, effort: 7, palette: false }).toBuffer();
  const webp = await base.clone().webp({ lossless: true, effort: 4 }).toBuffer();

  return {
    target,
    png,
    webp,
    width,
    height,
    contentHash: artworkHash(png),
    fileName: standardFileName(target.category, target.subjectId),
  };
}
