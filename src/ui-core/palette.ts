/**
 * PALETTE (Render/UI Fase 1/7) — generación de paleta semántica, DETERMINISTA.
 *
 * A partir del modo (dark/light), acento y alto contraste produce superficies/textos/acento/estados.
 * Las semillas oscuras REUTILIZAN la paleta esports del proyecto (fuente única); el modo claro se
 * genera con color math. Puro.
 */
import { lighten, darken, mix, withAlpha, saturate, readableOn } from "./color";
import { RARITY_COLOR } from "./tokens";
import type { Palette, ThemeConfig } from "./types";

/** Semillas de superficie por modo (base esports del proyecto para dark). */
const SEED = {
  dark: { bg: "#06070d", surfaces: ["#0b0d18", "#11131f", "#171a2b", "#1f2336", "#272c44"], text: "#eef1f8" },
  light: { bg: "#eef1f7", surfaces: ["#ffffff", "#f4f6fb", "#e8ecf5", "#dde3ef", "#d0d8e8"], text: "#0b0d18" },
};

const STATE = { success: "#37e6a0", warning: "#ffce4f", danger: "#ff5c8a", info: "#19e3ff" };

export function resolvePalette(config: ThemeConfig, mode: "dark" | "light"): Palette {
  const seed = SEED[mode];
  const hc = config.highContrast;
  const accent = config.accent;

  const text = {
    primary: hc ? (mode === "dark" ? "#ffffff" : "#000000") : seed.text,
    secondary: mix(seed.text, seed.bg, hc ? 0.12 : 0.28),
    muted: mix(seed.text, seed.bg, hc ? 0.3 : 0.5),
    inverse: mode === "dark" ? "#0b0d18" : "#f4f6fb",
    onAccent: readableOn(accent),
  };

  const borderAlpha = hc ? 0.32 : 0.1;
  const white = mode === "dark" ? "#ffffff" : "#0b0d18";

  return {
    bg: seed.bg,
    surface: seed.surfaces,
    border: withAlpha(white, borderAlpha),
    borderStrong: withAlpha(white, borderAlpha * 2),
    overlay: withAlpha(mode === "dark" ? "#000000" : "#0b0d18", 0.6),
    text,
    accent: {
      base: hc ? saturate(accent, 15) : accent,
      hover: lighten(accent, 8),
      active: darken(accent, 8),
      subtle: withAlpha(accent, hc ? 0.28 : 0.16),
      ring: withAlpha(accent, 0.5),
    },
    state: {
      success: STATE.success, warning: STATE.warning, danger: STATE.danger, info: STATE.info,
      successSubtle: withAlpha(STATE.success, 0.16), warningSubtle: withAlpha(STATE.warning, 0.16),
      dangerSubtle: withAlpha(STATE.danger, 0.16), infoSubtle: withAlpha(STATE.info, 0.16),
    },
    rarity: { ...RARITY_COLOR },
  };
}
