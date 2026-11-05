"use client";

/**
 * NAVIGATION STORE — el boundary del Navigation Engine (Render/UI Fase 2/7).
 *
 * Persiste ÚNICAMENTE el estado de navegación (stack/ventanas/historial/recientes) para restaurar la
 * sesión. NUNCA almacena gameplay/career/collection/marketplace/online/battle pass: eso vive en sus
 * motores. El `NavigationEngine` (puro) hace la lógica; aquí entran el reloj lógico (un contador
 * monótono, sin `Date.now`) y la persistencia. Versionado + migración.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { NavigationEngine, ScreenRegistry, migrateNavState, freshNavState, NAV_SCHEMA_VERSION, type NavState, type WindowKind, type GuardContext, type OpenWindowOptions } from "@/navigation";
import { SCREENS } from "@/data/screens";

/** Registro de pantallas compartido (infraestructura por datos; sin componentes). */
export const screenRegistry = new ScreenRegistry(SCREENS);

interface NavStore {
  nav: NavState;
  /** Reloj lógico monótono (determinista; no usa Date.now). */
  clock: number;

  navigate: (target: string, params?: Record<string, string>, guards?: GuardContext) => boolean;
  replace: (screenId: string, params?: Record<string, string>, guards?: GuardContext) => boolean;
  back: () => void;
  forward: () => void;
  reset: (screenId: string, params?: Record<string, string>) => void;
  openWindow: (kind: WindowKind, opts?: OpenWindowOptions) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  setLoading: (kind: "idle" | "blocking" | "background" | "skeleton", progress?: number) => void;
  showError: (kind: "offline" | "recoverable" | "fatal" | "maintenance" | "version_mismatch") => void;
  retry: () => void;
}

export const useNavStore = create<NavStore>()(
  persist(
    (set, get) => {
      const run = (fn: (e: NavigationEngine, at: number) => { ok: boolean; state: NavState }): boolean => {
        const s = get();
        const at = s.clock + 1;
        const engine = new NavigationEngine(screenRegistry, s.nav);
        const res = fn(engine, at);
        set({ nav: engine.snapshot(), clock: at });
        return res.ok;
      };
      return {
        nav: freshNavState(),
        clock: 0,
        navigate: (target, params = {}, guards = {}) => run((e, at) => e.navigate(target, params, guards, at)),
        replace: (screenId, params = {}, guards = {}) => run((e, at) => e.replace(screenId, params, guards, at)),
        back: () => { run((e, at) => e.back(at)); },
        forward: () => { run((e, at) => e.forward(at)); },
        reset: (screenId, params = {}) => { run((e, at) => e.reset(screenId, params, at)); },
        openWindow: (kind, opts = {}) => { run((e, at) => e.openWindowKind(kind, opts, at)); },
        closeWindow: (id) => { run((e, at) => e.closeWindowById(id, at)); },
        focusWindow: (id) => { run((e, at) => e.focusWindow(id, at)); },
        setLoading: (kind, progress = 0) => { run((e, at) => e.setLoading(kind, progress, at)); },
        showError: (kind) => { run((e, at) => e.showError(kind, at)); },
        retry: () => { run((e, at) => e.retry(at)); },
      };
    },
    {
      name: "drl-champions-nav",
      version: NAV_SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ nav: s.nav, clock: s.clock }),
      migrate: (persisted: unknown) => {
        const p = (persisted && typeof persisted === "object" ? persisted : {}) as { nav?: unknown; clock?: unknown };
        return { nav: migrateNavState(p.nav), clock: typeof p.clock === "number" ? p.clock : 0 } as Partial<NavStore>;
      },
    },
  ),
);
