"use client";

/**
 * UI STORE — configuración VISUAL del usuario (Render/UI Fase 1/7).
 *
 * Persiste ÚNICAMENTE configuración de tema (modo/acento/densidad/contraste/movimiento/blur/
 * transparencia). NUNCA almacena gameplay/collection/online/career/match: eso vive en sus motores. El
 * `UIEngine` (puro) resuelve esta config en valores/variables CSS; el store solo la guarda. Versionado
 * + migración.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { UIEngine, defaultThemeConfig, migrateThemeConfig, UI_SCHEMA_VERSION, type ThemeConfig, type ThemeMode, type Density } from "@/ui-core";

/** Motor de UI compartido (puro, con caché de temas). No guarda estado de juego. */
export const uiEngine = new UIEngine();

interface UiState {
  config: ThemeConfig;

  setMode: (mode: ThemeMode) => void;
  setSystemPrefersDark: (dark: boolean) => void;
  setAccent: (hex: string) => void;
  setDensity: (density: Density) => void;
  setHighContrast: (on: boolean) => void;
  setReducedMotion: (on: boolean) => void;
  setTransparency: (v: number) => void;
  setBlur: (px: number) => void;
  resetTheme: () => void;
}

const patch = (set: (fn: (s: UiState) => Partial<UiState>) => void, over: Partial<ThemeConfig>) =>
  set((s) => ({ config: { ...s.config, ...over } }));

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      config: defaultThemeConfig(),
      setMode: (mode) => patch(set, { mode }),
      setSystemPrefersDark: (systemPrefersDark) => patch(set, { systemPrefersDark }),
      setAccent: (accent) => patch(set, { accent }),
      setDensity: (density) => patch(set, { density }),
      setHighContrast: (highContrast) => patch(set, { highContrast }),
      setReducedMotion: (reducedMotion) => patch(set, { reducedMotion }),
      setTransparency: (transparency) => patch(set, { transparency: Math.max(0, Math.min(1, transparency)) }),
      setBlur: (blur) => patch(set, { blur: Math.max(0, blur) }),
      resetTheme: () => set({ config: defaultThemeConfig() }),
    }),
    {
      name: "drl-champions-ui",
      version: UI_SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ config: s.config }),
      migrate: (persisted: unknown) => ({ config: migrateThemeConfig((persisted as { config?: unknown })?.config) }),
    },
  ),
);
