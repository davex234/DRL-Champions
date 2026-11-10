/**
 * TOURNAMENT ORCHESTRATOR — tipos (Tournament Automation · Fase 2/5).
 *
 * Orquesta el pipeline EXISTENTE F1→F7 (URL de vlr.gg → cartas publicadas en runtime) sin
 * duplicar ni modificar ningún motor: cada etapa envuelve EXACTAMENTE una llamada pública de
 * un motor terminado y pasa su salida INTACTA a la siguiente. Cero lógica de dominio aquí.
 */
import type { VlrImportOutput, VlrImportOptions, VlrEventRef } from "@/importer-vlr";
import type { ImportResult, IdentityRegistry } from "@/importer";
import type { AnalyzerResult, TournamentReport, TournamentFact } from "@/analyzer";
import type { CardGenerationResult, GeneratorLedger, EditorialOverride } from "@/card-generator";
import type { MaterializationResult } from "@/materializer";
import type { CatalogBuildResult, CatalogVersion, CatalogFingerprint } from "@/catalog-builder";
import type { PublishResult, RuntimeVersion } from "@/publisher";
import type { Player } from "@/domain/cards/types";

/* ── Etapas ───────────────────────────────────────────────────────────────── */

/** Las 8 etapas EXACTAS del pipeline (ni una más, ni una menos, sin saltos). */
export type StageId =
  | "importer-vlr"
  | "importer"
  | "analyzer"
  | "performance"
  | "card-generator"
  | "materializer"
  | "catalog-builder"
  | "publisher";

export const STAGE_ORDER: readonly StageId[] = [
  "importer-vlr", "importer", "analyzer", "performance",
  "card-generator", "materializer", "catalog-builder", "publisher",
] as const;

export const STAGE_LABELS: Record<StageId, string> = {
  "importer-vlr": "Importer VLR",
  "importer": "Importer",
  "analyzer": "Analyzer",
  "performance": "Performance Analyzer",
  "card-generator": "Card Generator",
  "materializer": "Materializer",
  "catalog-builder": "Catalog Builder",
  "publisher": "Publisher",
};

/** Salidas acumuladas del pipeline: cada campo es EXACTAMENTE lo que devolvió su motor. */
export interface PipelineOutputs {
  vlr: VlrImportOutput;                 // 1. Importer VLR      → RawSnapshot (+meta/warnings)
  importResult: ImportResult;           // 2. Importer          → CanonicalModel
  report: TournamentReport;             // 3. Analyzer          → AnalyzerResult (informe F2)
  analysis: AnalyzerResult;             // 4. Performance       → AnalyzerResult enriquecido
  generation: CardGenerationResult;     // 5. Card Generator    → CardGenerationResult
  materialization: MaterializationResult; // 6. Materializer    → MaterializationResult
  build: CatalogBuildResult;            // 7. Catalog Builder   → CatalogBuildResult
  publish: PublishResult;               // 8. Publisher         → PublishResult
}

/* ── Errores ──────────────────────────────────────────────────────────────── */

/** Fallo de una etapa: detiene el pipeline en el acto y CONSERVA el stack de la causa. */
export class PipelineError extends Error {
  readonly stage: StageId;
  constructor(stage: StageId, message: string, cause?: unknown) {
    super(message);
    this.name = "PipelineError";
    this.stage = stage;
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.name} [${stage}]: ${message}\n── causa original ──\n${cause.stack}`;
    }
  }
}

/** Versión serializable del error (el stack original viaja íntegro). */
export interface PipelineErrorInfo {
  stage: StageId;
  message: string;
  stack?: string;
}

/* ── Eventos ──────────────────────────────────────────────────────────────── */

/** Observadores de progreso (CLI, dashboards). Un listener que lanza JAMÁS rompe el pipeline. */
export interface OrchestratorEvents {
  onStageStart?(stage: StageId, label: string): void;
  onStageEnd?(stage: StageId, ms: number, outputs: Readonly<Partial<PipelineOutputs>>): void;
  onStageError?(stage: StageId, error: PipelineError): void;
}

/* ── Contexto ─────────────────────────────────────────────────────────────── */

export interface OrchestratorCtx {
  /** Reloj lógico del pipeline (los motores nunca llaman a Date.now); la CLI pasa Date.now(). */
  now?: number;
  /** Roster vivo del catálogo. Por defecto `allPlayers()` (igual que el resto del pipeline). */
  roster?: Player[];
  /** Registro de identidades para el Importer (por defecto vacío). */
  registry?: IdentityRegistry;
  /** Contexto histórico para el Performance Analyzer (por defecto ninguno). */
  history?: TournamentFact[];
  /** Opciones del conector VLR (fetcher inyectable ⇒ offline/determinista). */
  vlr?: VlrImportOptions;
  /** Ledger editorial para encadenar torneos (idempotencia del Card Generator). */
  ledger?: GeneratorLedger;
  overrides?: EditorialOverride[];
  aliases?: Record<string, string>;
  season?: number;
  /** Persistencia opcional del roster publicado (passthrough al Publisher, igual que en la app). */
  persist?: (players: Player[]) => void;
  events?: OrchestratorEvents;
  /** Cronómetro inyectable (ms). Solo afecta a métricas de tiempo, nunca a los datos. */
  timer?: () => number;
}

/* ── Métricas ─────────────────────────────────────────────────────────────── */

export interface StageTiming {
  stage: StageId;
  ms: number;
}

export interface OrchestratorMetrics {
  /** Tiempo por etapa, en orden de EJECUCIÓN (si falló la N, solo hay N entradas). */
  stages: StageTiming[];
  totalMs: number;
  teams: number;
  players: number;
  matches: number;
  maps: number;
  cardsGenerated: number;
  cardsMaterialized: number;
  /** Specs sin cambios respecto a la última materialización (cache hit). */
  cardsUnchanged: number;
  /** Cartas aplicadas al runtime (altas + actualizaciones). 0 si el publish fue no-op. */
  cardsPublished: number;
  generationId: string;
  catalogVersion: CatalogVersion;
  catalogFingerprint: CatalogFingerprint;
  runtimeVersion: RuntimeVersion;
}

/* ── Resultado ────────────────────────────────────────────────────────────── */

export interface OrchestratorResult {
  ok: boolean;
  url: string;
  ref?: VlrEventRef;
  tournamentName?: string;
  outputs: Partial<PipelineOutputs>;
  metrics: OrchestratorMetrics;
  /** Etapa donde se detuvo el pipeline (solo si ok === false). */
  failedStage?: StageId;
  error?: PipelineErrorInfo;
}
