/**
 * EL ENLACE CANÓNICO AL PERFIL DE UN JUGADOR (Fase 31). Una sola ruta pública: `/jugador/[id]`.
 * Competitivo, Social y el post-partida enlazan aquí; la ruta antigua del competitivo redirige.
 * Se usa el id (estable) y no el nombre de usuario.
 */
export const playerHref = (userId: string): string => `/jugador/${userId}`;

/** Atajo al perfil propio: la página lo resuelve con la sesión. */
export const PLAYER_ME_HREF = "/jugador/me";

/** URL absoluta para «Compartir perfil». */
export const playerShareUrl = (origin: string, userId: string): string => `${origin.replace(/\/+$/, "")}${playerHref(userId)}`;
