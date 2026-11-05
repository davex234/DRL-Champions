/**
 * ANALÍTICA DE PRODUCTO — SOLO SERVIDOR (Fase 14, bloque 5).
 *
 * Envoltorio tipado de las funciones SQL de la migración 0030. Aquí **no se calcula
 * nada**: cada función de este fichero llama a una de PostgreSQL y devuelve lo que
 * responde. Si algún día un número no cuadra, hay un solo sitio donde mirar.
 *
 * ────────────────────────── POR QUÉ EL CÁLCULO ESTÁ EN SQL ──────────────────────────
 *
 * Un embudo es una intersección entre seis tablas. PostgREST —el query builder que el
 * proyecto usa para TODAS sus lecturas— sabe incrustar recursos relacionados, no cruzar y
 * agregar. La alternativa era traerse las filas a Node: para calcular usuarios activos
 * diarios habría que descargar todos los eventos del día.
 *
 * Y no es una arquitectura nueva: el proyecto ya usa vistas para leer agregados
 * (`ranking_level`, `v_upcoming_matches`) y funciones para recomponer estadísticas
 * (`recompute_standings`). Esto es lo mismo, para otra pregunta.
 *
 * ────────────────────────── LO QUE ESTE MÓDULO NO ES ──────────────────────────
 *
 * **No es una fuente de verdad.** Solo lee. No hay tabla de agregados, ni vista
 * materializada, ni caché: cada llamada recalcula desde las tablas autoritativas, así que
 * es imposible que se quede desfasado o discrepe del dato real.
 *
 * **No es para el cliente.** Se llama con `service_role` y las funciones SQL tienen la
 * ejecución revocada a `anon` y `authenticated`. No hay endpoint que lo exponga, y cuando
 * lo haya deberá ir detrás de `verifyAdmin(req)` — no de `ADMIN_ENABLED`, que es una
 * compuerta de interfaz.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Ventana temporal. Se pasa siempre explícita: ninguna fecha va escrita en el código. */
export interface Window {
  from: Date;
  to: Date;
}

/** Últimos `days` días hasta ahora. Comodidad, no una constante escondida. */
export const lastDays = (days: number, now = new Date()): Window => ({
  from: new Date(now.getTime() - days * 86_400_000),
  to: now,
});

const iso = (w: Window) => ({ p_from: w.from.toISOString(), p_to: w.to.toISOString() });

/**
 * Toda función de aquí devuelve `null` si la consulta falla, y ninguna lanza.
 *
 * La analítica es una lectura de apoyo: que una métrica no se pueda calcular no puede
 * tumbar la pantalla que la pedía. Es la misma disciplina que la telemetría.
 */
async function call<T>(
  sb: SupabaseClient, fn: string, args: Record<string, unknown>,
): Promise<T[] | null> {
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error) return null;
    return (data ?? []) as T[];
  } catch {
    return null;
  }
}

// ═══════════════════════════ EMBUDOS ═══════════════════════════

export interface FtueStep {
  step_order: number;
  step: string;
  users: number;
  /** Conversión respecto al paso anterior. `null` en el primero. */
  conv_prev: number | null;
  /** Conversión respecto al tamaño de la cohorte. */
  conv_start: number | null;
  /** De qué tabla sale este paso. Va en el dato, no en un comentario. */
  source: string;
}

/**
 * Embudo de primera experiencia, por cohorte de alta.
 *
 * La cohorte son los usuarios **creados** en la ventana (`profiles.created_at`), no los
 * que estuvieron activos: un embudo de primera experiencia se mide sobre quien acaba de
 * llegar.
 *
 * Cinco de los siete pasos son retroactivos —salen de tablas que existen desde mucho antes
 * que la telemetría—, así que este embudo responde también por los jugadores anteriores a
 * la Fase 14. Solo `ftue_started` depende de `telemetry_events`.
 */
export const ftueFunnel = (sb: SupabaseClient, w: Window) =>
  call<FtueStep>(sb, "analytics_ftue_funnel", iso(w));

export interface DuelFunnel {
  started: number;
  completed: number;
  drawn: number;
  unresolved: number;
  in_progress: number;
  /** INFERENCIA: en curso y sin actividad desde hace `staleHours`. No es un evento. */
  abandoned_estimate: number;
  completion_rate: number | null;
  players: number;
  matches_per_player: number | null;
  /** Duración EXACTA: el duelo empieza y acaba con escrituras en `duel_matches`. */
  median_seconds: number | null;
  avg_seconds: number | null;
}

export const duelFunnel = (sb: SupabaseClient, w: Window, staleHours = 24) =>
  call<DuelFunnel>(sb, "analytics_duel_funnel", { ...iso(w), p_stale_hours: staleHours })
    .then((r) => r?.[0] ?? null);

export interface PickemFunnel {
  /** Solo desde la Fase 14. Antes de eso: 0, y las conversiones no significan nada. */
  viewers_telemetry: number;
  predictors: number;
  predictions: number;
  scored: number;
  correct: number;
  rewarded: number;
  accuracy_pct: number | null;
  view_to_predict_pct: number | null;
  source_note: string;
}

export const pickemFunnel = (sb: SupabaseClient, w: Window) =>
  call<PickemFunnel>(sb, "analytics_pickem_funnel", iso(w)).then((r) => r?.[0] ?? null);

export interface MarketFunnel {
  viewers_telemetry: number;
  sellers: number;
  listings: number;
  buyers: number;
  purchases: number;
  cancellations: number;
  view_to_list_pct: number | null;
  view_to_buy_pct: number | null;
  list_to_sale_pct: number | null;
}

export const marketFunnel = (sb: SupabaseClient, w: Window) =>
  call<MarketFunnel>(sb, "analytics_market_funnel", iso(w)).then((r) => r?.[0] ?? null);

// ═══════════════════════════ USO ═══════════════════════════

export interface ZoneUsage {
  zone: string;
  /** Veces que se entró. **No es lo mismo que `users`.** */
  entries: number;
  /** Personas distintas. Una puede haber entrado once veces. */
  users: number;
  anon_sessions: number;
  sessions: number;
  /** Cuántas veces esa zona fue la puerta de entrada de una sesión. */
  first_of_session: number;
  entries_per_session: number | null;
}

export const zoneUsage = (sb: SupabaseClient, w: Window) =>
  call<ZoneUsage>(sb, "analytics_zones", iso(w));

export interface SessionStats {
  sessions: number;
  authenticated_sessions: number;
  anonymous_sessions: number;
  /** Empezaron anónimas y siguieron autenticadas. El caso que el modelo existe para ver. */
  mixed_sessions: number;
  known_users: number;
  sessions_per_known_user: number | null;
  events_per_session: number | null;
  /** Si son la mayoría, la mediana de duración no significa nada. */
  single_event_sessions: number;
  /**
   * COTA INFERIOR, no duración.
   *
   * `session_ended` se rechazó en el bloque 2 porque cerrar el navegador o perder la red
   * no avisan. No se sabe cuánto estuvo el jugador mirando la última pantalla. El nombre
   * del campo es la advertencia.
   */
  median_seconds_lower_bound: number | null;
  avg_seconds_lower_bound: number | null;
}

export const sessionStats = (sb: SupabaseClient, w: Window) =>
  call<SessionStats>(sb, "analytics_sessions", iso(w)).then((r) => r?.[0] ?? null);

export interface ActiveUsersDay {
  day: string;
  dau: number;
  wau_trailing_7d: number;
  /** **No se suman a `dau`**: un anónimo no es un usuario único (§ METRICS.md). */
  anon_sessions: number;
  sessions: number;
}

export const activeUsers = (sb: SupabaseClient, w: Window) =>
  call<ActiveUsersDay>(sb, "analytics_active_users", iso(w));

export interface RetentionRow {
  cohort_day: string;
  cohort_size: number;
  d1: number;
  d7: number;
  d30: number;
  d1_pct: number | null;
  d7_pct: number | null;
  d30_pct: number | null;
  /**
   * Si es `false`, el cero de al lado significa «no se estaba midiendo», **no** «nadie
   * volvió». Sin esta bandera, la ausencia de instrumentación se leería como una
   * catástrofe de retención.
   */
  d1_measurable: boolean;
  d7_measurable: boolean;
  d30_measurable: boolean;
}

export const retention = (sb: SupabaseClient, w: Window) =>
  call<RetentionRow>(sb, "analytics_retention", { p_cohort_from: w.from.toISOString(), p_cohort_to: w.to.toISOString() });

// ═══════════════════════════ SALUD ═══════════════════════════

export interface ErrorGroup {
  day: string;
  severity: string | null;
  source: string | null;
  zone: string | null;
  flow: string | null;
  app_version: string | null;
  code: string | null;
  fingerprint: string | null;
  occurrences: number;
  users: number;
  sessions: number;
  /** Mensaje de ejemplo, ya saneado por el endpoint antes de escribirse. */
  sample: string | null;
}

export const errorGroups = (sb: SupabaseClient, w: Window) =>
  call<ErrorGroup>(sb, "analytics_errors", iso(w));

export interface FlowStats {
  flow: string;
  starts: number;
  users: number;
  sessions: number;
  users_completed: number;
  completion_pct: number | null;
  completion_source: string;
}

export const flowStats = (sb: SupabaseClient, w: Window) =>
  call<FlowStats>(sb, "analytics_flows", iso(w));

// ═══════════════════════════ RECORRIDO ═══════════════════════════

export interface JourneyRow {
  at: string;
  kind: string;
  detail: string | null;
  source: string;
}

/**
 * El recorrido de UNA sesión: eventos conductuales entrelazados con las acciones
 * autoritativas de la misma ventana.
 *
 * **Solo para operaciones.** Muestra la actividad de una persona concreta, así que jamás
 * debe exponerse a un jugador. La función SQL tiene la ejecución revocada a `anon` y
 * `authenticated`, y el endpoint que un día la use tendrá que pasar por `verifyAdmin`.
 */
export const sessionJourney = (sb: SupabaseClient, sessionId: string) =>
  call<JourneyRow>(sb, "analytics_session_journey", { p_session: sessionId });
