/**
 * UI ENGINE — orquestador del framework de presentación (Render/UI Fase 1/7).
 *
 * PURO y DETERMINISTA. Compone tema/paleta/tipografía/tokens/layout/componentes/iconos y cachea los
 * temas resueltos por `id` ⇒ 1000 pantallas comparten el mismo tema con coste O(1). NUNCA guarda
 * gameplay/collection/online/career/match: solo configuración visual. Framework-agnóstico (sin React).
 *
 *   Theme → Tokens → Primitives → Components → Layouts → (Pages/Features/Screens, en fases futuras)
 */
import { createTheme as make, resolveTheme, validateTheme, effectiveMode } from "./theme";
import { resolvePalette } from "./palette";
import { resolveTypography } from "./typography";
import { resolveSpacing as spacingOf, type Density } from "./tokens";
import { themeToCssVars } from "./cssvars";
import { buildLayout, measureLayout } from "./layout";
import { buildComponentTree, resolveComponent } from "./components";
import { resolveIcons } from "./icons";
import { migrateThemeConfig } from "./migrate";
import type {
  ThemeConfig, ResolvedTheme, Palette, ResolvedTypography, ComponentSpec, ResolvedComponent,
  LayoutNode, MeasuredNode, Viewport, ThemeValidation,
} from "./types";

export interface AppliedTheme { theme: ResolvedTheme; cssVars: Record<string, string> }

export class UIEngine {
  private cache = new Map<string, ResolvedTheme>();

  // ── Tema ──
  createTheme(over: Partial<ThemeConfig> = {}): ThemeConfig { return make(over); }
  loadTheme(raw: unknown): ThemeConfig { return migrateThemeConfig(raw); }
  validateTheme(config: ThemeConfig): ThemeValidation { return validateTheme(config); }

  /** Resuelve (cacheado por id determinista). */
  resolveTheme(config: ThemeConfig): ResolvedTheme {
    const t = resolveTheme(config);
    const hit = this.cache.get(t.id);
    if (hit) return hit;
    this.cache.set(t.id, t);
    return t;
  }

  /** Aplica: devuelve el tema resuelto + el mapa de variables CSS (el borde lo escribe en :root). */
  applyTheme(config: ThemeConfig): AppliedTheme {
    const theme = this.resolveTheme(config);
    return { theme, cssVars: themeToCssVars(theme) };
  }

  // ── Resolvers (FASE 7) ──
  resolvePalette(config: ThemeConfig): Palette { return resolvePalette(config, effectiveMode(config)); }
  resolveTypography(density: Density = "cozy"): ResolvedTypography { return resolveTypography(density); }
  resolveSpacing(step: number, density: Density = "cozy"): number { return spacingOf(step, density); }
  resolveTokens(config: ThemeConfig): Pick<ResolvedTheme, "spacing" | "radius" | "border" | "size" | "motion" | "breakpoints" | "z"> {
    const t = this.resolveTheme(config);
    return { spacing: t.spacing, radius: t.radius, border: t.border, size: t.size, motion: t.motion, breakpoints: t.breakpoints, z: t.z };
  }
  resolveIcons(names: string[]) { return resolveIcons(names); }

  // ── Layout ──
  buildLayout(node: LayoutNode): LayoutNode { return buildLayout(node); }
  measureLayout(node: LayoutNode, viewport: Viewport, config?: ThemeConfig): MeasuredNode {
    return measureLayout(node, viewport, config ? this.resolveTheme(config).spacing : {});
  }

  // ── Componentes ──
  buildComponentTree(specs: ComponentSpec[], config: ThemeConfig): ResolvedComponent[] { return buildComponentTree(specs, this.resolveTheme(config)); }
  resolveComponent(spec: ComponentSpec, config: ThemeConfig): ResolvedComponent { return resolveComponent(spec, this.resolveTheme(config)); }

  /** Limpia la caché de temas (test/hot-reload). */
  clearCache(): void { this.cache.clear(); }
  cacheSize(): number { return this.cache.size; }
}
