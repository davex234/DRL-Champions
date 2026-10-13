/**
 * TELEMETRÍA DE PICK'EMS (Fase 24.2) — sobre el contrato existente, sin ampliarlo.
 *
 * ────────────────────────── POR QUÉ ASÍ ──────────────────────────
 *
 * La taxonomía de telemetría es CERRADA por construcción: cuatro `event_name` fijados por
 * un `CHECK` en la base de datos (0029), por el contrato (`EVENT_NAMES`) y por una prueba
 * que fija su número. Añadir seis nombres nuevos exigiría una migración —que no se puede
 * aplicar en este entorno— y reescribir esa prueba.
 *
 * El contrato ya tiene un flujo instrumentado para esta pantalla: `pickem_form`, cuyo
 * evento `flow_started` admite un `context` en su lista blanca. Las seis acciones de
 * Pick'ems viajan como contexto de ese flujo. Nada se inventa fuera del contrato, nada se
 * guarda que no pase por el saneado del servidor, y el día que se promuevan a eventos de
 * primer nivel solo hay que cambiar esta función.
 *
 * No lleva identificadores: ni de torneo, ni de pregunta, ni de usuario. El usuario sale
 * del token en el servidor y los UUID se redactan igualmente en el saneado.
 */
import { trackFlow } from "./client";

export const PICKEM_ACTIONS = [
  "pickem_viewed",
  "pickem_prediction_saved",
  "pickem_prediction_changed",
  "pickem_locked_seen",
  "pickem_result_seen",
  "pickem_leaderboard_seen",
] as const;
export type PickemAction = (typeof PICKEM_ACTIONS)[number];

/** Fase 24.5 · acciones del evento vivo. Mismo flujo `pickem_form`, mismo saneado. */
export const PICKEM_LIVE_ACTIONS = [
  "event_live_viewed",
  "live_match_seen",
  "prediction_result_seen",
  "qualification_seen",
  "event_refresh_failed",
] as const;
export type PickemLiveAction = (typeof PICKEM_LIVE_ACTIONS)[number];

/** Acciones de «visto» ya emitidas en esta carga: una pantalla no se ve doce veces. */
const seen = new Set<string>();

/**
 * Registra una acción de Pick'ems.
 *
 * `once` deduplica dentro de la sesión de página: `trackPickem("pickem_viewed", { once: id })`
 * se emite una vez por torneo, aunque el componente se vuelva a montar.
 */
export function trackPickem(action: PickemAction | PickemLiveAction, opts: { once?: string } = {}): void {
  try {
    if (opts.once !== undefined) {
      const key = `${action}:${opts.once}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    trackFlow("pickem_form", action);
  } catch { /* la telemetría nunca rompe la pantalla */ }
}

/** Solo para pruebas. */
export function __resetPickemTelemetryForTests(): void {
  seen.clear();
}
