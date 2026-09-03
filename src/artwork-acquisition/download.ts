/**
 * DOWNLOAD — obtención de bytes de un candidato a través de SU proveedor, SIEMPRE vía
 * cache (cero descargas repetidas, coalescing incluido). La red vive dentro del proveedor
 * (inyectable); un fallo de descarga jamás rompe el pipeline: el objetivo queda pendiente.
 */
import type { AcquisitionCache } from "./cache";
import type { AssetCandidate, AssetProvider } from "./types";

export async function downloadCandidate(
  candidate: AssetCandidate, providers: Map<string, AssetProvider>, cache: AcquisitionCache,
): Promise<Uint8Array | null> {
  const provider = providers.get(candidate.providerId);
  if (!provider) return null;
  try {
    return await cache.download(candidate.sourceRef, () => provider.download(candidate));
  } catch {
    return null;
  }
}
