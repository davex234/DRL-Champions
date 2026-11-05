/**
 * ASSET ACQUISITION ENGINE — tipos (Artwork Pipeline · Fase 4/6).
 *
 * Consigue recursos gráficos que FALTAN para una generación y los registra en el Artwork
 * Asset Manager. Su salida son EXCLUSIVAMENTE ArtworkAsset registrados: jamás renderiza,
 * jamás compone, jamás toca una ArtworkComposition ni una decisión del Composer.
 * Pipeline: identidad → búsqueda → selección → descarga → validación → normalización →
 * hash → deduplicación → registro. Red SOLO detrás de proveedores/fetchers inyectables.
 */
import type { ArtworkAsset, ArtworkCategory } from "@/artwork";

export const ACQUISITION_SCHEMA_VERSION = 1;

/* ── Objetivo de adquisición ──────────────────────────────────────────────── */

/** Un asset REQUERIDO por una generación (falta en el Manager: hoy lo cubre un placeholder). */
export interface AcquisitionTarget {
  category: ArtworkCategory;
  /** Sujeto canónico del juego (playerId, slug de equipo, ISO, tournamentId…). */
  subjectId: string;
  /** Nombres/alias para BUSCAR en proveedores (nick, nombre completo, tag…). */
  searchTerms: string[];
}

/* ── Proveedores (arquitectura abierta; no acoplada a un sitio) ───────────── */

export type LicenseKind = "official" | "editorial" | "cc" | "unknown";

export interface AssetCandidate {
  providerId: string;
  /** Localizador del recurso EN el proveedor (URL, ruta local, id interno…). */
  sourceRef: string;
  /** Puntuación del proveedor para este candidato (mayor = mejor). */
  score: number;
  width?: number;
  height?: number;
  format?: string;
  license?: LicenseKind;
}

export interface CandidateMetadata {
  title?: string;
  author?: string;
  sourceUrl?: string;
  publishedAt?: number;
}

/** Contrato de proveedor: search · download · metadata · license · priority · health. */
export interface AssetProvider {
  readonly id: string;
  /** Prioridad global (mayor = se consulta antes). */
  priority(): number;
  /** ¿Operativo? (false ⇒ se salta sin fallar el pipeline). */
  health(): Promise<boolean> | boolean;
  search(target: AcquisitionTarget): Promise<AssetCandidate[]>;
  download(candidate: AssetCandidate): Promise<Uint8Array>;
  metadata(candidate: AssetCandidate): Promise<CandidateMetadata>;
  license(candidate: AssetCandidate): Promise<LicenseKind>;
}

/* ── Validación ───────────────────────────────────────────────────────────── */

export interface CategoryRequirements {
  /** Resolución mínima (lado menor, px). */
  minSize: number;
  /** Relación de aspecto esperada (ancho/alto) ± tolerancia. */
  aspect: number;
  aspectTolerance: number;
  /** ¿Exige canal alfa (fondo transparente)? */
  requiresAlpha: boolean;
  /** Peso máximo aceptado (bytes). */
  maxBytes: number;
  /** Tamaño ESTÁNDAR de salida tras normalizar (ancho px). */
  normalizedWidth: number;
}

export interface ValidationIssue {
  code: "BAD_FORMAT" | "TOO_SMALL" | "BAD_ASPECT" | "NO_ALPHA" | "TOO_HEAVY" | "CORRUPT" | "DUPLICATE";
  message: string;
}

export interface CandidateValidation {
  ok: boolean;
  issues: ValidationIssue[];
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
}

/* ── Normalización ────────────────────────────────────────────────────────── */

export interface NormalizedAsset {
  target: AcquisitionTarget;
  /** PNG normalizado (tamaño estándar). */
  png: Uint8Array;
  /** WEBP lossless equivalente. */
  webp: Uint8Array;
  width: number;
  height: number;
  /** Huella determinista del PNG normalizado (dedupe + integridad). */
  contentHash: string;
  /** Nombre de fichero estándar (convención del Manager). */
  fileName: string;
}

/* ── Resultado ────────────────────────────────────────────────────────────── */

export type AcquisitionOutcome =
  | "already-available"   // el Manager ya tenía asset real
  | "downloaded"          // adquirido, validado, normalizado y registrado
  | "reused"              // deduplicado (mismo contenido/sujeto ya adquirido)
  | "rejected"            // candidatos inválidos (nunca se registran)
  | "pending";            // sin candidatos (queda en placeholder)

export interface AcquiredAsset {
  target: AcquisitionTarget;
  outcome: AcquisitionOutcome;
  providerId?: string;
  candidate?: AssetCandidate;
  /** Asset registrado en el Manager (solo downloaded/reused/already-available). */
  asset?: ArtworkAsset;
  issues?: ValidationIssue[];
  contentHash?: string;
}

export interface AcquisitionReport {
  schemaVersion: number;
  generationId: string;
  at: number;
  /** Totales del contrato: requeridos · disponibles · descargados · reutilizados · rechazados · pendientes. */
  required: number;
  available: number;
  downloaded: number;
  reused: number;
  rejected: number;
  pending: number;
  /** Candidatos encontrados en total (proveedores). */
  found: number;
  results: AcquiredAsset[];
  cache: { downloadHits: number; validationHits: number; normalizationHits: number };
  /** Huella determinista del informe. */
  fingerprint: string;
}
