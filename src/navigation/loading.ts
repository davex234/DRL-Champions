/**
 * LOADING / ERROR HOST (Render/UI Fase 2/7) — contratos de estados de carga/error. Sin lógica de juego.
 *
 * Produce estados de carga (blocking/background/skeleton) y de error (offline/recoverable/fatal/
 * maintenance/version_mismatch) con su capacidad de reintento. Puro y determinista.
 */
import { freshLoading, type LoadingState, type LoadingKind, type ErrorKind } from "./types";

export const idle = (): LoadingState => freshLoading();

export function loadingOf(kind: LoadingKind, progress = 0, message?: string): LoadingState {
  return { loading: kind, progress: Math.max(0, Math.min(1, progress)), error: "none", retryable: false, message };
}

/** Errores que admiten reintento (el resto son terminales/no recuperables sin acción externa). */
const RETRYABLE: Record<ErrorKind, boolean> = {
  none: false, offline: true, recoverable: true, fatal: false, maintenance: false, version_mismatch: false,
};

export function errorOf(kind: ErrorKind, message?: string): LoadingState {
  return { loading: "idle", progress: 0, error: kind, retryable: RETRYABLE[kind], message };
}

export const isBlocking = (s: LoadingState): boolean => s.loading === "blocking" || (s.error !== "none" && !s.retryable);
