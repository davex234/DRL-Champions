import type { Player } from "@/domain/cards/types";
import type { AssetKind, SubjectType } from "@/domain/assets/types";
import { FLAGS_DIR, hasLocalFlag } from "@/data/flags";

/**
 * Configuración central de assets. Cambiar a almacenamiento local o a otra
 * fuente (p. ej. importación desde VLR.gg) es modificar solo este objeto.
 *
 * - Fotos de jugadores: PNG transparente en `/public/players/{id}.png`.
 * - Logos de equipos:   PNG transparente en `/public/teams/{slug}.png`.
 * - Mapas del Entrenador: PNG en `/public/maps/{id}.png`, tal cual, sin derivados.
 * - Retratos de agente: WEBP con alfa en `/public/agents/{id}/{variante}.webp` (Fase 48).
 * - Banderas:           SVG LOCALES en `/public/flags/{iso}.svg` (flag-icons, MIT; F72.3). Sin host externo.
 *
 * Si una imagen no existe, los componentes muestran un fallback (silueta /
 * monograma / código de país), así que el juego funciona sin assets locales.
 */
export const ASSETS = {
  playersDir: "/players",
  teamsDir: "/teams",
  mapsDir: "/maps",
  agentsDir: "/agents",
} as const;

/** Ruta de la foto de un jugador (permite override por jugador). */
export function playerImageSrc(player: Pick<Player, "id" | "image">): string {
  return player.image ?? `${ASSETS.playersDir}/${player.id}.png`;
}

/** Ruta del logo de un equipo a partir de su slug. */
export function teamLogoSrc(slug: string): string {
  return `${ASSETS.teamsDir}/${slug}.png`;
}

/**
 * Ruta del asset de un mapa del Entrenador.
 *
 * Existe para que NINGÚN componente escriba `/maps/ascent.png` a mano. El selector, la
 * pizarra, la pantalla de estudio y el modo presentación piden la ruta aquí, así que hay
 * un solo sitio que cambiar si los mapas se mueven. `asset` sale del catálogo.
 */
export function mapImageSrc(asset: string): string {
  return `${ASSETS.mapsDir}/${asset}`;
}

/**
 * FASE 51 · MINIATURA del mapa (WebP de ~10 KB en `maps/thumbs/`), derivada del PNG original sin
 * tocarlo. Las rejillas —centro táctico, composiciones, plan, expediente— enseñaban los doce PNG
 * completos (~1 MB cada uno, 12,6 MB en total) para pintarlos a 200 px. El PNG sigue siendo el
 * que usan la pizarra y el visor de mapas, donde sí hace falta su resolución.
 */
export function mapThumbSrc(asset: string): string {
  return `${ASSETS.mapsDir}/thumbs/${asset.replace(/\.png$/i, ".webp")}`;
}

/**
 * Ruta del arte de un agente — FASE 48.
 *
 * Misma regla que `mapImageSrc`: NINGÚN componente escribe `/agents/veil/portrait.webp` a
 * mano. El gestor de composiciones, el Plan Táctico y Presentar piden la ruta aquí, así que
 * hay un solo sitio que cambiar si el arte se mueve o cambia de formato.
 *
 * Esto sólo COMPONE la ruta; no dice si el fichero existe. Quién tiene arte publicado lo
 * declara el manifiesto (`src/agents/visuals.ts`), para no pedir al servidor imágenes que ya
 * se sabe que no están.
 */
export function agentArtSrc(agentId: string, variant: string): string {
  return `${ASSETS.agentsDir}/${agentId}/${variant}.webp`;
}

/**
 * Bandera LOCAL de un país (ISO de 2 letras), o `null` si no la tenemos (F72.3). Nunca una URL externa: antes era
 * flagcdn.com en tiempo de ejecución. Si puede ser PISTA (nacionalidad real) lo decide `isNationalityFlag`, no esto.
 */
export function flagSrc(iso: string): string | null {
  return hasLocalFlag(iso) ? `${FLAGS_DIR}/${iso.toLowerCase()}.svg` : null;
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
