/**
 * ARTWORK ENGINE — fachada del Asset Manager: registro + resolver + cache + loader +
 * manifest en una sola pieza. Administra recursos; NO genera imágenes, NO compone y NO
 * renderiza (eso son fases posteriores del Artwork Pipeline).
 */
import { SEED_ASSETS } from "./assets";
import { ArtworkCache } from "./cache";
import { ArtworkLoader } from "./loader";
import { buildManifest, emptyRefs } from "./manifest";
import { ArtworkRegistry } from "./registry";
import { conventionalAsset, resolveCardArtwork, resolveRef, resolveSubject } from "./resolver";
import { validateAssets } from "./validation";
import type {
  ArtworkAsset, ArtworkCategory, ArtworkManifest, ArtworkReader, ArtworkRefs, ArtworkRequest,
  ArtworkValidation, CacheStats, CardArtworkResolution, LoadedArtwork, ResolvedArtwork,
} from "./types";

export interface ArtworkEngineOptions {
  /** Assets iniciales (por defecto el SEED de la auditoría: reales + css + placeholders). */
  assets?: ArtworkAsset[];
  /** Lector de contenido (fetch/fs). Sin él solo cargan los recursos virtuales. */
  reader?: ArtworkReader;
}

export class ArtworkEngine {
  readonly registry: ArtworkRegistry;
  private cache = new ArtworkCache();
  private loader: ArtworkLoader;

  constructor(opts: ArtworkEngineOptions = {}) {
    this.registry = new ArtworkRegistry(opts.assets ?? SEED_ASSETS());
    this.loader = new ArtworkLoader(this.cache, opts.reader);
  }

  /** Registra un asset nuevo (p.ej. al poblar desde el catálogo por convención). */
  register(asset: ArtworkAsset): void { this.registry.add(asset); }

  /** Registra los assets CONVENCIONALES de los sujetos vivos del juego. */
  registerFromRefs(refs: ArtworkRefs): number {
    let added = 0;
    const pairs: [ArtworkCategory, string[]][] = [
      ["player", refs.players], ["team", refs.teams], ["country", refs.countries],
      ["tournament-logo", refs.tournaments],
    ];
    for (const [category, ids] of pairs) {
      for (const id of ids) {
        const a = conventionalAsset(category, id);
        if (a && !this.registry.get(a.id)) { this.registry.add(a); added++; }
      }
    }
    return added;
  }

  /* Resolución. */
  resolveCard(req: ArtworkRequest): CardArtworkResolution { return resolveCardArtwork(this.registry, req); }
  resolve(category: ArtworkCategory, subjectId?: string): ResolvedArtwork { return resolveSubject(this.registry, category, subjectId); }
  resolveRef(ref: string): ArtworkAsset | null { return resolveRef(this.registry, ref); }

  /* Carga (siempre vía cache: jamás dos lecturas del mismo asset). */
  load(asset: ArtworkAsset): Promise<LoadedArtwork> { return this.loader.load(asset); }
  loadById(id: string): Promise<LoadedArtwork> {
    const a = this.registry.get(id);
    if (!a) return Promise.reject(new Error(`asset desconocido: ${id}`));
    return this.loader.load(a);
  }
  cacheStats(): CacheStats { return this.cache.snapshot(); }
  get cacheSize(): number { return this.cache.size; }
  get uniqueLoaded(): number { return this.cache.uniqueLoaded; }

  /* Seguridad e índice. */
  validate(): ArtworkValidation { return validateAssets(this.registry.list()); }
  manifest(refs: ArtworkRefs = emptyRefs(), now = 0): ArtworkManifest { return buildManifest(this.registry, refs, now); }
}
