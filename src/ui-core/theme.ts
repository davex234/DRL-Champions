/**
 * THEME (Render/UI Fase 1/7) — creación, resolución y validación de temas. PURO y DETERMINISTA.
 *
 * `createTheme` da una config con defaults; `resolveTheme` la convierte en valores concretos
 * (paleta/tipografía/spacing/sombras/motion…); `validateTheme` comprueba coherencia + contraste (AA).
 */
import { contrastRatio, isHex, withAlpha } from "./color";
import { resolvePalette } from "./palette";
import { resolveTypography } from "./typography";
import {
  RADIUS, BORDER_WIDTH, SIZE, DENSITY, MOTION, BREAKPOINTS, Z, SPACING_STEPS, resolveSpacing, resolveSize,
  type Density, type SizeToken,
} from "./tokens";
import { UI_SCHEMA_VERSION, type ThemeConfig, type ResolvedTheme, type Palette, type ThemeValidation, type ThemeIssue } from "./types";

/** Config de tema por defecto (esports oscuro del proyecto). */
export function defaultThemeConfig(over: Partial<ThemeConfig> = {}): ThemeConfig {
  return {
    version: UI_SCHEMA_VERSION,
    mode: "dark",
    accent: "#ff2e63",
    density: "cozy",
    highContrast: false,
    reducedMotion: false,
    transparency: 0.4,
    blur: 16,
    ...over,
  };
}

export const createTheme = (over: Partial<ThemeConfig> = {}): ThemeConfig => defaultThemeConfig(over);

/** Hash FNV-1a estable de la config (id determinista para caché). */
function themeId(config: ThemeConfig): string {
  const s = JSON.stringify(config);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `t_${(h >>> 0).toString(36)}`;
}

/** Modo efectivo resolviendo "auto" con la preferencia del sistema. */
export function effectiveMode(config: ThemeConfig): "dark" | "light" {
  if (config.mode === "auto") return config.systemPrefersDark === false ? "light" : "dark";
  return config.mode;
}

/** Sombras por elevación + glow/card, dependientes del modo y el acento. */
function resolveShadows(mode: "dark" | "light", palette: Palette): Record<string, string> {
  const k = mode === "dark" ? 0.75 : 0.22;
  const s = (y: number, blur: number, spread: number, a: number) => `0 ${y}px ${blur}px ${spread}px rgba(0,0,0,${(a * k).toFixed(3)})`;
  return {
    "0": "none",
    "1": s(2, 6, -2, 0.6),
    "2": s(6, 16, -4, 0.7),
    "3": s(12, 28, -6, 0.8),
    "4": s(18, 44, -10, 0.9),
    "5": s(28, 64, -14, 1),
    card: s(18, 50, -12, 1),
    glow: `0 0 24px ${withAlpha(palette.accent.base, 0.45)}`,
  };
}

/** Convierte una config en un tema resuelto con valores concretos. Determinista, cacheable por `id`. */
export function resolveTheme(config: ThemeConfig): ResolvedTheme {
  const mode = effectiveMode(config);
  const density: Density = config.density;
  const palette = resolvePalette(config, mode);
  const spacing: Record<string, number> = {};
  for (const step of SPACING_STEPS) spacing[String(step)] = resolveSpacing(step, density);
  const size = {} as Record<SizeToken, number>;
  for (const key of Object.keys(SIZE) as SizeToken[]) size[key] = resolveSize(key, density);
  const dur = config.reducedMotion
    ? Object.fromEntries(Object.keys(MOTION.duration).map((k) => [k, 0]))
    : { ...MOTION.duration };

  return {
    id: themeId(config),
    mode, highContrast: config.highContrast, reducedMotion: config.reducedMotion, density,
    palette, typography: resolveTypography(density),
    spacing, radius: { ...RADIUS }, border: { ...BORDER_WIDTH }, size,
    shadow: resolveShadows(mode, palette),
    motion: { duration: dur as Record<string, number>, easing: { ...MOTION.easing } },
    breakpoints: { ...BREAKPOINTS }, z: { ...Z },
    blur: Math.max(0, config.blur), transparency: Math.max(0, Math.min(1, config.transparency)),
  };
}

/** Valida coherencia + accesibilidad (contraste AA). No lanza; devuelve issues. */
export function validateTheme(config: ThemeConfig): ThemeValidation {
  const issues: ThemeIssue[] = [];
  if (!isHex(config.accent)) issues.push({ code: "BAD_ACCENT", message: "El acento no es un color hex válido" });
  if (config.transparency < 0 || config.transparency > 1) issues.push({ code: "BAD_TRANSPARENCY", message: "Transparencia fuera de [0,1]" });
  if (config.blur < 0 || !Number.isFinite(config.blur)) issues.push({ code: "BAD_BLUR", message: "Blur inválido" });
  if (!(config.density in DENSITY)) issues.push({ code: "BAD_DENSITY", message: "Densidad inválida" });

  const mode = effectiveMode(config);
  const p = resolvePalette(config, mode);
  const surface = p.surface[1];
  const contrast = {
    textPrimary: contrastRatio(p.text.primary, surface),
    textSecondary: contrastRatio(p.text.secondary, surface),
    onAccent: contrastRatio(p.text.onAccent, p.accent.base),
  };
  if (contrast.textPrimary < 4.5) issues.push({ code: "LOW_CONTRAST_PRIMARY", message: `Texto principal con contraste ${contrast.textPrimary} (<4.5 AA)` });
  if (contrast.onAccent < 3) issues.push({ code: "LOW_CONTRAST_ONACCENT", message: `Texto sobre acento con contraste ${contrast.onAccent} (<3)` });

  return { ok: issues.length === 0, issues, contrast };
}
