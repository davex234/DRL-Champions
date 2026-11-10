/**
 * MIGRACIÓN DEL ESTADO DE NAVEGACIÓN (Render/UI Fase 2/7).
 *
 * Normaliza un estado antiguo/corrupto (restauración de sesión) sin romper: sanea arrays/índices, fija
 * la versión. SOLO navegación (nunca gameplay). Determinista.
 */
import { freshNavState, freshLoading, NAV_SCHEMA_VERSION, type NavState, type ScreenInstance, type WindowInstance, type HistoryEntry } from "./types";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function migrateNavState(raw: unknown): NavState {
  if (!raw || typeof raw !== "object") return freshNavState();
  const r = raw as Partial<NavState>;
  const stack = arr<ScreenInstance>(r.stack).filter((s) => s && typeof s.screenId === "string");
  // Ventanas: acepta Record (esquema actual) o array (esquema antiguo) y sanea a Record.
  const windows: Record<string, WindowInstance> = {};
  const rawWins: WindowInstance[] = Array.isArray(r.windows) ? (r.windows as WindowInstance[]) : Object.values((r.windows as Record<string, WindowInstance>) ?? {});
  for (const w of rawWins) if (w && typeof w.id === "string" && typeof w.kind === "string" && typeof w.z === "number") windows[w.id] = w;
  const history = arr<HistoryEntry>(r.history).filter((h) => h && typeof h.screenId === "string");
  const historyIndex = typeof r.historyIndex === "number" ? Math.max(-1, Math.min(history.length - 1, Math.floor(r.historyIndex))) : history.length - 1;
  return {
    version: NAV_SCHEMA_VERSION,
    stack,
    activeScreenId: typeof r.activeScreenId === "string" ? r.activeScreenId : stack[stack.length - 1]?.screenId ?? null,
    windows,
    focusOrder: arr<string>(r.focusOrder).filter((id) => typeof id === "string" && windows[id]),
    focusedWindowId: typeof r.focusedWindowId === "string" && windows[r.focusedWindowId] ? r.focusedWindowId : null,
    perKind: r.perKind && typeof r.perKind === "object" ? (r.perKind as Record<string, number>) : {},
    history,
    historyIndex,
    recent: arr<string>(r.recent).filter((s) => typeof s === "string"),
    visits: r.visits && typeof r.visits === "object" ? (r.visits as Record<string, number>) : {},
    loading: r.loading && typeof r.loading === "object" ? (r.loading as NavState["loading"]) : freshLoading(),
    seq: typeof r.seq === "number" && r.seq >= 0 ? Math.floor(r.seq) : 0,
  };
}
