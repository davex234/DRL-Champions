/**
 * DESIGN TOKENS (Render/UI Fase 1/7) — escalas base del Design System, 100% por DATOS.
 *
 * Nada de valores mágicos en los componentes: spacing/radius/borders/elevation/shadows/sizes/density/
 * motion/breakpoints/z se definen AQUÍ y se resuelven contra estas escalas. Puro. Sin dependencias.
 */
import type { RarityBucket } from "@/domain/packs/types";

/** Unidad base de espaciado (px). El resto de la escala deriva de ella × densidad. */
export const SPACE_UNIT = 4;

/** Escala de espaciado (steps → múltiplos de la unidad base). */
export const SPACING_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32] as const;
export type SpacingStep = (typeof SPACING_STEPS)[number];

/** Radios de esquina (px). */
export const RADIUS = { none: 0, sm: 4, md: 8, lg: 12, xl: 20, "2xl": 28, full: 9999 } as const;
export type RadiusToken = keyof typeof RADIUS;

/** Anchos de borde (px). */
export const BORDER_WIDTH = { none: 0, hairline: 1, thin: 1.5, base: 2, thick: 3 } as const;
export type BorderToken = keyof typeof BORDER_WIDTH;

/** Niveles de elevación (0..5) → nº de capa de sombra. */
export const ELEVATION = [0, 1, 2, 3, 4, 5] as const;
export type Elevation = (typeof ELEVATION)[number];

/** Alturas de control (px) por tamaño. */
export const SIZE = { xs: 24, sm: 32, md: 40, lg: 48, xl: 56 } as const;
export type SizeToken = keyof typeof SIZE;

/** Densidades → multiplicador de espaciado/tamaño. */
export const DENSITY = { compact: 0.85, cozy: 1, comfortable: 1.15 } as const;
export type Density = keyof typeof DENSITY;

/** Duraciones de movimiento (ms) y curvas. */
export const MOTION = {
  duration: { instant: 0, fast: 120, base: 200, slow: 320, slower: 480 },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.22, 1, 0.36, 1)",
    decelerate: "cubic-bezier(0, 0, 0.2, 1)",
    accelerate: "cubic-bezier(0.4, 0, 1, 1)",
  },
} as const;
export type DurationToken = keyof typeof MOTION.duration;
export type EasingToken = keyof typeof MOTION.easing;

/** Puntos de ruptura (ancho mínimo px). */
export const BREAKPOINTS = { xs: 0, sm: 480, md: 768, lg: 1024, xl: 1280, "2xl": 1536, ultrawide: 2200 } as const;
export type Breakpoint = keyof typeof BREAKPOINTS;

/** Capas de apilamiento (z-index). */
export const Z = { base: 0, dropdown: 1000, sticky: 1100, overlay: 1200, drawer: 1250, modal: 1300, toast: 1400, tooltip: 1500 } as const;
export type ZToken = keyof typeof Z;

/** Familias tipográficas (variables CSS existentes del proyecto — se reutilizan, no se duplican). */
export const FONT_FAMILY = {
  display: 'var(--font-display), "Rajdhani", system-ui, sans-serif',
  sans: 'var(--font-sans), "Inter", system-ui, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", "Consolas", monospace',
} as const;
export type FontFamily = keyof typeof FONT_FAMILY;

/** Escala tipográfica (px) + pesos + interlineado + tracking. */
export const FONT_SIZE = { xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24, "2xl": 30, "3xl": 38, "4xl": 48 } as const;
export type FontSizeToken = keyof typeof FONT_SIZE;
export const FONT_WEIGHT = { regular: 400, medium: 500, semibold: 600, bold: 700, black: 900 } as const;
export type FontWeightToken = keyof typeof FONT_WEIGHT;
export const LINE_HEIGHT = { tight: 1.1, snug: 1.25, normal: 1.5, relaxed: 1.7 } as const;
export const TRACKING = { tight: "-0.01em", normal: "0", wide: "0.02em", wider: "0.06em" } as const;

/** Colores por rareza (semilla del proyecto — fuente única). */
export const RARITY_COLOR: Record<RarityBucket, string> = {
  common: "#c8d2dc", uncommon: "#19e3ff", rare: "#7b5cff", epic: "#ff8a3d", legendary: "#ffd35c",
};

/**
 * Resuelve un step de espaciado a px, aplicando densidad. Determinista, O(1).
 * step fuera de escala se acota; permite steps arbitrarios (× unidad).
 */
export function resolveSpacing(step: number, density: Density = "cozy"): number {
  return Math.round(step * SPACE_UNIT * DENSITY[density]);
}

/** Resuelve una altura de control a px con densidad. */
export function resolveSize(size: SizeToken, density: Density = "cozy"): number {
  return Math.round(SIZE[size] * DENSITY[density]);
}
