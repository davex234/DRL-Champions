/**
 * NAVIGATION ENGINE — orquestador (Render/UI Fase 2/7).
 *
 * Máquina de estados PURA y DETERMINISTA de pantallas/ventanas/historial/carga. Cada operación recibe el
 * reloj lógico `at` (sin `Date.now`) y usa un contador interno para ids (sin `Math.random`). NUNCA guarda
 * gameplay/collection/online: solo navegación. Coordina la presentación; no la renderiza. O(1)/op con
 * índices; historial y recientes acotados. Depende de `@/ui-core` (z-order) y del registro de pantallas.
 *
 * Ops: navigate/replace/back/forward/push/pop/reset · openModal/closeModal/openDrawer/closeDrawer/
 * openOverlay/closeOverlay/openDialog/closeDialog · focusWindow/blurWindow · resolveRoute/validateNavigation.
 */
import type { ScreenRegistry } from "./registry";
import { validateNavigation, type GuardContext } from "./guards";
import { resolveZ, isOverlayKind } from "./windows";
import { pushRecent, capHistory, breadcrumb, analytics, snapshot } from "./history";
import { loadingOf, errorOf } from "./loading";
import {
  freshNavState, type NavState, type NavResult, type NavEvent, type NavEventType, type ScreenInstance,
  type WindowInstance, type WindowKind, type RouteMatch, type LoadingKind, type ErrorKind, type NavValidation,
} from "./types";

export interface OpenWindowOptions { screenId?: string; params?: Record<string, string>; fullscreen?: boolean; dismissable?: boolean }

export class NavigationEngine {
  private state: NavState;
  readonly registry: ScreenRegistry;

  constructor(registry: ScreenRegistry, state: NavState = freshNavState()) {
    this.registry = registry;
    this.state = state;
  }

  /** Estado VIVO (sin clonar: O(1)). El borde clona al persistir; `restore` aísla con una copia. */
  snapshot(): NavState { return this.state; }
  private id(prefix: string): string { return `${prefix}${this.state.seq++}`; }
  private ev(type: NavEventType, at: number, extra: Partial<NavEvent> = {}): NavEvent { return { type, at, ...extra }; }
  private ok(events: NavEvent[]): NavResult { return { ok: true, state: this.snapshot(), events }; }
  private fail(error: string, at: number, screenId?: string): NavResult { return { ok: false, error, state: this.snapshot(), events: [this.ev("blocked", at, { screenId, data: { error } })] }; }

  // ── Consulta ──
  active(): string | null { return this.state.activeScreenId; }
  stack(): ScreenInstance[] { return this.state.stack; }
  /** Ventanas abiertas ordenadas por z (ascendente). O(n log n) solo al consultar. */
  windows(): WindowInstance[] { return Object.values(this.state.windows).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1)); }
  focusedWindow(): string | null { return this.state.focusedWindowId; }
  breadcrumb() { return breadcrumb(this.registry, this.state); }
  analytics() { return analytics(this.state); }
  resolveRoute(path: string): RouteMatch | null { return this.registry.resolveRoute(path); }
  serialize(screenId: string, params?: Record<string, string>): string { return this.registry.serialize(screenId, params); }
  validate(screenId: string, guards: GuardContext = {}): NavValidation { return validateNavigation(this.registry, screenId, guards); }

  // ── Pantallas ──
  private mount(screenId: string, params: Record<string, string>, at: number): ScreenInstance {
    return { key: this.id("s"), screenId, params, lifecycle: "active", at };
  }
  private pauseActive(): void {
    const top = this.state.stack[this.state.stack.length - 1];
    if (top) top.lifecycle = "paused";
  }

  /** Navega a una ruta o pantalla (deep link acepta path). Trunca el historial "forward". */
  navigate(target: string, params: Record<string, string> = {}, guards: GuardContext = {}, at = 0): NavResult {
    const match = target.startsWith("/") ? this.registry.resolveRoute(target) : { screenId: target, params };
    if (!match) return this.fail(`Ruta no resoluble: ${target}`, at);
    const v = validateNavigation(this.registry, match.screenId, guards);
    if (!v.ok) return this.fail(v.issues.map((i) => i.message).join("; "), at, match.screenId);

    this.pauseActive();
    const inst = this.mount(match.screenId, match.params, at);
    this.state.stack.push(inst);
    this.state.activeScreenId = match.screenId;
    // Historial lineal (trunca forward).
    this.state.history = capHistory([...this.state.history.slice(0, this.state.historyIndex + 1), { screenId: match.screenId, params: match.params, at }]);
    this.state.historyIndex = this.state.history.length - 1;
    this.state.recent = pushRecent(this.state.recent, match.screenId);
    this.state.visits[match.screenId] = (this.state.visits[match.screenId] ?? 0) + 1;
    return this.ok([this.ev("navigate", at, { screenId: match.screenId })]);
  }

  push(screenId: string, params: Record<string, string> = {}, guards: GuardContext = {}, at = 0): NavResult { return this.navigate(screenId, params, guards, at); }

  /** Reemplaza la pantalla actual (sin crear entrada nueva de historial). */
  replace(screenId: string, params: Record<string, string> = {}, guards: GuardContext = {}, at = 0): NavResult {
    const v = validateNavigation(this.registry, screenId, guards);
    if (!v.ok) return this.fail(v.issues.map((i) => i.message).join("; "), at, screenId);
    const inst = this.mount(screenId, params, at);
    if (this.state.stack.length) this.state.stack[this.state.stack.length - 1] = inst;
    else this.state.stack.push(inst);
    this.state.activeScreenId = screenId;
    if (this.state.historyIndex >= 0) this.state.history[this.state.historyIndex] = { screenId, params, at };
    else { this.state.history = [{ screenId, params, at }]; this.state.historyIndex = 0; }
    this.state.visits[screenId] = (this.state.visits[screenId] ?? 0) + 1;
    return this.ok([this.ev("replace", at, { screenId })]);
  }

  /** Quita la pantalla superior del stack. */
  pop(at = 0): NavResult {
    if (this.state.stack.length <= 1) return this.fail("Nada que cerrar en el stack", at);
    const removed = this.state.stack.pop()!;
    removed.lifecycle = "unmounting";
    const top = this.state.stack[this.state.stack.length - 1];
    if (top) top.lifecycle = "active";
    this.state.activeScreenId = top?.screenId ?? null;
    if (this.state.historyIndex > 0) this.state.historyIndex--;
    return this.ok([this.ev("pop", at, { screenId: removed.screenId })]);
  }

  back(at = 0): NavResult {
    if (this.state.historyIndex <= 0) return this.fail("Sin historial anterior", at);
    this.state.historyIndex--;
    const entry = this.state.history[this.state.historyIndex];
    this.pauseActive();
    this.state.activeScreenId = entry.screenId;
    return this.ok([this.ev("back", at, { screenId: entry.screenId })]);
  }

  forward(at = 0): NavResult {
    if (this.state.historyIndex >= this.state.history.length - 1) return this.fail("Sin historial siguiente", at);
    this.state.historyIndex++;
    const entry = this.state.history[this.state.historyIndex];
    this.state.activeScreenId = entry.screenId;
    return this.ok([this.ev("forward", at, { screenId: entry.screenId })]);
  }

  /** Reinicia la navegación con una sola pantalla raíz. */
  reset(screenId: string, params: Record<string, string> = {}, at = 0): NavResult {
    const inst = this.mount(screenId, params, at);
    this.state.stack = [inst];
    this.state.activeScreenId = screenId;
    this.state.history = [{ screenId, params, at }];
    this.state.historyIndex = 0;
    this.state.recent = pushRecent(this.state.recent, screenId);
    this.state.visits[screenId] = (this.state.visits[screenId] ?? 0) + 1;
    return this.ok([this.ev("reset", at, { screenId })]);
  }

  // ── Ventanas (Record indexado ⇒ O(1) abrir/cerrar/enfocar) ──
  /** Enfoca la ventana overlay viva más reciente del stack de foco (limpieza perezosa de obsoletos). */
  private refocusTop(): void {
    const order = this.state.focusOrder;
    while (order.length) {
      const id = order[order.length - 1];
      const w = this.state.windows[id];
      if (w && isOverlayKind(w.kind)) { this.state.focusedWindowId = id; w.focused = true; return; }
      order.pop(); // obsoleto (cerrado o no-overlay): se descarta
    }
    this.state.focusedWindowId = null;
  }
  private openWindow(kind: WindowKind, opts: OpenWindowOptions, at: number): NavResult {
    const order = (this.state.perKind[kind] = (this.state.perKind[kind] ?? 0) + 1);
    const w: WindowInstance = {
      id: this.id("w"), kind, screenId: opts.screenId, params: opts.params, z: resolveZ(kind, order),
      focused: false, fullscreen: opts.fullscreen, dismissable: opts.dismissable ?? true, openedAt: at,
    };
    this.state.windows[w.id] = w;
    if (isOverlayKind(kind)) {
      const prev = this.state.focusedWindowId ? this.state.windows[this.state.focusedWindowId] : undefined;
      if (prev) prev.focused = false;
      w.focused = true;
      this.state.focusOrder.push(w.id);
      this.state.focusedWindowId = w.id;
    }
    return this.ok([this.ev("window_open", at, { windowId: w.id, screenId: opts.screenId, data: { kind } })]);
  }
  private closeWindow(id: string, at: number): NavResult {
    const removed = this.state.windows[id];
    if (!removed) return this.fail(`Ventana inexistente: ${id}`, at);
    delete this.state.windows[id];
    if (this.state.focusedWindowId === id) this.refocusTop();
    return this.ok([this.ev("window_close", at, { windowId: id, data: { kind: removed.kind } })]);
  }
  private closeTopOfKind(kind: WindowKind, at: number): NavResult {
    let top: WindowInstance | undefined;
    for (const w of Object.values(this.state.windows)) if (w.kind === kind && (!top || w.z > top.z)) top = w;
    return top ? this.closeWindow(top.id, at) : this.fail(`No hay ventana ${kind} abierta`, at);
  }

  openModal(opts: OpenWindowOptions, at = 0): NavResult { return this.openWindow("modal", opts, at); }
  closeModal(at = 0, id?: string): NavResult { return id ? this.closeWindow(id, at) : this.closeTopOfKind("modal", at); }
  openDrawer(opts: OpenWindowOptions, at = 0): NavResult { return this.openWindow("drawer", opts, at); }
  closeDrawer(at = 0, id?: string): NavResult { return id ? this.closeWindow(id, at) : this.closeTopOfKind("drawer", at); }
  openOverlay(opts: OpenWindowOptions, at = 0): NavResult { return this.openWindow("overlay", opts, at); }
  closeOverlay(at = 0, id?: string): NavResult { return id ? this.closeWindow(id, at) : this.closeTopOfKind("overlay", at); }
  openDialog(opts: OpenWindowOptions, at = 0): NavResult { return this.openWindow("dialog", opts, at); }
  closeDialog(at = 0, id?: string): NavResult { return id ? this.closeWindow(id, at) : this.closeTopOfKind("dialog", at); }
  openWindowKind(kind: WindowKind, opts: OpenWindowOptions, at = 0): NavResult { return this.openWindow(kind, opts, at); }
  closeWindowById(id: string, at = 0): NavResult { return this.closeWindow(id, at); }
  /** Cierra TODAS las ventanas (p. ej. al navegar de pantalla). */
  closeAllWindows(at = 0): NavResult {
    const ids = Object.keys(this.state.windows);
    this.state.windows = {};
    this.state.focusOrder = [];
    this.state.focusedWindowId = null;
    return this.ok(ids.map((id) => this.ev("window_close", at, { windowId: id })));
  }

  focusWindow(id: string, at = 0): NavResult {
    const w = this.state.windows[id];
    if (!w) return this.fail(`Ventana inexistente: ${id}`, at);
    const prev = this.state.focusedWindowId ? this.state.windows[this.state.focusedWindowId] : undefined;
    if (prev && prev.id !== id) prev.focused = false;
    w.focused = true;
    this.state.perKind[w.kind] = (this.state.perKind[w.kind] ?? 0) + 1;
    w.z = resolveZ(w.kind, this.state.perKind[w.kind]); // sube por encima de sus hermanas
    this.state.focusOrder.push(id);
    this.state.focusedWindowId = id;
    return this.ok([this.ev("window_focus", at, { windowId: id })]);
  }
  blurWindow(id: string, at = 0): NavResult {
    const w = this.state.windows[id];
    if (!w) return this.fail(`Ventana inexistente: ${id}`, at);
    w.focused = false;
    if (this.state.focusedWindowId === id) this.refocusTop();
    return this.ok([this.ev("window_blur", at, { windowId: id })]);
  }

  // ── Carga / errores ──
  setLoading(kind: LoadingKind, progress = 0, at = 0, message?: string): NavResult {
    this.state.loading = loadingOf(kind, progress, message);
    return this.ok([this.ev("loading_changed", at, { data: { kind, progress } })]);
  }
  showError(kind: ErrorKind, at = 0, message?: string): NavResult {
    this.state.loading = errorOf(kind, message);
    return this.ok([this.ev("error_shown", at, { data: { kind } })]);
  }
  retry(at = 0): NavResult {
    if (!this.state.loading.retryable) return this.fail("Error no reintentable", at);
    this.state.loading = loadingOf("blocking", 0);
    return this.ok([this.ev("loading_changed", at, { data: { retry: true } })]);
  }
  clearLoading(at = 0): NavResult { this.state.loading = loadingOf("idle", 0); return this.ok([this.ev("loading_changed", at, { data: { idle: true } })]); }

  // ── Restauración de sesión / deep link ──
  restore(state: NavState, at = 0): NavResult { this.state = snapshot(state); return this.ok([this.ev("restored", at)]); }
}
