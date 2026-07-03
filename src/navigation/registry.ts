/**
 * SCREEN REGISTRY + ROUTE RESOLVER (Render/UI Fase 2/7).
 *
 * Registro de descriptores de pantalla (por datos) e índice de rutas para resolver paths ↔ pantallas
 * (deep links). Determinista: la resolución elige la ruta MÁS específica (menos params, más segmentos).
 * O(1) por id; O(rutas) por resolución (con orden precomputado).
 */
import type { ScreenDescriptor, RouteMatch } from "./types";

interface CompiledRoute { screenId: string; segments: string[]; specificity: number }

export class ScreenRegistry {
  private byId = new Map<string, ScreenDescriptor>();
  private routes: CompiledRoute[] = [];

  constructor(descriptors: ScreenDescriptor[] = []) { for (const d of descriptors) this.register(d); }

  register(d: ScreenDescriptor): void {
    this.byId.set(d.id, d);
    const segments = d.route.split("/").filter(Boolean);
    const params = segments.filter((s) => s.startsWith(":")).length;
    // Especificidad: más segmentos y menos params ⇒ más específica.
    this.routes.push({ screenId: d.id, segments, specificity: segments.length * 10 - params });
    this.routes.sort((a, b) => b.specificity - a.specificity || (a.screenId < b.screenId ? -1 : 1));
  }

  has(id: string): boolean { return this.byId.has(id); }
  get(id: string): ScreenDescriptor | undefined { return this.byId.get(id); }
  all(): ScreenDescriptor[] { return [...this.byId.values()]; }
  size(): number { return this.byId.size; }

  /** Resuelve un path a pantalla + params (deep link). null si no hay coincidencia. */
  resolveRoute(path: string): RouteMatch | null {
    const parts = path.split("?")[0].split("/").filter(Boolean);
    for (const r of this.routes) {
      if (r.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let match = true;
      for (let i = 0; i < r.segments.length; i++) {
        const seg = r.segments[i];
        if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) { match = false; break; }
      }
      if (match) return { screenId: r.screenId, params };
    }
    // Ruta raíz (todo vacío).
    if (parts.length === 0) { const root = this.routes.find((r) => r.segments.length === 0); if (root) return { screenId: root.screenId, params: {} }; }
    return null;
  }

  /** Construye el path de una pantalla + params (deep link inverso). Determinista. */
  serialize(screenId: string, params: Record<string, string> = {}): string {
    const d = this.byId.get(screenId);
    if (!d) return "/";
    const path = d.route.split("/").map((s) => (s.startsWith(":") ? encodeURIComponent(params[s.slice(1)] ?? "") : s)).join("/");
    return path || "/";
  }
}
