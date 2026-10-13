/**
 * ARTWORK DE SOBRE — el hueco, y quién declara que ya está lleno (Fase 20).
 *
 * ────────────────────────── EL ARTWORK DEL SOBRE NO ES EL DE LAS CARTAS ──────────────────────────
 *
 * Son dos sistemas distintos y no se mezclan:
 *
 *   · **Cartas** — fichero por EJEMPLAR, resuelto en el servidor por `card_id` +
 *     `minted_version`, servido en el mapa `uid → fichero` que consume `CardVisual`. Versionado,
 *     porque dos copias de la misma carta acuñadas bajo versiones distintas tienen arte distinto.
 *   · **Sobres** (esto) — fichero por PRODUCTO, estático en `public/packs/`. Un sobre no se
 *     acuña, no tiene ejemplares y no tiene versiones por jugador: es el envase del producto.
 *
 * Meter los sobres en la tabla `assets` habría obligado a inventarles un `card_id`.
 *
 * ────────────────────────── POR QUÉ UN MANIFIESTO Y NO UN `onError` ──────────────────────────
 *
 * `CardFace` puede permitirse intentar la imagen y caer al dibujado si falla, porque su URL
 * viene de la base de datos: si está, el fichero existe. Aquí la ruta se DERIVA del `packId`,
 * así que intentarla sin más pediría al navegador 16 ficheros que todavía no existen — 16
 * respuestas 404 en cada pintada de la tienda, en la consola y en la pestaña de red.
 *
 * El manifiesto es la declaración explícita de lo que ha llegado de verdad. Añadir un artwork
 * son dos gestos: dejar el fichero en `public/packs/` y añadir su `packId` aquí. Mientras un
 * `packId` no esté en la lista, el sobre se dibuja con su arte PROCEDIMENTAL —que no es un
 * marcador de posición: es el objeto que el juego enseña hoy, con su identidad por producto—.
 *
 * ────────────────────────── LA CONVENCIÓN ──────────────────────────
 *
 *     public/packs/pack-<packId>.webp        780 × 1140 (13:19), WEBP con alfa
 *
 * Las medidas son 3× el objeto a tamaño de ceremonia (260 × 380) y la proporción es la que ya
 * usa `SealedPack`. Alfa obligatorio: el sobre se compone sobre el escenario oscuro de la
 * apertura y sobre la vitrina de la tienda, que no comparten fondo.
 *
 * La especificación completa, y la lista de lo que falta, en `public/packs/README.md`.
 */

import { getPack } from "@/data/packs";

/** Carpeta pública del artwork de sobres. */
export const PACK_ART_DIR = "/packs";

/** Ruta que le corresponde a un sobre por convención. Existir es otra cosa: ver el manifiesto. */
export function packArtPath(packId: string): string {
  return `${PACK_ART_DIR}/pack-${packId}.webp`;
}

/**
 * LOS SOBRES CUYO ARTWORK YA ESTÁ EN EL REPOSITORIO.
 *
 * Producidos en la Fase 20.1 con el MASTER PACK DESIGN (`scripts/pack-art/master.ts`) y
 * rasterizados a WEBP con alfa real por `npm run pack-art:render`. Son ficheros de imagen de
 * verdad —780 × 1140, silueta recortada, sin fondo horneado—, no gradientes de CSS ni
 * marcadores de posición.
 *
 * **Los quince productos vivos del catálogo están cubiertos.** Falta el artwork de los sobres
 * de equipo que aún no existen como producto, y sigue pendiente el LOGO OFICIAL de los cuatro
 * que sí existen: en el repositorio no hay ni un logo de equipo (`public/teams/` solo tiene un
 * README), así que su troquel usa el monograma con la etiqueta real del equipo — el mismo
 * respaldo que ese README declara aprobado. El inventario completo, en `public/packs/README.md`.
 *
 * Añadir uno nuevo son dos gestos: dejar el fichero y añadir su `packId` aquí.
 */
export const PACK_ART_AVAILABLE = new Set<string>([
  // Productos de la casa — la gama base es Bronce (`estandar`), Plata (`premium`) y Oro.
  "inicial", "estandar", "premium", "oro", "prime",
  // Competición / colección
  "masters", "champions", "ewc", "icon",
  // ICON (2026-10-09) · el Sobre ICON de 1 carta lleva, por ahora, una COPIA del arte del Sobre ICON Premium (sin arte propio).
  "icon-single",
  // Regionales
  "emea", "americas", "pacific", "china",
  // Equipos — los cuatro de la Fase 20 y los dos que activó el arte oficial (Liquid, Karmine).
  // NAVI sigue aquí a propósito: el producto está RETIRADO del escaparate, pero los sobres que
  // ya tenga un jugador se siguen abriendo, y tienen que pintarse con su arte.
  "team-heretics", "team-fnatic", "team-navi", "team-g2",
  "team-liquid", "team-karmine",
]);

/**
 * El artwork de un sobre, o `null` si todavía no ha llegado (y entonces se dibuja).
 *
 * F60 · Un sobre del panel (`cms-…`) trae su arte de Storage en `pack.cms.art` (el registro vivo). Se consulta primero:
 * la tienda, la apertura y el inventario pintan el MISMO asset que se subió en /admin/packs.
 */
export function packArtwork(packId: string): string | null {
  if (packId.startsWith("cms-")) return getPack(packId)?.cms?.art ?? null;
  return PACK_ART_AVAILABLE.has(packId) ? packArtPath(packId) : null;
}
