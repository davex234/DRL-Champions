/**
 * DRL ASSET MANAGER — helpers de almacenamiento (PUROS/isomórficos).
 *
 * Cálculo de ruta particionada, checksum (sha-256) y dimensiones de imagen. Sin
 * dependencias nuevas ni de cliente (lo usa también la ruta de servidor): usa Web
 * Crypto y `createImageBitmap`. El cálculo de checksum/dimensiones se hace en el
 * cliente antes de subir, lo que mantiene barato el servidor a escala.
 * La URL pública del bucket se construye en `repos.ts` (`publicUrl`).
 */
import type { AssetKind } from "@/domain/assets/types";

export const ASSET_BUCKET = "assets";

/** Ruta dentro del bucket: particiona por tipo/sujeto para escalar a 100k+. */
export function assetPath(kind: AssetKind, subjectId: string | undefined, assetId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${kind}/${subjectId || "_"}/${assetId}.${safeExt}`;
}

/** Extensión a partir del nombre o el MIME del fichero. */
export function extFromFile(file: { name?: string; type?: string }): string {
  const fromName = file.name?.split(".").pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  const fromType = file.type?.split("/").pop();
  return (fromType ?? "bin").toLowerCase();
}

/** sha-256 en hex de un binario (File/Blob/ArrayBuffer). */
export async function sha256Hex(data: ArrayBuffer | Blob): Promise<string> {
  const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Dimensiones de una imagen (solo navegador). Vídeo/lottie/JSON → null. */
export async function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function" || !file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close?.();
    return dims;
  } catch {
    return null;
  }
}
