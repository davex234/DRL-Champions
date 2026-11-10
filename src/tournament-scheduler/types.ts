/**
 * TOURNAMENT WATCHER · SCHEDULER — tipos (Tournament Watcher · Fase 2/5).
 *
 * Planificador PURO de observaciones: decide CUÁNDO observar, QUÉ observar y CADA CUÁNTO —
 * y devuelve un WatchPlan. Jamás observa, jamás ejecuta el Watch Engine, ni Orchestrator,
 * ni Control, ni Publisher; jamás interpreta resultados. Reloj 100% inyectable.
 */

export const SCHEDULER_SCHEMA_VERSION = 1;

/* ── Descriptor de torneo (datos, nunca interpretación) ───────────────────── */

export type TournamentPhase = "group" | "playoff" | "grand-final" | "unknown";
export type ObservedStatus = "upcoming" | "ongoing" | "finished" | "archived";

export interface TournamentDescriptor {
  tournamentId: string;
  name: string;
  status: ObservedStatus;
  /** ¿Hay partidos EN DIRECTO ahora mismo (según el último snapshot)? */
  live: boolean;
  /** Fase actual derivada de los DATOS del snapshot (stage.kind + ronda). */
  phase: TournamentPhase;
  /** Última observación registrada (fecha lógica) o null si nunca. */
  lastObservedAt: number | null;
  /** Última revisión del watcher (para métricas; el scheduler no interpreta). */
  revision: number;
}

/* ── Política (TODO datos: intervalos, prioridades, reintentos, patrones) ──── */

export interface PriorityRule {
  /** Condición declarativa sobre el descriptor. */
  when: Partial<Pick<TournamentDescriptor, "status" | "live" | "phase">>;
  score: number;
  label: string;
}

export interface RetryPolicy {
  /** Espera base del primer reintento (ms). */
  baseDelayMs: number;
  /** Factor de backoff exponencial. */
  factor: number;
  maxAttempts: number;
}

export interface SchedulePolicy {
  /** Intervalo de observación por estado (ms). */
  intervals: Record<ObservedStatus, number> & { live: number };
  /** Reglas de prioridad (mayor score = antes). Primera regla que aplica gana. */
  priorities: PriorityRule[];
  retry: RetryPolicy;
  /** Patrón (dato configurable) para reconocer una gran final en el nombre de ronda. */
  grandFinalPattern: string;
}

/* ── Tareas y cola ────────────────────────────────────────────────────────── */

export type TaskState = "pending" | "running" | "completed" | "retryable" | "cancelled";

export interface WatchTask {
  /** Id determinista: `<tournamentId>#<n>` (n = tareas creadas para ese torneo). */
  id: string;
  tournamentId: string;
  state: TaskState;
  /** Cuándo toca observar (fecha lógica). */
  dueAt: number;
  priority: number;
  priorityLabel: string;
  /** Intervalo aplicado (ms) — trazabilidad del plan. */
  intervalMs: number;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  reason?: string;
}

export interface SchedulerRegistry {
  schemaVersion: number;
  tasks: Record<string, WatchTask>;
  order: string[];
  /** Contador de tareas por torneo (ids deterministas). */
  perTournament: Record<string, number>;
}

/* ── Plan ─────────────────────────────────────────────────────────────────── */

export interface WatchPlan {
  generatedAt: number;
  /** Tareas ACTIVAS (pending/running/retryable) ordenadas por (dueAt, -prioridad, id). */
  tasks: WatchTask[];
  /** Próxima observación global (o null si no hay nada planificado). */
  nextDueAt: number | null;
  fingerprint: string;
}

/* ── Reloj y métricas ─────────────────────────────────────────────────────── */

/** Reloj INYECTABLE (el módulo jamás consulta el reloj del sistema). */
export type SchedulerClock = () => number;

export interface SchedulerMetrics {
  tournaments: number;
  pending: number;
  running: number;
  completed: number;
  retryable: number;
  cancelled: number;
  nextDueAt: number | null;
  byPriority: Record<string, number>;
}
