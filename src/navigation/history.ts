/**
 * HISTORY / BREADCRUMB / ANALYTICS (Render/UI Fase 2/7).
 *
 * Helpers puros sobre el historial de navegación: migas de pan, pantallas recientes, analítica y deep
 * links. Determinista. El historial es un sistema ÚNICO (no duplica el del navegador; el borde lo
 * sincroniza con Next si procede).
 */
import type { ScreenRegistry } from "./registry";
import type { NavState, Breadcrumb, NavAnalytics } from "./types";

const RECENT_MAX = 20;
const HISTORY_MAX = 200;

/** Migas de pan a partir del stack de pantallas actual. */
export function breadcrumb(registry: ScreenRegistry, state: NavState): Breadcrumb[] {
  return state.stack.map((s) => ({ screenId: s.screenId, title: registry.get(s.screenId)?.title ?? s.screenId, params: s.params }));
}

/** Última pantalla (activa) o null. */
export function lastScreen(state: NavState): string | null { return state.activeScreenId; }

/** Añade a "recientes" (sin duplicados consecutivos, acotado). */
export function pushRecent(recent: string[], screenId: string): string[] {
  return [screenId, ...recent.filter((s) => s !== screenId)].slice(0, RECENT_MAX);
}

/** Acota el historial (evita crecimiento ilimitado). */
export const capHistory = <T>(hist: T[]): T[] => (hist.length > HISTORY_MAX ? hist.slice(hist.length - HISTORY_MAX) : hist);

/** Analítica de navegación (proyección; no recalcula estado). */
export function analytics(state: NavState): NavAnalytics {
  return {
    totalScreens: state.stack.length,
    openWindows: Object.keys(state.windows).length,
    historyLength: state.history.length,
    historyIndex: state.historyIndex,
    recent: state.recent,
    depth: state.stack.length,
    visits: state.visits,
  };
}

/** Snapshot serializable del estado (para restaurar sesión / deep link). */
export function snapshot(state: NavState): NavState { return JSON.parse(JSON.stringify(state)); }
