/**
 * F86 · COPAS (torneos de jugadores) — tipos del dominio.
 *
 * «Copa» es el nombre técnico para no chocar con `tournaments` / `/torneos`, que desde la Fase 30 son la capa esports
 * (VLR, Pick'ems). En la interfaz se llaman «Torneos». Tablas: `cups`, `cup_registrations`, `cup_matches` (0069).
 *
 * Un torneo NO es ranked: sus partidas son `duel_matches` con `mode = 'PVP_PRIVATE'` (mismo motor, sin rating, sin
 * misiones, sin XP) enlazadas por `cup_matches.game_match_id` (único). El cuadro es eliminación directa de 4 a 64.
 */

export const CUP_FORMAT = "SINGLE_ELIMINATION" as const;
export type CupFormat = typeof CUP_FORMAT;
export const CUP_SEEDING = "RATING_SNAPSHOT" as const;
export type CupSeeding = typeof CUP_SEEDING;

/** Límites del formato (los fija también el CHECK de la BD). */
export const CUP_MIN_PARTICIPANTS = 4;
export const CUP_MAX_PARTICIPANTS = 64;
/** Ventana por ronda: de 10 minutos a 7 días. */
export const CUP_WINDOW_MIN = 10;
export const CUP_WINDOW_MAX = 7 * 24 * 60;
/** Rating de quien nunca ha jugado ranked: el inicial de F84 (no se inventa otro). */
export const CUP_UNRATED_SEED = 1000;
/** Validez de «estoy listo» sin renovar (la pantalla de espera lo renueva cada 5 s). */
export const CUP_READY_TTL_SECONDS = 30;

/** Estado PERSISTIDO. Las fases de inscripción se DERIVAN de las fechas con la hora del servidor (`cupPhase`). */
export type CupStatus = "DRAFT" | "PUBLISHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
/** Lo que ve un jugador: el estado persistido + las fechas + la hora del servidor. */
export type CupPhase = "DRAFT" | "SCHEDULED" | "REGISTRATION_OPEN" | "REGISTRATION_CLOSED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type CupVisibility = "PUBLIC" | "UNLISTED";

/**
 * Estado de un cruce del cuadro.
 *   PENDING          falta al menos un participante (su cruce de origen no ha terminado)
 *   READY            los dos definidos; se juega dentro de su ventana
 *   ACTIVE           tiene SU partida (`game_match_id`) en curso
 *   COMPLETED        resultado FINAL (motor canónico o resolución admin auditada): el ganador ya avanzó
 *   BYE              un solo participante: avanza sin partida (no es una victoria de combate)
 *   VOID             nadie avanza (los dos lados vacíos o doble no presentado)
 *   ACTION_REQUIRED  la partida acabó sin ganador canónico (empate, sin resolver, cierre por tiempo): retenido para admin
 *   CANCELLED        el torneo se canceló antes de jugarlo
 */
export type CupMatchStatus = "PENDING" | "READY" | "ACTIVE" | "COMPLETED" | "BYE" | "VOID" | "ACTION_REQUIRED" | "CANCELLED";
export type CupResolution = "PLAYED" | "ABANDON" | "BYE" | "ADMIN_NO_SHOW" | "ADMIN_DOUBLE_NO_SHOW" | "ADMIN_DECISION";
/** Resultado final de una inscripción. Sin «5.º» inventados: la ronda en la que caíste. */
export type CupPlacement = "CHAMPION" | "RUNNER_UP" | "SEMIFINAL" | "QUARTERFINAL" | "ROUND_OF_16" | "ROUND_OF_32" | "ROUND_OF_64";

/** Estados en los que un cruce ya no cambia (su lado del árbol está resuelto). */
export const CUP_MATCH_FINAL: ReadonlySet<CupMatchStatus> = new Set(["COMPLETED", "BYE", "VOID", "CANCELLED"]);
