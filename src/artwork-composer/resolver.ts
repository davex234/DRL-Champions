/**
 * RESOLVER — puente con el Artwork Asset Manager (F1): toda referencia de la composición
 * sale de aquí, con la garantía del manager de PLACEHOLDER oficial cuando falte cualquier
 * recurso. Nunca devuelve null; nunca resuelve a una imagen (solo asset.id).
 */
import type { ArtworkCategory, ArtworkEngine, ResolvedArtwork } from "@/artwork";

/** Recurso por sujeto (delegado al manager: real o placeholder, jamás null). */
export const resolveSubjectRef = (
  artwork: ArtworkEngine, category: ArtworkCategory, subjectId?: string,
): ResolvedArtwork => artwork.resolve(category, subjectId);

/** Recurso por id exacto/alias/hash, con placeholder de la categoría si no existe. */
export function resolveIdRef(artwork: ArtworkEngine, category: ArtworkCategory, ref: string): ResolvedArtwork {
  const real = artwork.resolveRef(ref);
  if (real && real.category === category && !real.placeholder) {
    return { category, asset: real, isPlaceholder: false };
  }
  return artwork.resolve(category, undefined);
}

/** Referencia de la tipografía oficial (fuente display del design system). */
export function resolveFontRef(artwork: ArtworkEngine): string {
  return resolveIdRef(artwork, "font", "font:display").asset.id;
}
