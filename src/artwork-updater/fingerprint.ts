/**
 * FINGERPRINT — huella de CICLO DE VIDA de un asset: contenido (checksum) + dimensiones +
 * formato + metadatos relevantes (categoría, sujeto, licencia). JAMÁS depende de la ruta:
 * renombrar un fichero no cambia la identidad; cambiar sus bytes sí.
 */
import { artworkHash, type ArtworkAsset } from "@/artwork";
import type { IncomingAsset } from "./types";

/**
 * Checksum de contenido de un asset SIN bytes cargados: los recursos virtuales llevan su
 * contenido EN la declaración (`data:`/`css:` — la "ruta" ES el contenido, no una ruta), y
 * para el resto se exige checksum explícito (Acquisition lo aporta); si falta, se marca
 * como no verificado de forma determinista (sin usar la ruta).
 */
export function contentChecksum(incoming: IncomingAsset): string {
  if (incoming.checksum) return incoming.checksum;
  const a = incoming.asset;
  if (a.path.startsWith("data:") || a.path.startsWith("css:")) return artworkHash(a.path);
  return `unverified:${artworkHash(`${a.category}|${a.subjectId ?? a.id}|${a.format}|${a.width}x${a.height}`)}`;
}

/** Fingerprint completo (contenido + dimensiones + formato + metadatos; sin rutas). */
export function lifecycleFingerprint(asset: ArtworkAsset, checksum: string, license?: string): string {
  return artworkHash([
    checksum, asset.width, asset.height, asset.format,
    asset.category, asset.subjectId ?? "", license ?? "",
  ].join("|"));
}
