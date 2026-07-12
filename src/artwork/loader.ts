/**
 * LOADER — carga de contenido con E/S INYECTABLE (`ArtworkReader`): los verifies inyectan
 * un lector en memoria (0 red, 0 fs), la app puede inyectar fetch y los scripts fs. Los
 * recursos virtuales (`data:` y `css:`) se materializan sin lector: su contenido ES su
 * declaración. Siempre pasa por la cache (nunca dos lecturas del mismo asset).
 */
import { artworkHash } from "./assets";
import type { ArtworkCache } from "./cache";
import type { ArtworkAsset, ArtworkReader, LoadedArtwork } from "./types";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Contenido de un asset virtual (data:/css:) — determinista, sin E/S. */
function virtualBytes(a: ArtworkAsset): Uint8Array | null {
  if (a.path.startsWith("data:") || a.path.startsWith("css:")) return utf8(a.path);
  return null;
}

export class ArtworkLoader {
  constructor(private cache: ArtworkCache, private reader?: ArtworkReader) {}

  /** Carga un asset (vía cache). Sin lector, los assets con ruta real no se pueden cargar. */
  load(asset: ArtworkAsset): Promise<LoadedArtwork> {
    return this.cache.getOrLoad(asset, async (a) => {
      const virtual = virtualBytes(a);
      const bytes = virtual ?? await this.read(a.path);
      return { asset: a, bytes: bytes.length, contentHash: artworkHash(bytes) };
    });
  }

  private async read(path: string): Promise<Uint8Array> {
    if (!this.reader) throw new Error(`sin lector inyectado para cargar: ${path}`);
    return this.reader(path);
  }

  /** ¿Puede cargarse sin E/S? (placeholders y recursos css). */
  static isVirtual(asset: ArtworkAsset): boolean { return virtualBytes(asset) !== null; }
}
