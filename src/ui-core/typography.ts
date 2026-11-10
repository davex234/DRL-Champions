/**
 * TYPOGRAPHY (Render/UI Fase 1/7) — resolución de la escala tipográfica, DETERMINISTA.
 *
 * Reutiliza las variables de fuente del proyecto (`--font-display`/`--font-sans`) y la escala de tokens.
 * La densidad reduce/aumenta ligeramente los tamaños. Puro.
 */
import { FONT_FAMILY, FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT, TRACKING, DENSITY, type Density } from "./tokens";
import type { ResolvedTypography } from "./types";

export function resolveTypography(density: Density = "cozy"): ResolvedTypography {
  const mul = 0.94 + DENSITY[density] * 0.06; // densidad afecta suavemente al tamaño de fuente
  const size: Record<string, number> = {};
  for (const [k, v] of Object.entries(FONT_SIZE)) size[k] = Math.round(v * mul);
  return {
    family: { ...FONT_FAMILY },
    size,
    weight: { ...FONT_WEIGHT },
    lineHeight: { ...LINE_HEIGHT },
    tracking: { ...TRACKING },
  };
}
