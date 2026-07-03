/**
 * NAVIGATION, SCREENS & WINDOW FRAMEWORK — vocabulario compartido (Render/UI Fase 2/7).
 *
 * Infraestructura PURA y DETERMINISTA sobre la que vivirán TODAS las pantallas del juego. Coordina
 * pantallas/ventanas/historial/carga; NUNCA contiene lógica de juego ni es dueña del estado (gameplay/
 * collection/online viven en sus motores). Depende de `@/ui-core` (z-order/tokens); nunca al revés. Sin
 * `Date.now`/`Math.random`: el reloj lógico (`at`) y los ids se inyectan por el borde.
 *
 *   ui-core → navigation → screens → features → pages → presentation
 */
export const NAV_SCHEMA_VERSION = 1;

// ───────────────────────────── Pantallas ─────────────────────────────

/** Tipo de superficie donde se monta una pantalla/contenido. */
export type WindowKind =
  | "screen" | "modal" | "drawer" | "overlay" | "inspector" | "popup" | "dialog"
  | "tooltip" | "contextmenu" | "notification" | "loading" | "error";

export type CachePolicy = "none" | "keep" | "forever";
export type ScreenLifecycle = "mounting" | "active" | "paused" | "unmounting";

/** Descriptor de pantalla (registro por datos). Sin componentes: solo el contrato. */
export interface ScreenDescriptor {
  id: string;
  /** Patrón de ruta (`/coleccion`, `/abrir/:packId`). */
  route: string;
  title: string;
  /** Carga diferida (lazy). */
  lazy?: boolean;
  cache?: CachePolicy;
  /** Ids de guards que deben cumplirse para entrar. */
  guards?: string[];
  /** Superficie por defecto (por defecto "screen"). */
  window?: WindowKind;
  fullscreen?: boolean;
  metadata?: Record<string, unknown>;
}

/** Instancia de pantalla en el stack. */
export interface ScreenInstance {
  key: string;
  screenId: string;
  params: Record<string, string>;
  lifecycle: ScreenLifecycle;
  at: number;
}

// ───────────────────────────── Ventanas ─────────────────────────────

export interface WindowInstance {
  id: string;
  kind: WindowKind;
  screenId?: string;
  params?: Record<string, string>;
  /** z-index resuelto (reutiliza los tokens Z de ui-core + orden de apertura). */
  z: number;
  focused: boolean;
  fullscreen?: boolean;
  dismissable?: boolean;
  openedAt: number;
}

// ───────────────────────────── Historial ─────────────────────────────

export interface HistoryEntry { screenId: string; params: Record<string, string>; at: number }
export interface Breadcrumb { screenId: string; title: string; params: Record<string, string> }

export interface NavAnalytics {
  totalScreens: number;
  openWindows: number;
  historyLength: number;
  historyIndex: number;
  recent: string[];
  depth: number;
  visits: Record<string, number>;
}

// ───────────────────────────── Carga / errores ─────────────────────────────

export type LoadingKind = "idle" | "blocking" | "background" | "skeleton";
export type ErrorKind = "none" | "offline" | "recoverable" | "fatal" | "maintenance" | "version_mismatch";

export interface LoadingState {
  loading: LoadingKind;
  progress: number; // 0..1
  error: ErrorKind;
  retryable: boolean;
  message?: string;
}

export const freshLoading = (): LoadingState => ({ loading: "idle", progress: 0, error: "none", retryable: false });

// ───────────────────────────── Estado global de navegación ─────────────────────────────

export interface NavState {
  version: number;
  stack: ScreenInstance[];
  activeScreenId: string | null;
  /** Ventanas abiertas indexadas por id (O(1) abrir/cerrar/enfocar). Orden de inserción preservado. */
  windows: Record<string, WindowInstance>;
  /** Orden de foco de superficies overlay (puede contener ids obsoletos: limpieza perezosa). */
  focusOrder: string[];
  focusedWindowId: string | null;
  /** Contador monótono de aperturas por tipo (para el z-order estable). */
  perKind: Record<string, number>;
  history: HistoryEntry[];
  historyIndex: number;
  recent: string[];
  visits: Record<string, number>;
  loading: LoadingState;
  /** Contador determinista para ids (sin Math.random). */
  seq: number;
}

export function freshNavState(): NavState {
  return {
    version: NAV_SCHEMA_VERSION, stack: [], activeScreenId: null, windows: {}, focusOrder: [], focusedWindowId: null,
    perKind: {}, history: [], historyIndex: -1, recent: [], visits: {}, loading: freshLoading(), seq: 0,
  };
}

// ───────────────────────────── Eventos / resultados ─────────────────────────────

export type NavEventType =
  | "navigate" | "replace" | "back" | "forward" | "push" | "pop" | "reset"
  | "window_open" | "window_close" | "window_focus" | "window_blur"
  | "loading_changed" | "error_shown" | "blocked" | "restored";

export interface NavEvent { type: NavEventType; at: number; screenId?: string; windowId?: string; data?: unknown }

export interface NavResult {
  ok: boolean;
  error?: string;
  state: NavState;
  events: NavEvent[];
}

export interface RouteMatch { screenId: string; params: Record<string, string> }
export interface NavIssue { code: string; message: string }
export interface NavValidation { ok: boolean; issues: NavIssue[] }
