import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import {
  SURFACE, BORDER, TEXT, ACCENT, SEMANTIC, RARITY,
  RADIUS, ELEVATION, GLOW, DURATION, EASING, BREAKPOINT, CHROME,
  CHAMFER, RECESSED, DEPTH, LAYER, TYPE, READOUT, SPACE, STROKE, FOCUS, DENSITY,
} from "./src/design/tokens";

/**
 * Tailwind CONSUME el sistema de diseño (`src/design/tokens.ts`); no lo redefine.
 * Los nombres antiguos (`base-*`, `drl`, `rarity-*`) se conservan intactos: 36 pantallas
 * dependen de ellos y la Fase 9 no rompe nada de lo anterior.
 *
 * ───────────────────────── FASE 3B · TOKENS CONSUMIBLES ─────────────────────────
 *
 * Media escala del sistema estaba DEFINIDA pero no expuesta: `CHAMFER`, `LAYER`, `TYPE`,
 * `READOUT`, `SPACE`, `DEPTH` y `RECESSED` tenían cero referencias aquí, así que una pantalla
 * que quisiera usarlas no tenía cómo — y escribía `z-[70]`, `text-[13px]` y una sombra a mano.
 * Un token que no se puede escribir en una clase no existe.
 *
 * Se exponen SIN duplicar un solo valor: todo sale del `import` de arriba. Lo que no encaja en
 * una utilidad de Tailwind (variables CSS, el chaflán por rol, el anillo de foco) lo publica el
 * plugin del final, que lee los MISMOS tokens.
 */
const px = (n: number): string => `${n}px`;

/** `TYPE` → escala de `fontSize` de Tailwind, con su interlineado, peso e interletrado. */
const TYPE_SCALE = Object.fromEntries(
  Object.entries(TYPE).map(([role, t]) => [
    role,
    [t.size, { lineHeight: t.height, letterSpacing: t.tracking, fontWeight: t.weight }],
  ]),
) as Record<string, [string, { lineHeight: string; letterSpacing: string; fontWeight: string }]>;

/** `READOUT` → `text-readout-md`. La cifra competitiva, por papel y no por tamaño. */
const READOUT_SCALE = Object.fromEntries(
  Object.entries(READOUT).map(([step, size]) => [`readout-${step}`, size]),
);
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
      /*
       * La escala numérica de Tailwind ya es base-4 y respeta el rem: no se toca — `SPACE`
       * publica exactamente los mismos pasos y sobrescribirlos solo cambiaría rem por px.
       * Lo que sí faltaba es el ritmo SEMÁNTICO: los dos modos de UI del sistema.
       */
      spacing: {
        topbar: `${CHROME.topBar}px`,
        mobilebar: `${CHROME.mobileBar}px`,
        gameplay: DENSITY.gameplay.gap,
        "gameplay-pad": DENSITY.gameplay.pad,
        management: DENSITY.management.gap,
        "management-pad": DENSITY.management.pad,
      },

      /** Tipografía por PAPEL (`text-body`, `text-h2`) y cifra por paso (`text-readout-lg`). */
      fontSize: { ...TYPE_SCALE, ...READOUT_SCALE },

      /** Grosor de canto semántico: separar / señalar / advertir. */
      borderWidth: STROKE,

      /** Jerarquía de capas. Sustituye a los `z-[60..100]` decididos por subasta. */
      zIndex: Object.fromEntries(Object.entries(LAYER).map(([k, v]) => [k, String(v)])),
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
        // Sistema: hueco (`shadow-recessed-md`), profundidad semántica (`shadow-object`) y foco.
        "recessed-sm": RECESSED.sm,
        "recessed-md": RECESSED.md,
        "recessed-lg": RECESSED.lg,
        subtle: DEPTH.subtle,
        surface: DEPTH.surface,
        object: DEPTH.object,
        impact: DEPTH.impact,
        focus: DEPTH.focus,
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
  plugins: [
    /**
     * PUBLICACIÓN DE TOKENS — lo que no cabe en una utilidad estándar.
     *
     * Tres cosas, y las tres leen los mismos tokens que el tema de arriba:
     *
     *  1. Las variables CSS (`--nx-space-*`, `--nx-chamfer-*`, `--nx-layer-*`…), para lo que
     *     se escribe en un `style` o en `globals.css` y no puede ser una clase.
     *  2. El chaflán POR ROL: `.nx-chamfer-plate` fija la variable que ya leen `.nx-clip` y
     *     `.nx-clip-sm`, así que el corte deja de escribirse a mano en cada componente.
     *  3. El anillo de foco del sistema, hacia DENTRO: una pieza con `clip-path` recorta
     *     cualquier anillo exterior, así que un foco por fuera sería invisible en la mitad
     *     del producto. Esta es la razón de que `.nx-focus` use sombras `inset`.
     */
    plugin(({ addBase, addUtilities }) => {
      const vars: Record<string, string> = {};
      /*
       * El punto NO es válido en el nombre de una custom property: `--nx-space-0.5` hace
       * fallar al parser de CSS de Next. El paso fraccionario de la escala se publica como
       * `--nx-space-0_5`. (Lo cazó el servidor de desarrollo, no el CLI de Tailwind.)
       */
      for (const [k, v] of Object.entries(SPACE)) vars[`--nx-space-${k.replace(".", "_")}`] = v;
      // Los cuatro niveles de tinta: `globals.css` solo publicaba el primario.
      for (const [k, v] of Object.entries(TEXT)) vars[`--nx-ink-${k}`] = v;
      for (const [k, v] of Object.entries(CHAMFER)) vars[`--nx-chamfer-${k}`] = v;
      for (const [k, v] of Object.entries(LAYER)) vars[`--nx-layer-${k}`] = String(v);
      for (const [k, v] of Object.entries(READOUT)) vars[`--nx-readout-${k}`] = v;
      for (const [k, v] of Object.entries(STROKE)) vars[`--nx-stroke-${k}`] = v;
      for (const [k, v] of Object.entries(RECESSED)) vars[`--nx-recessed-${k}`] = v;
      vars["--nx-focus-ring"] = FOCUS.ring;
      vars["--nx-focus-offset"] = FOCUS.offset;
      vars["--nx-focus-width"] = FOCUS.width;
      addBase({ ":root": vars });

      const chamfer = Object.fromEntries(
        Object.entries(CHAMFER).map(([role, value]) => [
          `.nx-chamfer-${role}`,
          { "--nx-chamfer": value, "--nx-chamfer-sm": value },
        ]),
      );
      const w = parseFloat(FOCUS.width);
      addUtilities({
        ...chamfer,
        ".nx-focus:focus-visible": {
          outline: "none",
          boxShadow: `inset 0 0 0 ${px(w)} ${FOCUS.ring}, inset 0 0 0 ${px(w * 2)} ${FOCUS.offset}`,
        },
      });
    }),
  ],
};

export default config;
