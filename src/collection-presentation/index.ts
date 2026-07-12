// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
/**
 * COLLECTION PRESENTATION, MUSEUM & SHOWCASE ENGINE — API pública (Collection Fase 7/7, FINAL).
 *
 * Capa AAA de PRESENTACIÓN de SOLO LECTURA que cierra el módulo Collection. PROYECTA los datos de todos
 * los motores (Collection/Deck/Marketplace/Craft/Battle Pass/Career/Living World/Competitive) en vistas
 * (Museum/Showcase/Album/Analytics/Timeline/Profile/Reviews). Nunca modifica cartas/inventario/economía/
 * progreso: Collection sigue siendo el único dueño. Determinista. No abre monetización/tienda/3D/UI.
 *
 *   Motores existentes → PresentationContext (read-only) → PresentationEngine → View-models
 */
export * from "./types";
export type { PresentationContext } from "./context";
export { PresentationEngine } from "./engine";
export { museumView } from "./museum";
export { showcaseView } from "./showcase";
export { albumView } from "./album";
export { analyticsView } from "./analytics";
export { collectionSummary, timeline, cardDetail, profileView, seasonReview, careerReview } from "./presentation";
export { migrateShowcaseConfig } from "./migrate";
