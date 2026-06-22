import type { Player } from "@/domain/cards/types";

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
