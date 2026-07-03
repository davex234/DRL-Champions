import type { Player } from "@/domain/cards/types";
import type { AssetKind, SubjectType } from "@/domain/assets/types";

/**
 * Configuración central de assets. Cambiar a almacenamiento local o a otra
 * fuente (p. ej. importación desde VLR.gg) es modificar solo este objeto.
 *
 * - Fotos de jugadores: PNG transparente en `/public/players/{id}.png`.
 * - Logos de equipos:   PNG transparente en `/public/teams/{slug}.png`.
 * - Banderas:           imágenes reales servidas por un proveedor configurable.
 *
 * Si una imagen no existe, los componentes muestran un fallback (silueta /
 * monograma / código de país), así que el juego funciona sin assets locales.
 */
export const ASSETS = {
  playersDir: "/players",
  teamsDir: "/teams",
  flag: {
    /** Proveedor de banderas. Intercambiable por una carpeta local. */
    base: "https://flagcdn.com",
    size: "w80",
  },
} as const;

/** Ruta de la foto de un jugador (permite override por jugador). */
export function playerImageSrc(player: Pick<Player, "id" | "image">): string {
  return player.image ?? `${ASSETS.playersDir}/${player.id}.png`;
}

/** Ruta del logo de un equipo a partir de su slug. */
export function teamLogoSrc(slug: string): string {
  return `${ASSETS.teamsDir}/${slug}.png`;
}

/** URL de la bandera de un país (ISO de 2 letras). */
export function flagSrc(iso: string): string {
  return `${ASSETS.flag.base}/${ASSETS.flag.size}/${iso.toLowerCase()}.png`;
}

/**
 * Resolver del Asset Manager: "dame la mejor imagen disponible para este sujeto".
 *
 * Consulta la tabla precomputada `asset_best` (lectura O(1)) vía el repo. Si no
 * hay asset gestionado, o Supabase no está configurado, cae al `fallback` (las
 * rutas estáticas de arriba) — así el render funciona igual SIN assets.
 *
 * El repo se importa dinámicamente para no arrastrar el módulo de cliente a los
 * consumidores de servidor de este fichero.
 */
export async function resolveAssetUrl(
  kind: AssetKind, subjectType: SubjectType, subjectId: string, fallback: string,
): Promise<string> {
  try {
    const { bestAssetFor, bestAssetUrl } = await import("@/lib/assets/repos");
    const url = bestAssetUrl(await bestAssetFor(kind, subjectType, subjectId));
    if (url) return url;
  } catch {
    /* sin Supabase / sin asset → fallback */
  }
  return fallback;
}

/** Mejor foto gestionada de un jugador (con fallback a la ruta estática). */
export function resolvePlayerImage(player: Pick<Player, "id" | "image">): Promise<string> {
  return resolveAssetUrl("player_photo", "player", player.id, playerImageSrc(player));
}
