import type { Config } from "tailwindcss";
import {
  SURFACE, BORDER, TEXT, ACCENT, SEMANTIC, RARITY,
  RADIUS, ELEVATION, GLOW, DURATION, EASING, BREAKPOINT, CHROME,
} from "./src/design/tokens";

/**
 * Tailwind CONSUME el sistema de diseño (`src/design/tokens.ts`); no lo redefine.
 * Los nombres antiguos (`base-*`, `drl`, `rarity-*`) se conservan intactos: 36 pantallas
 * dependen de ellos y la Fase 9 no rompe nada de lo anterior.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      screens: {
        xs: `${BREAKPOINT.mobile}px`,
        "3xl": `${BREAKPOINT.wide}px`,
      },
      colors: {
        // — Paleta histórica (no se toca) —
        base: {
          900: SURFACE.canvas,
          800: SURFACE.base,
          700: SURFACE.raised,
          600: SURFACE.elevated,
          500: SURFACE.overlay,
        },
        drl: {
          DEFAULT: ACCENT.primary,
          glow: ACCENT.primaryGlow,
          cyan: ACCENT.cyan,
          gold: ACCENT.gold,
        },
        rarity: RARITY,

        // — Sistema de diseño Fase 9 —
        surface: SURFACE,
        ink: TEXT,
        edge: BORDER,
        ok: SEMANTIC.success,
        warn: SEMANTIC.warning,
        bad: SEMANTIC.danger,
      },
      borderColor: { DEFAULT: BORDER.DEFAULT },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      /*
       * Los radios del sistema se publican con nombres PROPIOS (`rounded-card`,
       * `rounded-panel`…) en lugar de sobrescribir `sm/md/lg/xl`. Sobrescribirlos
       * reflowaría en silencio las 36 pantallas —incluida la de duelo, revisada y
       * cerrada en la Fase 8.5—. Así la migración es explícita, componente a componente.
       */
      borderRadius: {
        chip: RADIUS.sm,
        control: RADIUS.md,
        card: RADIUS.lg,
        panel: RADIUS.xl,
        stage: RADIUS["2xl"],
      },
      /* La escala numérica de Tailwind ya es base-4 y respeta el rem: no se toca. */
      spacing: { topbar: `${CHROME.topBar}px`, mobilebar: `${CHROME.mobileBar}px` },
      letterSpacing: { label: "0.18em", wide2: "0.24em" },
      boxShadow: {
        // Históricos
        glow: GLOW.primary,
        "glow-gold": GLOW.gold,
        card: ELEVATION.lg,
        // Sistema
        e1: ELEVATION.sm,
        e2: ELEVATION.md,
        e3: ELEVATION.lg,
        e4: ELEVATION.xl,
        "glow-cyan": GLOW.cyan,
        "glow-ok": GLOW.success,
      },
      transitionTimingFunction: {
        out: EASING.out,
        smooth: EASING.inOut,
        spring: EASING.spring,
      },
      transitionDuration: {
        instant: `${DURATION.instant}ms`,
        fast: `${DURATION.fast}ms`,
        normal: `${DURATION.normal}ms`,
        slow: `${DURATION.slow}ms`,
      },
      keyframes: {
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-glow": {
          "0%,100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "sweep": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(120%)" },
        },
      },
      animation: {
        float: "float 4s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "rise-in": `rise-in ${DURATION.normal}ms ${EASING.out} both`,
        "fade-in": `fade-in ${DURATION.fast}ms ${EASING.out} both`,
        sweep: `sweep ${DURATION.slow}ms ${EASING.out}`,
      },
    },
  },
  plugins: [],
};

export default config;
