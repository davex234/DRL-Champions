/**
 * FASE 68 · RETRATOS DE JUGADOR QUE EXISTEN DE VERDAD en `public/players/`.
 *
 * `PlayerPhoto` pedía SIEMPRE `/players/<id>.png` y caía al sigilo al recibir el 404. Hoy `public/players/` solo tiene su
 * README (ningún retrato publicado), así que las pantallas que pintan cartas con la capa antigua —el partido del Tactical
 * Coach, con el roster rival— dejaban un 404 por jugador en la consola (medido en la beta cerrada: 5 en un partido).
 * Mismo patrón que `TEAM_LOGOS_AVAILABLE` (F64): añadir un retrato son dos gestos, dejar el fichero y su id aquí.
 * Un test compara esta lista con la carpeta. Una `image` explícita del jugador (CMS) no pasa por aquí: se respeta.
 */
export const PLAYER_PHOTOS_AVAILABLE: ReadonlySet<string> = new Set<string>([]);

/** ¿Merece la pena pedir el retrato? Sí si el jugador trae su propia imagen o si el fichero por defecto existe. */
export const hasPlayerPhoto = (player: { id: string; image?: string | null }): boolean =>
  !!player.image || PLAYER_PHOTOS_AVAILABLE.has(player.id);
