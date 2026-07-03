/**
 * NAVIGATION, SCREENS & WINDOW FRAMEWORK — API pública (Render/UI Fase 2/7).
 *
 * Infraestructura ÚNICA y desacoplada sobre la que se montarán TODAS las pantallas del juego (Career/
 * Collection/Online/Gameplay/Marketplace/Battle Pass/…). Máquina de estados PURA de pantallas/ventanas/
 * historial/carga sobre `@/ui-core`. NUNCA es dueña del estado ni contiene lógica de juego. Determinista,
 * versionada, migrable. NO renderiza, NO crea pantallas concretas, NO anima.
 *
 *   ui-core → navigation → screens → features → pages → presentation
 */
export * from "./types";
export { ScreenRegistry } from "./registry";
export { validateNavigation, type GuardContext } from "./guards";
export { NavigationEngine, type OpenWindowOptions } from "./engine";
export { Z_BUCKET, resolveZ, isOverlayKind } from "./windows";
export { breadcrumb, lastScreen, analytics, snapshot, pushRecent } from "./history";
export { idle, loadingOf, errorOf, isBlocking } from "./loading";
export { migrateNavState } from "./migrate";
