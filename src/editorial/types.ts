/**
 * EDITORIAL WORKFLOW — tipos (Tournament Automation · Fase 4/5).
 *
 * Sistema editorial ENTRE el Card Generator y el Publisher: administra estados editoriales de
 * una generación YA decidida (nunca regenera cartas, nunca recalcula stats, nunca toca los
 * motores). La generación viaja íntegra y serializada dentro del caso editorial; publicar =
 * componer los motores existentes con la generación FILTRADA a lo aprobado.
 */
import type { CardGenerationResult } from "@/card-generator";
import type { MaterializationResult } from "@/materializer";
import type { CatalogBuildResult } from "@/catalog-builder";
import type { PublishResult } from "@/publisher";

/* ── Estados ──────────────────────────────────────────────────────────────── */

export type EditorialState =
  | "draft"      // recién sometida, sin revisar
  | "review"     // en revisión
  | "approved"   // lista para publicar
  | "published"  // aplicada al runtime por publishApproved
  | "archived"   // ciclo cerrado
  | "rejected"   // no se publica (reversible: volver a review)
  | "hidden"     // apartada de la publicación sin veredicto (reversible)
  | "blocked";   // vetada (solo un retorno explícito a review la desbloquea)

export const EDITORIAL_STATES: readonly EditorialState[] = [
  "draft", "review", "approved", "published", "archived", "rejected", "hidden", "blocked",
] as const;

export type EditorialAction =
  | "to_review" | "approve" | "reject" | "hide" | "block" | "publish" | "archive";

/* ── Historial ────────────────────────────────────────────────────────────── */

/** Entrada de historial: quién, cuándo, de dónde a dónde, comentario, motivo, generación. */
export interface EditorialEvent {
  /** Secuencia monótona dentro del caso (orden total, determinista). */
  seq: number;
  at: number;
  actor: string;
  action: EditorialAction | "submit";
  /** Ausente en eventos a nivel de generación (submit/publicación). */
  cardId?: string;
  from?: EditorialState;
  to?: EditorialState;
  comment?: string;
  reason?: string;
  generationId: string;
}

/* ── Caso editorial (una generación bajo revisión) ────────────────────────── */

export interface EditorialCase {
  schemaVersion: number;
  generationId: string;
  tournamentId: string;
  tournamentName: string;
  season: number;
  submittedAt: number;
  submittedBy: string;
  /** La generación ÍNTEGRA (serializable): la fuente única para publicar después. */
  generation: CardGenerationResult;
  /** Estado editorial vigente por cardId. */
  states: Record<string, EditorialState>;
  history: EditorialEvent[];
}

/* ── Decisiones ───────────────────────────────────────────────────────────── */

export interface DecisionMeta {
  actor: string;
  at: number;
  comment?: string;
  reason?: string;
}

export interface DecisionResult {
  case: EditorialCase;
  /** Cartas cuya transición se aplicó. */
  applied: string[];
  /** Cartas cuya transición era ILEGAL (no se tocaron; cero estados imposibles). */
  skipped: { cardId: string; error: string }[];
}

/* ── Publicación de lo aprobado ───────────────────────────────────────────── */

export interface ExcludedCard {
  cardId: string;
  state: EditorialState;
  /** Por qué no se publica (estado no aprobado o dependencia de composición). */
  reason: string;
}

export interface PublishApprovedResult {
  ok: boolean;
  error?: string;
  /** Caso actualizado (approved → published + historial) SOLO si la publicación aplicó. */
  case: EditorialCase;
  publish?: PublishResult;
  build?: CatalogBuildResult;
  materialization?: MaterializationResult;
  /** Cartas aprobadas efectivamente publicadas. */
  published: string[];
  /** Cartas de la generación que NO viajaron (con su porqué). */
  excluded: ExcludedCard[];
  /** Grants descartados porque su variante no está íntegramente aprobada. */
  droppedGrants: { playerId: string; accolade: string; reason: string }[];
}
