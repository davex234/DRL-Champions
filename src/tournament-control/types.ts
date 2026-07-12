/**
 * TOURNAMENT CONTROL CENTER — tipos (Tournament Automation · Fase 5/5).
 *
 * Capa de ORQUESTACIÓN VISUAL sobre los motores existentes: el punto único desde el que un
 * administrador controla el ciclo de vida de un torneo (importar → generar → revisar → publicar
 * → rollback). NO genera lógica de dominio: cada acción compone EXACTAMENTE llamadas públicas
 * de motores terminados (Orchestrator/Editorial/Publisher) y cada vista es una proyección pura
 * del `ControlLedger` (estado serializable del panel). Jamás recalcula ni regenera cartas.
 */
import type { OrchestratorMetrics } from "@/tournament-orchestrator";
import type { CardGenerationResult } from "@/card-generator";
import type { EditorialCase, EditorialState } from "@/editorial";
import type { CatalogVersion } from "@/catalog-builder";
import type { RuntimeVersion } from "@/publisher";

export const TOURNAMENT_CONTROL_SCHEMA_VERSION = 1;

/* ── Ledger (estado único del panel, 100% serializable) ───────────────────── */

/** Origen del registro: run completo del Orchestrator o generación para revisión del panel. */
export type RecordSource = "orchestrator" | "control";

export interface GenerationRecord {
  /** Clave del registro: el generationId, o `${generationId}~R<n>` para duplicados de revisión. */
  recordId: string;
  generationId: string;
  tournamentId: string;
  tournamentName: string;
  season: number;
  /** URL de origen (solo runs del Orchestrator). */
  url?: string;
  source: RecordSource;
  importedAt: number;
  /** recordId original si este registro es un duplicado para re-revisión. */
  revisionOf?: string;
  /** Métricas OFICIALES del pipeline (computeMetrics del Orchestrator; nunca recalculadas). */
  metrics: OrchestratorMetrics;
  /** La generación ÍNTEGRA (única fuente para revisar/publicar/comparar; jamás se regenera). */
  generation: CardGenerationResult;
  /** Caso editorial vigente (null hasta abrir revisión). */
  editorial: EditorialCase | null;
}

export type ControlEventKind =
  | "import" | "generate" | "open-review" | "decision"
  | "publish" | "rollback" | "reopen-review" | "duplicate" | "export";

/** Evento del panel: quién hizo qué, cuándo (reloj lógico) y sobre qué generación. */
export interface ControlEvent {
  seq: number;
  at: number;
  actor: string;
  kind: ControlEventKind;
  recordId: string;
  generationId: string;
  detail?: string;
}

export interface ControlLedger {
  schemaVersion: number;
  /** Registros por recordId. */
  records: Record<string, GenerationRecord>;
  /** Orden de inserción (cronología del panel). */
  order: string[];
  events: ControlEvent[];
}

/* ── Estado derivado de un registro ───────────────────────────────────────── */

export type RecordStatus =
  | "generated"   // generación registrada, revisión sin abrir
  | "in-review"   // caso editorial abierto con decisiones pendientes
  | "approved"    // todo lo decidible aprobado, sin publicar
  | "published"   // publicada (por el panel o por el run del Orchestrator)
  | "rolled-back" // la última acción de runtime sobre el registro fue un rollback
  | "archived";   // ciclo cerrado (todas las cartas archivadas)

export const RECORD_STATUSES: readonly RecordStatus[] = [
  "generated", "in-review", "approved", "published", "rolled-back", "archived",
] as const;

/* ── Dashboard ────────────────────────────────────────────────────────────── */

export interface RuntimeInfo {
  runtimeVersion: RuntimeVersion;
  generationId: string;
}

export interface DashboardRow {
  recordId: string;
  tournamentId: string;
  tournamentName: string;
  generationId: string;
  season: number;
  /** Fecha lógica de entrada al panel. */
  date: number;
  status: RecordStatus;
  cards: number;
  approved: number;
  /** draft + review (sin veredicto). */
  pending: number;
  blocked: number;
  rejected: number;
  hidden: number;
  published: number;
  archived: number;
  runtimeVersion: RuntimeVersion;
  catalogVersion: CatalogVersion;
  /** true si esta generación es la vigente en el runtime. */
  live: boolean;
  source: RecordSource;
  revisionOf?: string;
}

/* ── Filtros y orden ──────────────────────────────────────────────────────── */

export interface DashboardFilter {
  status?: RecordStatus;
  season?: number;
  /** tournamentId exacto o fragmento del nombre (case-insensitive). */
  tournament?: string;
  source?: RecordSource;
  liveOnly?: boolean;
}

export type DashboardSortKey = "date" | "tournament" | "cards" | "approved" | "published" | "status";

/* ── Búsqueda ─────────────────────────────────────────────────────────────── */

export interface SearchHit {
  kind: "tournament" | "generation" | "card";
  recordId: string;
  /** tournamentId | generationId | cardId. */
  ref: string;
  label: string;
}

/* ── Comparador ───────────────────────────────────────────────────────────── */

export interface OvrChange { cardId: string; from: number; to: number }
export interface RarityChange { cardId: string; from: string; to: string }
export interface BadgeChange { cardId: string; added: string[]; removed: string[] }
export interface CollectionChange { cardId: string; inA: boolean; inB: boolean }
export interface EditorialChange { cardId: string; from: EditorialState | "sin-caso"; to: EditorialState | "sin-caso" }

export interface GenerationComparison {
  a: string;
  b: string;
  addedCards: string[];
  removedCards: string[];
  ovrChanged: OvrChange[];
  rarityChanged: RarityChange[];
  badgesChanged: BadgeChange[];
  collectionChanged: CollectionChange[];
  editorialChanged: EditorialChange[];
  identical: boolean;
}

/* ── Historial unificado ──────────────────────────────────────────────────── */

export interface HistoryEntry {
  at: number;
  /** control = evento del panel · editorial = evento del caso (historial F4). */
  source: "control" | "editorial";
  kind: string;
  actor: string;
  recordId: string;
  generationId: string;
  cardId?: string;
  detail?: string;
  /** Desempate estable dentro de su fuente. */
  seq: number;
}

/* ── Métricas ─────────────────────────────────────────────────────────────── */

export interface ControlMetrics {
  records: number;
  tournaments: number;
  totalMs: number;
  /** Tiempo agregado por etapa del pipeline (suma sobre todos los runs registrados). */
  stages: { stage: string; ms: number }[];
  teams: number;
  players: number;
  matches: number;
  maps: number;
  cardsGenerated: number;
  cardsMaterialized: number;
  cardsPublished: number;
  /** Eventos de publicación del panel (incluye la del run del Orchestrator al ingerirlo). */
  publications: number;
  rollbacks: number;
  /** Agregado editorial global de todos los casos abiertos. */
  editorial: Record<EditorialState, number>;
}

/* ── Informe exportable ───────────────────────────────────────────────────── */

export interface ControlReport {
  schemaVersion: number;
  generatedAt: number;
  row: DashboardRow;
  metrics: OrchestratorMetrics;
  editorial: Record<EditorialState, number> | null;
  history: HistoryEntry[];
}

/* ── Resultado de acciones (nunca mutan; ilegales ⇒ error sin tocar nada) ─── */

export interface ControlActionMeta {
  actor: string;
  at: number;
  comment?: string;
  reason?: string;
}

export interface ControlActionResult<T = undefined> {
  ledger: ControlLedger;
  /** Presente solo si la acción aplicó. */
  value?: T;
  /** Presente solo si la acción fue rechazada (el ledger devuelto es EL MISMO objeto). */
  error?: string;
}
