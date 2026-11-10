/**
 * CARD REVIEW — API pública (Tournament Automation · Fase 3/5).
 *
 * Proyección de SOLO LECTURA de la última generación publicada para el Review Dashboard
 * (/admin/card-review): `buildReviewModel` (pipeline outputs → filas), filtros/orden/facetas
 * y un store mínimo de persistencia. Cero motores nuevos: solo reorganiza salidas existentes.
 *
 * NOTA: el store (`useReviewStore`) es client-only; se importa desde "./store" directamente
 * en la UI para no arrastrar zustand a los scripts de verificación.
 */
export * from "./types";
export { buildReviewModel, REVIEW_SCHEMA_VERSION, type ReviewSource } from "./build";
export { applyReviewFilter, sortReviewRows, reviewFacets } from "./filter";
