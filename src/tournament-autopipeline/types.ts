/**
 * TOURNAMENT WATCHER · AUTO PIPELINE COORDINATOR — tipos (Tournament Watcher · Fase 3/5).
 *
 * COORDINA, nunca ejecuta: transforma WatchEvents en PipelineRequests mediante una política
 * DECLARATIVA. Jamás ejecuta Orchestrator/Control/Publisher, jamás publica, jamás aprueba,
 * jamás toma decisiones editoriales: los requests son PLANES que otro (decidido por
 * Tournament Control) ejecutará. Reloj lógico inyectado; todo determinista y serializable.
 */
import type { WatchEvent, WatchEventKind } from "@/tournament-watcher";

export const AUTOPIPELINE_SCHEMA_VERSION = 1;

/* ── Acciones planificables (peticiones, jamás ejecuciones) ───────────────── */

export type PipelineAction =
  /** Someter la generación del torneo a REVISIÓN editorial (vía Tournament Control). */
  | "generate-review"
  /** Revisión COMPLETA de fin de torneo (generación íntegra a revisión). */
  | "generate-full-review"
  /** Esperar: el evento no justifica todavía ninguna petición. */
  | "wait"
  /** Ignorar: el evento no interesa a la política. */
  | "ignore";

/* ── Política declarativa (todo configurable, nada hardcodeado) ───────────── */

export interface DecisionRule {
  /** Tipo de evento del Watcher que dispara la regla. */
  kind: WatchEventKind;
  action: PipelineAction;
  /** Etiqueta humana del motivo (por defecto, el kind). */
  reason?: string;
}

export interface DecisionPolicy {
  /** Primera regla que encaja gana; el ORDEN es la prioridad del motivo al fusionar. */
  rules: DecisionRule[];
  /** Acción para eventos sin regla. */
  defaultAction: PipelineAction;
}

/* ── Peticiones ───────────────────────────────────────────────────────────── */

export type RequestState = "pending" | "planned" | "cancelled" | "duplicate" | "executed";

export interface PipelineRequest {
  /** Id determinista: `<tournamentId>@<action>#<n>`. */
  id: string;
  tournamentId: string;
  action: Exclude<PipelineAction, "wait" | "ignore">;
  /** Motivo dominante (la regla de mayor prioridad entre los eventos fusionados). */
  reason: string;
  /** seq de TODOS los WatchEvents que alimentaron la petición (fusiones incluidas). */
  sourceEventSeqs: number[];
  state: RequestState;
  /** Si state === "duplicate": petición canónica en la que se fusionó. */
  mergedInto?: string;
  createdAt: number;
  updatedAt: number;
}

/* ── Historial (jamás se pierde) ──────────────────────────────────────────── */

export type HistoryKind = "decision" | "request-created" | "request-merged" | "state-changed";

export interface CoordinatorHistoryEntry {
  seq: number;
  at: number;
  kind: HistoryKind;
  tournamentId: string;
  /** Evento origen (seq del Watcher), si aplica. */
  eventSeq?: number;
  eventKind?: WatchEventKind;
  requestId?: string;
  reason: string;
  /** Estado resultante (acción decidida o estado de la petición). */
  state: string;
}

/* ── Registry ─────────────────────────────────────────────────────────────── */

export interface CoordinatorRegistry {
  schemaVersion: number;
  requests: Record<string, PipelineRequest>;
  order: string[];
  history: CoordinatorHistoryEntry[];
  /** Contador por clave torneo@acción (ids deterministas). */
  perKey: Record<string, number>;
  seq: number;
}

/* ── Resultado de una ingesta ─────────────────────────────────────────────── */

export interface IngestResult {
  received: number;
  created: PipelineRequest[];
  /** Eventos fusionados en peticiones ya pendientes. */
  merged: number;
  waited: number;
  ignored: number;
}

export interface CoordinatorMetrics {
  requests: number;
  pending: number;
  planned: number;
  cancelled: number;
  duplicates: number;
  executed: number;
  events: number;
  historyEntries: number;
}

export type CoordinatorClock = () => number;
