/**
 * ARTWORK AI & QUALITY ASSISTANT — API pública (Artwork Pipeline · Fase 6/6, FINAL).
 *
 * Asistente de calidad de SOLO LECTURA sobre el ecosistema artwork: analiza métricas
 * objetivas (resolución, nitidez, transparencia, bordes, compresión), duplicados,
 * consistencia (sujeto/versión/oficialidad), inventario (huérfanos, sin uso, sin licencia)
 * y produce QualityScore 0..100 + QualityReport + Suggestions. Sin IA generativa; jamás
 * modifica assets, imágenes, Registry, composiciones ni decisiones del juego.
 */
export * from "./types";
export { analyzePixels, analyzeManagerPixels, type QualityReader } from "./analysis";
export { resolutionIssues } from "./resolution";
export { backgroundIssues } from "./background";
export { croppingIssues } from "./cropping";
export { findDuplicates, duplicateIssues } from "./duplicates";
export { consistencyIssues } from "./consistency";
export { scoreAsset, gradeOf } from "./quality";
export { buildSuggestions } from "./recommendations";
export { inventoryIssues, detectIssues, buildReport } from "./report";
export { ArtworkQualityAssistant, type QualityAssistantOptions } from "./engine";
