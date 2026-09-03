/**
 * SISTEMA DE DISEÑO NEXUS — fuente ÚNICA de los valores visuales (Fase 9A).
 *
 * Antes de esta fase cada pantalla improvisaba: `rounded-xl` junto a `rounded-2xl`,
 * `bg-white/[0.03]` junto a `bg-base-700/30`, opacidades de texto en 40/45/50/55/60.
 * El resultado se leía como una web con tarjetas, no como un producto de esports.
 *
 * Aquí viven los valores. `tailwind.config.ts` los consume para generar las utilidades y
 * `globals.css` los publica como custom properties para lo que no puede ser una clase
 * (gradientes calculados, sombras compuestas, fondos por contexto). No hay una tercera copia.
 *
 * REGLA: ningún componente inventa un color, un radio o una duración. Si falta algo, se
 * añade aquí. Los nombres antiguos (`base-*`, `drl`, `rarity-*`) se CONSERVAN porque 36
 * pantallas dependen de ellos; esta capa los ordena y añade lo que faltaba.
 */

// ───────────────────────────── Color ─────────────────────────────

/** Fondos, del más profundo al más elevado. Un plano = un nivel, sin mezclar. */
export const SURFACE = {
  /** El lienzo de la aplicación. Nada va por debajo. */
  canvas: "#06070d",
  /** Superficie base de una sección. */
  base: "#0b0d18",
  /** Tarjeta o panel sobre la sección. */
  raised: "#11131f",
  /** Elemento elevado: menú abierto, diálogo, carta seleccionada. */
  elevated: "#171a2b",
  /** Máxima elevación: overlay a pantalla completa. */
  overlay: "#1f2336",
} as const;

/** Bordes. La opacidad codifica jerarquía, no capricho. */
export const BORDER = {
  /** Separador apenas perceptible. */
  subtle: "rgba(255,255,255,0.06)",
  /** Borde por defecto de una tarjeta. */
  DEFAULT: "rgba(255,255,255,0.10)",
  /** Elemento interactivo en reposo. */
  strong: "rgba(255,255,255,0.18)",
  /** Foco, hover o selección. */
  focus: "rgba(255,255,255,0.32)",
} as const;

/** Texto. Cuatro niveles, ni uno más. */
export const TEXT = {
  /** Titulares y cifras. */
  primary: "#eef1f8",
  /** Cuerpo. */
  secondary: "rgba(238,241,248,0.72)",
  /** Apoyo, descripciones. */
  muted: "rgba(238,241,248,0.48)",
  /** Etiquetas, unidades, metadatos. */
  faint: "rgba(238,241,248,0.30)",
} as const;

/** Acentos de marca. */
export const ACCENT = {
  /** Acción principal, identidad NEXUS. */
  primary: "#ff2e63",
  primaryGlow: "#ff5c8a",
  /** Acento secundario: información, competición en curso. */
  cyan: "#19e3ff",
  /** Acento terciario: logro, recompensa, rareza alta. */
  gold: "#ffd35c",
} as const;

/** Semántica. Es un eje INDEPENDIENTE del acento: nunca se usa `primary` para «error». */
export const SEMANTIC = {
  success: "#3fc07a",
  warning: "#ffb03d",
  danger: "#ff4d5e",
  info: "#19e3ff",
} as const;

/** Rareza de variante. Mismos valores que antes de la Fase 9: las cartas no cambian. */
export const RARITY = {
  bronze: "#cd7f32",
  silver: "#c8d2dc",
  gold: "#ffce4f",
  prime: "#7b5cff",
  winner: "#19e3ff",
  mvp: "#ff2e63",
  mastersMvp: "#ff8a3d",
  championsMvp: "#ffd35c",
  icon: "#f5f0e6",
} as const;

// ───────────────────────────── Forma y ritmo ─────────────────────────────

/**
 * Radios. Escala corta a propósito: cuanto mayor es el elemento, mayor el radio.
 * Un chip y un panel con el mismo radio es exactamente lo que hacía que esto
 * pareciera una web con tarjetas.
 */
export const RADIUS = {
  /** Chips, insignias, celdas pequeñas. */
  sm: "6px",
  /** Botones, campos. */
  md: "10px",
  /** Tarjetas. */
  lg: "16px",
  /** Paneles y secciones. */
  xl: "22px",
  /** Contenedores a pantalla completa. */
  "2xl": "28px",
  full: "9999px",
} as const;

/** Espaciado. Base 4, con los saltos que realmente se usan. */
export const SPACE = {
  px: "1px",
  0.5: "2px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
  20: "80px",
} as const;

/**
 * Tipografía. Dos familias con papeles distintos: `display` (Rajdhani, condensada,
 * técnica) para titulares, cifras y etiquetas; `sans` (Inter) para todo lo que se lee
 * en frases. Mezclarlas al azar es lo que hace que un producto parezca improvisado.
 */
export const TYPE = {
  /** Etiqueta en versalitas: seguida de `tracking-label`. */
  label: { size: "10px", height: "1.2", weight: "700", tracking: "0.18em" },
  caption: { size: "11px", height: "1.4", weight: "500", tracking: "0" },
  body: { size: "14px", height: "1.55", weight: "400", tracking: "0" },
  bodyLg: { size: "16px", height: "1.6", weight: "400", tracking: "0" },
  /** Titulares (familia display). */
  h3: { size: "20px", height: "1.2", weight: "700", tracking: "0.01em" },
  h2: { size: "28px", height: "1.12", weight: "700", tracking: "0.01em" },
  h1: { size: "40px", height: "1.05", weight: "700", tracking: "0.01em" },
  /** Cifra grande de marcador o cabecera. */
  display: { size: "64px", height: "0.95", weight: "700", tracking: "-0.01em" },
} as const;

// ───────────────────────────── Profundidad y movimiento ─────────────────────────────

/**
 * Elevación. Dos componentes: una sombra que asienta el elemento y, opcionalmente, un
 * halo de color. El halo NO sustituye a la sombra —sin sombra, el neón flota.
 */
export const ELEVATION = {
  none: "none",
  sm: "0 1px 2px rgba(0,0,0,0.4)",
  md: "0 6px 16px -4px rgba(0,0,0,0.55)",
  lg: "0 18px 50px -12px rgba(0,0,0,0.75)",
  xl: "0 32px 80px -20px rgba(0,0,0,0.85)",
} as const;

export const GLOW = {
  primary: "0 0 24px rgba(255,46,99,0.45)",
  cyan: "0 0 24px rgba(25,227,255,0.40)",
  gold: "0 0 32px rgba(255,211,92,0.50)",
  success: "0 0 24px rgba(63,192,122,0.40)",
} as const;

/**
 * Duraciones. Un producto de esports responde rápido: por encima de ~350 ms una
 * transición de interfaz se percibe como lentitud, no como elegancia. Las revelaciones
 * (abrir un sobre, resolver un turno) son la excepción y tienen su propia escala.
 */
export const DURATION = {
  /** Realimentación inmediata: hover, pulsación. */
  instant: 120,
  /** Transición normal de interfaz. */
  fast: 200,
  /** Entrada de un panel o cambio de pantalla. */
  normal: 320,
  /** Momento con intención dramática. */
  slow: 600,
  /** Revelación (sobres, resultado de duelo). */
  reveal: 1200,
} as const;

/** Curvas. `out` para lo que entra, `inOut` para lo que se mueve, `spring` para lo físico. */
export const EASING = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/** Puntos de ruptura. Coinciden con los que se verifican en 9J. */
export const BREAKPOINT = {
  mobile: 390,
  tablet: 768,
  laptop: 1024,
  desktop: 1440,
  wide: 1920,
} as const;

/** Altura de la barra superior. La usan el armazón y cualquier elemento pegajoso. */
export const CHROME = {
  topBar: 64,
  topBarCompact: 56,
  mobileBar: 64,
} as const;
