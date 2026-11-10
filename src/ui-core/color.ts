/**
 * COLOR MATH (Render/UI Fase 1/7) — utilidades de color PURAS y DETERMINISTAS, sin dependencias.
 *
 * Base del Theme Engine: conversión hex↔hsl, aclarar/oscurecer, alfa, mezcla y ratio de contraste
 * (WCAG) para accesibilidad. Sin `Math.random`/`Date.now`. Todo acotado.
 */
const clamp = (n: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, n));
const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHex(s: string): boolean { return HEX.test(s); }

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => clamp255(v).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const H = ((h % 360) + 360) % 360 / 360, S = clamp(s / 100), L = clamp(l / 100);
  if (S === 0) { const v = L * 255; return { r: v, g: v, b: v }; }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const hue = (t: number): number => {
    let T = t; if (T < 0) T += 1; if (T > 1) T -= 1;
    if (T < 1 / 6) return p + (q - p) * 6 * T;
    if (T < 1 / 2) return q;
    if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
    return p;
  };
  return { r: hue(H + 1 / 3) * 255, g: hue(H) * 255, b: hue(H - 1 / 3) * 255 };
}

export const hexToHsl = (hex: string): HSL => rgbToHsl(hexToRgb(hex));
export const hslToHex = (hsl: HSL): string => rgbToHex(hslToRgb(hsl));

/** Aclara/oscurece por delta de luminosidad (−100..100). Determinista. */
export function adjustLightness(hex: string, deltaL: number): string {
  const c = hexToHsl(hex);
  return hslToHex({ ...c, l: clamp(c.l + deltaL, 0, 100) });
}
export const lighten = (hex: string, amt: number): string => adjustLightness(hex, amt);
export const darken = (hex: string, amt: number): string => adjustLightness(hex, -amt);

/** Ajusta la saturación (−100..100). */
export function saturate(hex: string, delta: number): string {
  const c = hexToHsl(hex);
  return hslToHex({ ...c, s: clamp(c.s + delta, 0, 100) });
}

/** Color rgba(...) a partir de un hex + alfa (0..1). */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${clamp(alpha)})`;
}

/** Mezcla lineal de dos colores (t=0 → a, t=1 → b). */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b), T = clamp(t);
  return rgbToHex({ r: A.r + (B.r - A.r) * T, g: A.g + (B.g - A.g) * T, b: A.b + (B.b - A.b) * T });
}

/** Luminancia relativa WCAG. */
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Ratio de contraste WCAG entre dos colores (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** ¿El par cumple contraste AA (4.5 texto normal, 3 texto grande)? */
export const meetsAA = (fg: string, bg: string, large = false): boolean => contrastRatio(fg, bg) >= (large ? 3 : 4.5);

/** Elige negro o blanco según el fondo (mejor contraste). */
export function readableOn(bg: string): string {
  return contrastRatio("#ffffff", bg) >= contrastRatio("#000000", bg) ? "#ffffff" : "#000000";
}
