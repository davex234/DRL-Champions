/**
 * UI CORE — vocabulario compartido (Render/UI Fase 1/7).
 *
 * Framework de PRESENTACIÓN puro y framework-agnóstico (sin React): resuelve tokens/temas/tipografía/
 * paleta/layout/componentes en VALORES concretos + variables CSS. NO implementa gameplay/lógica/estado
 * de juego: solo configuración visual. Determinista. Base única de TODA la UI futura.
 */
import type { RarityBucket } from "@/domain/packs/types";
import type { Density, RadiusToken, BorderToken, SizeToken, Breakpoint, ZToken } from "./tokens";

export type { Density, RadiusToken, BorderToken, SizeToken, Breakpoint, ZToken };

/** Versión del esquema persistible de configuración visual (migraciones/compat). */
export const UI_SCHEMA_VERSION = 1;

export type ThemeMode = "dark" | "light" | "auto";

/** Configuración de tema (SOLO visual; nunca gameplay/collection/online). Serializable. */
export interface ThemeConfig {
  version: number;
  mode: ThemeMode;
  /** Modo del sistema para resolver "auto" (lo pasa el borde; el motor es puro). */
  systemPrefersDark?: boolean;
  /** Color de acento (hex). */
  accent: string;
  density: Density;
  highContrast: boolean;
  reducedMotion: boolean;
  /** Transparencia de superficies (0 = opaco, 1 = máximo glass). */
  transparency: number;
  /** Desenfoque de fondo (px) para glassmorphism. */
  blur: number;
  /** Overrides de variables CSS para temas personalizados. */
  customVars?: Record<string, string>;
}

// ───────────────────────────── Paleta / tipografía resueltas ─────────────────────────────

export interface Palette {
  bg: string;
  /** Superficies por elevación (0..4). */
  surface: string[];
  border: string;
  borderStrong: string;
  overlay: string;
  text: { primary: string; secondary: string; muted: string; inverse: string; onAccent: string };
  accent: { base: string; hover: string; active: string; subtle: string; ring: string };
  state: { success: string; warning: string; danger: string; info: string; successSubtle: string; warningSubtle: string; dangerSubtle: string; infoSubtle: string };
  rarity: Record<RarityBucket, string>;
}

export interface ResolvedTypography {
  family: Record<"display" | "sans" | "mono", string>;
  size: Record<string, number>;
  weight: Record<string, number>;
  lineHeight: Record<string, number>;
  tracking: Record<string, string>;
}

export interface ResolvedTheme {
  /** Id determinista derivado de la config (para caché/comparación). */
  id: string;
  mode: "dark" | "light";
  highContrast: boolean;
  reducedMotion: boolean;
  density: Density;
  palette: Palette;
  typography: ResolvedTypography;
  spacing: Record<string, number>;
  radius: Record<RadiusToken, number>;
  border: Record<BorderToken, number>;
  shadow: Record<string, string>;
  size: Record<SizeToken, number>;
  motion: { duration: Record<string, number>; easing: Record<string, string> };
  breakpoints: Record<Breakpoint, number>;
  z: Record<ZToken, number>;
  blur: number;
  transparency: number;
}

// ───────────────────────────── Layout ─────────────────────────────

export type LayoutKind = "stack" | "row" | "grid" | "split" | "dock" | "sidebar" | "inspector" | "overlay" | "container" | "navhost";
export type Region = "main" | "left" | "right" | "top" | "bottom" | "center";

export interface LayoutNode {
  id: string;
  kind: LayoutKind;
  /** Dirección para stack/split (por defecto column en stack, row en split). */
  direction?: "row" | "column";
  /** Separación entre hijos (step de spacing). */
  gap?: number;
  /** Relleno interior (step de spacing). */
  padding?: number;
  /** Tamaño fijo (px) o ratio de reparto; "auto"/"fill". */
  size?: number | "auto" | "fill";
  min?: number;
  max?: number;
  /** Nº de columnas (grid). */
  columns?: number;
  region?: Region;
  /** Aplica las safe-areas del viewport a este nodo. */
  safeArea?: boolean;
  children?: LayoutNode[];
}

export interface SafeArea { top: number; right: number; bottom: number; left: number }
export interface Viewport { width: number; height: number; safe?: SafeArea }
export interface Rect { x: number; y: number; width: number; height: number }
export interface MeasuredNode { id: string; kind: LayoutKind; rect: Rect; region?: Region; children: MeasuredNode[] }

// ───────────────────────────── Componentes (contratos por tokens) ─────────────────────────────

export interface ComponentSpec {
  component: string;
  variant?: string;
  size?: SizeToken;
  state?: "default" | "hover" | "active" | "disabled" | "focus";
}
export interface ResolvedComponent {
  component: string;
  variant: string;
  size: SizeToken;
  state: string;
  /** Tokens de estilo resueltos (valores concretos que la capa React aplicará). */
  style: Record<string, string | number>;
}

// ───────────────────────────── Validación ─────────────────────────────

export interface ThemeIssue { code: string; message: string }
export interface ThemeValidation { ok: boolean; issues: ThemeIssue[]; contrast: { textPrimary: number; textSecondary: number; onAccent: number } }
