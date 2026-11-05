/**
 * TOURNAMENT WATCHER · WATCH ENGINE — tipos (Tournament Watcher · Fase 1/5).
 *
 * Motor de OBSERVACIÓN pura: recibe snapshots de torneos (RawSnapshot, el contrato oficial
 * del Importer), los compara con el snapshot anterior y emite EVENTOS. Jamás ejecuta el
 * pipeline, jamás llama a Publisher/Orchestrator/Control/Telegram, jamás descarga, jamás
 * modifica ningún estado del juego: toda acción futura la decidirá Tournament Control.
 */
import type { RawSnapshot } from "@/importer";

export const WATCHER_SCHEMA_VERSION = 1;

/* ── Eventos (detectar, nunca interpretar ni actuar) ──────────────────────── */

export type WatchEventKind =
  | "tournament-created" | "tournament-updated" | "tournament-finished" | "tournament-removed"
  | "name-changed" | "status-changed" | "prize-changed" | "dates-changed" | "venue-changed"
  | "team-added" | "team-removed" | "team-qualified" | "team-eliminated" | "roster-changed"
  | "match-added" | "match-updated" | "result-changed" | "bracket-changed"
  | "map-added" | "statistics-changed";

export const WATCH_EVENT_KINDS: readonly WatchEventKind[] = [
  "tournament-created", "tournament-updated", "tournament-finished", "tournament-removed",
  "name-changed", "status-changed", "prize-changed", "dates-changed", "venue-changed",
  "team-added", "team-removed", "team-qualified", "team-eliminated", "roster-changed",
  "match-added", "match-updated", "result-changed", "bracket-changed",
  "map-added", "statistics-changed",
] as const;

export interface WatchEvent {
  /** Secuencia global monótona del registry. */
  seq: number;
  /** Fecha LÓGICA de la observación (inyectada; jamás Date.now aquí). */
  at: number;
  tournamentId: string;
  kind: WatchEventKind;
  /** Sujeto del evento (equipo, partido, jugador…). */
  subject?: string;
  detail?: string;
}

/* ── Resultado de una observación ─────────────────────────────────────────── */

export interface WatchResult {
  tournamentId: string;
  /** true si el fingerprint cambió respecto a la revisión anterior. */
  changed: boolean;
  previousFingerprint?: string;
  fingerprint: string;
  /** Revisión resultante (1 = primera observación). */
  revision: number;
  events: WatchEvent[];
}

/* ── Registry (último snapshot · última revisión · fingerprint · historial) ── */

export interface WatchedTournament {
  tournamentId: string;
  revision: number;
  fingerprint: string;
  /** ÚLTIMO snapshot observado (el anterior se descarta: el diff ya quedó en eventos). */
  snapshot: RawSnapshot;
  /** Última observación (fecha lógica). */
  observedAt: number;
  /** Historial COMPLETO de eventos del torneo (jamás se pierde). */
  history: WatchEvent[];
  /** true si el torneo dejó de aparecer en las observaciones. */
  removed?: boolean;
}

export interface WatcherRegistry {
  schemaVersion: number;
  tournaments: Record<string, WatchedTournament>;
  /** Orden de descubrimiento. */
  order: string[];
  seq: number;
}

/* ── Métricas ─────────────────────────────────────────────────────────────── */

export interface WatchMetrics {
  observed: number;
  active: number;
  finished: number;
  removed: number;
  revisions: number;
  events: number;
  byKind: Partial<Record<WatchEventKind, number>>;
}

export interface ObserveMeta {
  /** Reloj lógico de la observación. */
  at: number;
}
