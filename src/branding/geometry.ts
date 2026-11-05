/**
 * DRL CHAMPIONS — SISTEMA DE MARCA (fuente única de geometría).
 *
 * "The Apex Crest": escudo angular (autoridad/organización) con una CORONA de 3 picos
 * en plata (campeones/liderazgo) que se funde en una HOJA magenta descendente hacia el
 * vértice (precisión/tensión). Más un alfabeto geométrico EXCLUSIVO para el wordmark.
 *
 * TODO es vector paramétrico: este archivo alimenta los SVG, el componente React y el
 * rasterizador PNG (favicon/app icons) → la marca es idéntica en todas partes.
 * Sin gráficos externos, sin fuentes externas, sin dependencias.
 */

export type Pt = [number, number];

/** Paleta oficial. */
export const PALETTE = {
  black: "#06070d",
  graphite: "#11131f",
  graphiteHi: "#222637",
  steel: "#2b3142",
  silver: "#e8eef5",
  silverLo: "#aab4c4",
  darkRed: "#7b1733",
  magenta: "#ff2e63",
  magentaHi: "#ff5c8a",
  white: "#ffffff",
} as const;

// ---------------------------------------------------------------------------
// LA MARCA — polígonos en un lienzo 0..256 (centro 128). Silueta = escudo.
// ---------------------------------------------------------------------------
/** Escudo exterior (cresta angular: hombros cortados + vértice inferior). */
export const SHIELD_OUTER: Pt[] = [
  [60, 38], [196, 38], [214, 72], [214, 150], [128, 228], [42, 150], [42, 72],
];
/** Cara interior (bisel): el mismo escudo, inset. */
export const SHIELD_INNER: Pt[] = [
  [70, 50], [186, 50], [202, 77], [202, 147], [128, 212], [54, 147], [54, 77],
];
/** Corona de 3 picos + hoja descendente (la "lanza de mando"). Pico central más alto. */
export const CREST: Pt[] = [
  [128, 70],   // pico central (liderazgo)
  [149, 103],  // valle derecho
  [170, 88],   // pico derecho
  [177, 138],  // hombro derecho
  [128, 198],  // vértice de la hoja (hacia el punto del escudo)
  [79, 138],   // hombro izquierdo
  [86, 88],    // pico izquierdo
  [107, 103],  // valle izquierdo
];
/** Hoja inferior (se pinta en magenta sobre la corona plateada). */
export const BLADE: Pt[] = [
  [79, 138], [177, 138], [128, 198],
];
/** Filo diagonal (corte de velocidad, ADN esports) sobre el escudo. */
export const SLASH: Pt[] = [
  [42, 132], [214, 96], [214, 110], [42, 146],
];

// ---------------------------------------------------------------------------
// Utilidades de geometría
// ---------------------------------------------------------------------------
export const ptsToPath = (pts: Pt[]): string =>
  pts.map((p, i) => `${i === 0 ? "M" : "L"}${round(p[0])} ${round(p[1])}`).join(" ") + " Z";

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const round = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// ALFABETO GEOMÉTRICO EXCLUSIVO (stencil ancho, mayúsculas, trazo a inglete).
// Centerlines en celda 0..64 × 0..100. Se renderizan con stroke. Sólo las letras
// necesarias para "DRL CHAMPIONS". 100% original (no es ninguna fuente existente).
// ---------------------------------------------------------------------------
interface Glyph { p: Pt[][]; a: number } // polilíneas + avance

const G: Record<string, Glyph> = {
  D: { a: 64, p: [[[10, 14], [40, 14], [54, 30], [54, 70], [40, 86], [10, 86], [10, 14]]] },
  R: { a: 64, p: [[[10, 86], [10, 14], [44, 14], [54, 24], [54, 40], [44, 50], [10, 50]], [[30, 50], [54, 86]]] },
  L: { a: 58, p: [[[10, 14], [10, 86], [52, 86]]] },
  C: { a: 64, p: [[[54, 24], [42, 14], [22, 14], [10, 28], [10, 72], [22, 86], [42, 86], [54, 76]]] },
  H: { a: 64, p: [[[10, 14], [10, 86]], [[54, 14], [54, 86]], [[10, 50], [54, 50]]] },
  A: { a: 64, p: [[[10, 86], [32, 14], [54, 86]], [[19, 60], [45, 60]]] },
  M: { a: 72, p: [[[10, 86], [10, 14], [36, 56], [62, 14], [62, 86]]] },
  P: { a: 62, p: [[[10, 86], [10, 14], [44, 14], [54, 26], [54, 44], [44, 54], [10, 54]]] },
  I: { a: 30, p: [[[15, 14], [15, 86]]] },
  O: { a: 66, p: [[[10, 30], [24, 14], [42, 14], [56, 30], [56, 70], [42, 86], [24, 86], [10, 70], [10, 30]]] },
  N: { a: 64, p: [[[10, 86], [10, 14], [54, 86], [54, 14]]] },
  S: { a: 62, p: [[[54, 24], [42, 14], [22, 14], [10, 26], [10, 40], [20, 50], [44, 50], [54, 62], [54, 74], [42, 86], [22, 86], [10, 76]]] },
  " ": { a: 30, p: [] },
};

/** Segmentos absolutos de un texto (para rasterizar el wordmark a PNG). */
export function wordSegments(text: string, tracking = 10): { segs: [Pt, Pt][]; width: number } {
  let cursor = 0;
  const segs: [Pt, Pt][] = [];
  for (const ch of text.toUpperCase()) {
    const g = G[ch] ?? G[" "];
    for (const line of g.p) {
      for (let i = 1; i < line.length; i++) {
        segs.push([[line[i - 1][0] + cursor, line[i - 1][1]], [line[i][0] + cursor, line[i][1]]]);
      }
    }
    cursor += g.a + tracking;
  }
  return { segs, width: cursor - tracking };
}

/** Construye el `d` de un texto + su ancho total (en unidades de celda). */
export function wordPath(text: string, tracking = 10): { d: string; width: number } {
  let cursor = 0;
  const parts: string[] = [];
  for (const ch of text.toUpperCase()) {
    const g = G[ch] ?? G[" "];
    for (const line of g.p) {
      parts.push(line.map((p, i) => `${i === 0 ? "M" : "L"}${round(p[0] + cursor)} ${round(p[1])}`).join(" "));
    }
    cursor += g.a + tracking;
  }
  return { d: parts.join(" "), width: cursor - tracking };
}

// ---------------------------------------------------------------------------
// CONSTRUCTORES SVG (string) — fuente única para archivos y React.
// ---------------------------------------------------------------------------
export type MarkVariant = "color" | "mono" | "negative" | "light";

/** Defs + formas de la MARCA (sin el <svg> exterior). `id` evita colisión de gradientes. */
export function markInner(id: string, variant: MarkVariant = "color"): string {
  const P = PALETTE;
  if (variant === "mono" || variant === "negative") {
    const c = variant === "negative" ? P.white : P.silver;
    return `
      <path d="${ptsToPath(SHIELD_OUTER)}" fill="${c}" opacity="0.14"/>
      <path d="${ptsToPath(SHIELD_OUTER)}" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="miter"/>
      <path d="${ptsToPath(CREST)}" fill="${c}"/>`;
  }
  if (variant === "light") {
    return `
      <path d="${ptsToPath(SHIELD_OUTER)}" fill="${P.graphite}"/>
      <path d="${ptsToPath(SHIELD_INNER)}" fill="${P.graphiteHi}"/>
      <path d="${ptsToPath(CREST)}" fill="${P.steel}"/>
      <path d="${ptsToPath(BLADE)}" fill="${P.magenta}"/>`;
  }
  // color (por defecto)
  return `
    <defs>
      <linearGradient id="${id}-sh" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${P.graphiteHi}"/><stop offset="1" stop-color="${P.black}"/>
      </linearGradient>
      <linearGradient id="${id}-cr" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${P.white}"/><stop offset="1" stop-color="${P.silverLo}"/>
      </linearGradient>
      <linearGradient id="${id}-bl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${P.magentaHi}"/><stop offset="1" stop-color="${P.darkRed}"/>
      </linearGradient>
      <linearGradient id="${id}-sl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${P.magenta}" stop-opacity="0"/><stop offset="1" stop-color="${P.magentaHi}" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <path d="${ptsToPath(SHIELD_OUTER)}" fill="url(#${id}-sh)"/>
    <path d="${ptsToPath(SHIELD_OUTER)}" fill="none" stroke="${P.steel}" stroke-width="3"/>
    <path d="${ptsToPath(SHIELD_INNER)}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="2"/>
    <path d="${ptsToPath(SLASH)}" fill="url(#${id}-sl)"/>
    <path d="${ptsToPath(CREST)}" fill="url(#${id}-cr)"/>
    <path d="${ptsToPath(BLADE)}" fill="url(#${id}-bl)"/>
    <path d="${ptsToPath(CREST)}" fill="none" stroke="${P.white}" stroke-opacity="0.5" stroke-width="1.4" stroke-linejoin="miter"/>`;
}

/** Wordmark como <path> (stroke). `cell`=px por celda de 100u; devuelve svg + ancho px. */
export function wordmarkPath(text: string, opts: { weight: number; color: string; tracking?: number }): { path: string; width: number } {
  const { d, width } = wordPath(text, opts.tracking ?? 10);
  return {
    path: `<path d="${d}" fill="none" stroke="${opts.color}" stroke-width="${opts.weight}" stroke-linecap="butt" stroke-linejoin="miter"/>`,
    width,
  };
}
