/**
 * TOURNAMENT WATCHER · RUNTIME SERVICE — tipos (Tournament Watcher · Fase 5/5, FINAL).
 *
 * Mantiene VIVO el sistema de vigilancia coordinando EXCLUSIVAMENTE los cuatro módulos ya
 * congelados (Scheduler → Watcher → Auto Pipeline → Notification Hub) en un loop con lock,
 * health, métricas y apagado limpio. Jamás interpreta, jamás decide, jamás ejecuta
 * Tournament Control / Orchestrator / Publisher, jamás publica ni aprueba.
 */
import type { RawSnapshot } from "@/importer";

export const RUNTIME_SCHEMA_VERSION = 1;

/* ── Estado del runtime ───────────────────────────────────────────────────── */

export type RuntimeStatus = "idle" | "running" | "sleeping" | "stopping" | "stopped" | "lock-denied";

export interface StageLatencies {
  schedulerMs: number;
  watchMs: number;
  pipelineMs: number;
  notificationsMs: number;
}

export interface RuntimeState {
  status: RuntimeStatus;
  startedAt: number | null;
  stoppedAt: number | null;
  iterations: number;
  lastIterationAt: number | null;
  lastError: string | null;
  latencies: StageLatencies;
}

/* ── Configuración ────────────────────────────────────────────────────────── */

export interface RuntimeConfig {
  /** Clave del lock (una cola = un runtime). */
  lockKey: string;
  /** Identidad de ESTE runtime (dueño del lock). */
  owner: string;
  /** Descanso entre iteraciones (ms, para el sleeper inyectado). */
  sleepMs: number;
  /** QUÉ observar: torneos a vigilar aunque el watcher aún no los conozca. */
  watchlist?: string[];
}

/* ── Dependencias inyectadas (cero red, cero reloj de pared dentro) ───────── */

/** Fuente de snapshots: el runtime JAMÁS descarga; alguien se los da (null ⇒ fallo). */
export type SnapshotSource = (tournamentId: string) => RawSnapshot | null;

/** Reloj lógico inyectable. */
export type RuntimeClock = () => number;

/** Sueño inyectable (el verify lo resuelve al instante). */
export type Sleeper = (ms: number) => Promise<void>;

/* ── Informe de iteración (trazabilidad del ORDEN exacto) ─────────────────── */

export interface IterationReport {
  iteration: number;
  at: number;
  /** Orden EXACTO de etapas ejecutadas en esta iteración. */
  stages: string[];
  planned: number;
  taken: number;
  observed: number;
  failedObservations: number;
  events: number;
  requests: number;
  merged: number;
  messages: number;
  sent: number;
  latencies: StageLatencies;
}

/* ── Health ───────────────────────────────────────────────────────────────── */

export interface RuntimeHealth {
  status: RuntimeStatus;
  uptimeMs: number;
  iterations: number;
  lastIterationAt: number | null;
  lastError: string | null;
  latencies: StageLatencies;
  lockHeld: boolean;
}

/* ── Métricas agregadas ───────────────────────────────────────────────────── */

export interface RuntimeMetrics {
  iterations: number;
  tournamentsWatched: number;
  eventsEmitted: number;
  requestsPending: number;
  requestsTotal: number;
  messagesSent: number;
  messagesPending: number;
}

/* ── Lock (un único runtime por cola) ─────────────────────────────────────── */

export interface RuntimeLock {
  /** true si se adquirió; false si OTRO runtime lo posee. */
  acquire(key: string, owner: string): boolean;
  release(key: string, owner: string): void;
  ownerOf(key: string): string | null;
}
