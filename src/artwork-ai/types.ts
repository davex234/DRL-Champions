/**
 * ARTWORK AI & QUALITY ASSISTANT — tipos (Artwork Pipeline · Fase 6/6, FINAL).
 *
 * Asistente de calidad 100% de SOLO LECTURA: analiza los assets existentes (metadatos del
 * Manager, píxeles vía sharp en modo lectura, ciclo de vida del Updater, uso real en
 * composiciones) y produce EXCLUSIVAMENTE QualityReport + Suggestions + Warnings. Jamás
 * modifica un asset, una imagen, el Registry, una composición ni una decisión del juego.
 * Sin IA generativa: métricas objetivas y reglas deterministas.
 */
import type { ArtworkAsset, ArtworkCategory, ArtworkRefs } from "@/artwork";
import type { ArtworkComposition } from "@/artwork-composer";
import type { LifecycleState } from "@/artwork-updater";

export const ARTWORK_AI_SCHEMA_VERSION = 1;

/* ── Análisis de píxeles (solo lectura) ───────────────────────────────────── */

export interface PixelAnalysis {
  width: number;
  height: number;
  hasAlpha: boolean;
  /** Proporción de píxeles transparentes (0..1). */
  transparentRatio: number;
  /** Proporción de píxeles OPACOS pegados al borde (0..1; alto ⇒ recorte/fondo sin quitar). */
  edgeOpaqueRatio: number;
  /** Nitidez aproximada (desviación típica de luminancia, 0..1 normalizada). */
  sharpness: number;
  /** Bytes por píxel del fichero (bajo ⇒ compresión excesiva). */
  bytesPerPixel: number;
  /** Huella del contenido decodificado (detección de duplicados reales). */
  contentHash: string;
  /** true si los bytes no decodifican. */
  corrupt: boolean;
}

/* ── Issues y sugerencias ─────────────────────────────────────────────────── */

export type QualityIssueCode =
  | "LOW_RESOLUTION" | "TOO_SMALL" | "BAD_ASPECT" | "NO_TRANSPARENCY" | "CROPPED_EDGES"
  | "BACKGROUND_NOT_REMOVED" | "OVER_COMPRESSED" | "DUPLICATE" | "OUTDATED_VERSION"
  | "UNOFFICIAL_MISMATCH" | "CORRUPT" | "ORPHAN" | "UNUSED" | "NO_LICENSE" | "INCONSISTENT_SUBJECT";

export type QualitySeverity = "info" | "warning" | "critical";

export interface QualityIssue {
  assetId: string;
  category: ArtworkCategory;
  code: QualityIssueCode;
  severity: QualitySeverity;
  message: string;
}

export interface Suggestion {
  assetId?: string;
  code: QualityIssueCode;
  priority: number;
  message: string;
}

/* ── Quality Score ────────────────────────────────────────────────────────── */

export interface QualityDimensions {
  resolution: number;
  sharpness: number;
  consistency: number;
  format: number;
  usage: number;
  license: number;
  status: number;
}

export type QualityGrade = "excelente" | "bueno" | "aceptable" | "deficiente" | "crítico";

export interface AssetQuality {
  assetId: string;
  category: ArtworkCategory;
  subjectId?: string;
  /** 0..100. */
  score: number;
  grade: QualityGrade;
  dimensions: QualityDimensions;
  issues: QualityIssue[];
}

/* ── Contexto de análisis (todo INYECTADO y de solo lectura) ──────────────── */

export interface AnalysisContext {
  assets: ArtworkAsset[];
  /** Análisis de píxeles por assetId (null = ilegible/no local; se analiza por metadatos). */
  pixels: Map<string, PixelAnalysis | null>;
  /** Estado del ciclo de vida (licencias, versiones, proveedor). Opcional. */
  lifecycle?: LifecycleState;
  /** Referencias vivas del juego (huérfanos). Opcional. */
  refs?: ArtworkRefs;
  /** Composiciones existentes (uso real + consistencia). SOLO se leen. */
  compositions?: ArtworkComposition[];
  /** Fecha lógica del informe. */
  now: number;
  /** Etiqueta del ámbito analizado (p.ej. el generationId). */
  scope?: string;
}

/* ── Informe ──────────────────────────────────────────────────────────────── */

export interface DuplicateGroup {
  contentHash: string;
  assetIds: string[];
}

export interface QualityReport {
  schemaVersion: number;
  generatedAt: number;
  scope?: string;
  analyzed: number;
  averageScore: number;
  byGrade: Record<QualityGrade, number>;
  /** Ranking completo (mejor → peor; estable). */
  ranking: { assetId: string; score: number; grade: QualityGrade }[];
  duplicates: DuplicateGroup[];
  unlicensed: string[];
  orphans: string[];
  unused: string[];
  issues: QualityIssue[];
  suggestions: Suggestion[];
  assets: AssetQuality[];
  fingerprint: string;
}
