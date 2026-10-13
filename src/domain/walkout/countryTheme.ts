/**
 * PACK WALKOUT 0.3 · `CountryArenaTheme` (puro). La nacionalidad CANÓNICA del jugador viste la arena: pantallas LED con
 * su bandera, luces y franjas con SUS colores y el código del país. Nada se hace a mano por país: los colores salen de
 * los píxeles de la bandera real (`flagPalette`) y el código, de ISO 3166-1 alfa-3.
 *
 *   · país con bandera local → tema «country» (bandera + colores + ESP/JPN/USA…);
 *   · sin país, pero con región → tema «region» (claramente rotulado: «EMEA», con los colores de la edición);
 *   · nada → «neutral».
 * Sin símbolos culturales ni referencias inventadas: bandera, colores y gráficos competitivos.
 */
import { ISO3166_ALPHA3 } from "./iso3166";
import { ns, td } from "@/i18n/runtime";

const t = ns("walkout");


/** ISO 3166-1 alfa-2 → alfa-3 completo (0.4: cualquier nacionalidad, también las de cartas futuras). */
export const ISO3: Readonly<Record<string, string>> = ISO3166_ALPHA3;

export type FlagLayout = "horizontal" | "vertical" | "field";

export interface FlagPalette {
  /** Colores de la bandera por área («#rrggbb»), de 1 a 3, sin casi-duplicados. */
  colors: { hex: string; share: number }[];
  /** Cómo se reparten: franjas horizontales (ES, DE…), verticales (FR, IT…) o campo con emblema (JP, US, KR…). */
  layout: FlagLayout;
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Paleta de una bandera a partir de sus píxeles RGBA (rasterizada pequeña: 64×48 basta). Cuantiza, agrupa tonos casi
 * iguales (antialias, escudos), ordena por área y descubre si los colores van en franjas. Puro y determinista.
 */
export function flagPalette(rgba: ArrayLike<number>, w: number, h: number): FlagPalette {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const pix: number[][] = [];
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    if (a < 128) { pix.push([-1, -1, -1]); continue; }
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    pix.push([r, g, b]);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b; bins.set(key, e);
  }
  const total = pix.filter((p) => p[0] >= 0).length || 1;
  // agrupar tonos próximos (de mayor a menor área)
  const groups: { c: number[]; n: number }[] = [];
  for (const e of [...bins.values()].sort((a, b) => b.n - a.n)) {
    const c = [e.r / e.n, e.g / e.n, e.b / e.n];
    const g = groups.find((x) => dist(x.c, c) < 70);
    if (g) { const n = g.n + e.n; g.c = g.c.map((v, k) => (v * g.n + c[k] * e.n) / n); g.n = n; } else groups.push({ c, n: e.n });
  }
  const colors = groups.filter((g) => g.n / total >= 0.04).slice(0, 3).map((g) => ({ hex: hex(g.c[0], g.c[1], g.c[2]), share: +(g.n / total).toFixed(3), c: g.c }));
  // ¿franjas? cada fila (o columna) casi de un solo color del grupo dominante
  const nearest = (p: number[]) => (p[0] < 0 ? -1 : colors.reduce((best, x, i) => (dist(x.c, p) < dist(colors[best].c, p) ? i : best), 0));
  const uniform = (cells: number[][]) => { const c = new Map<number, number>(); cells.forEach((p) => c.set(nearest(p), (c.get(nearest(p)) ?? 0) + 1)); return Math.max(...c.values()) / cells.length >= 0.9; };
  let rows = 0, cols = 0;
  for (let y = 0; y < h; y++) if (uniform(pix.slice(y * w, y * w + w))) rows++;
  for (let x = 0; x < w; x++) if (uniform(Array.from({ length: h }, (_, y) => pix[y * w + x]))) cols++;
  const layout: FlagLayout = colors.length > 1 && rows / h >= 0.85 ? "horizontal" : colors.length > 1 && cols / w >= 0.85 ? "vertical" : "field";
  return { colors: colors.map(({ hex: x, share }) => ({ hex: x, share })), layout };
}

export interface ArenaCountryInput {
  /** País canónico del jugador (o el ajuste del panel DEV). */
  flag: { iso: string; src: string; name: string } | null;
  region: string | null;
  /** 0.4 · nacionalidad de la identidad: un país real SIN bandera en el juego luce su código y su nombre. */
  nationality?: { iso: string | null; name: string | null; code: string | null; status: string } | null;
}

export interface CountryArenaTheme {
  kind: "country" | "region" | "neutral";
  /** Lo que lucen los paneles: «ESP», «JPN», «USA»… o la región («EMEA»). */
  code: string;
  /** Nombre visible (país o región). */
  label: string;
  flagSrc: string | null;
  /** Colores para LED y luces (2–3): los de la bandera; si no hay país, los de la edición. */
  colors: string[];
  layout: FlagLayout;
}

const REGION_LABEL: Readonly<Record<string, string>> = { EMEA: "EMEA", Americas: "AMERICAS", AMERICAS: "AMERICAS", Pacific: "PACIFIC", PACIFIC: "PACIFIC", China: "CHINA", CHINA: "CHINA" };

/** Un color casi negro no sirve como luz: se sustituye por el siguiente o por un blanco frío. */
const usableLight = (h: string) => { const n = parseInt(h.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; return Math.max(r, g, b) > 60; };

/**
 * El tema de la arena para un jugador. `palette` llega cuando la bandera ya se ha rasterizado (en el navegador); hasta
 * entonces (o si falla) el tema de país usa los colores de la edición, pero sigue mostrando bandera y código.
 */
export function countryArenaTheme(input: ArenaCountryInput, palette: FlagPalette | null, edition: { light: string; accent: string }): CountryArenaTheme {
  const iso = input.flag?.iso?.toUpperCase() ?? "";
  if (input.flag && input.flag.src && /^[A-Z]{2}$/.test(iso)) {
    const fromFlag = (palette?.colors ?? []).map((c) => c.hex).filter(usableLight);
    const colors = fromFlag.length ? fromFlag : [edition.light, edition.accent];
    return { kind: "country", code: ISO3[iso] ?? iso, label: input.flag.name, flagSrc: input.flag.src, colors: colors.length === 1 ? [colors[0], "#f2f4f8"] : colors, layout: palette?.layout ?? "field" };
  }
  // país real del catálogo pero sin bandera local: su código y su nombre (nunca la bandera de otro país)
  const n = input.nationality;
  if (n?.status === "noflag" && n.code && n.name) return { kind: "country", code: n.code, label: n.name, flagSrc: null, colors: [edition.light, edition.accent], layout: "field" };
  const region = input.region ? REGION_LABEL[input.region] ?? input.region.toUpperCase() : null;
  if (region) return { kind: "region", code: region, label: t("Región {region}", { region: td(region) }), flagSrc: null, colors: [edition.light, edition.accent], layout: "field" };
  return { kind: "neutral", code: "", label: "", flagSrc: null, colors: [edition.light, edition.accent], layout: "field" };
}

/** Acento del equipo: el color más saturado del LOGO REAL (sus propios píxeles), o null (acento neutro). Nunca inventado. */
export function teamAccentFromLogo(palette: FlagPalette | null): string | null {
  if (!palette) return null;
  const sat = (h: string) => { const n = parseInt(h.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx < 50 ? 0 : (mx - mn) / mx; };
  const best = palette.colors.filter((c) => c.share >= 0.06).sort((a, b) => sat(b.hex) - sat(a.hex))[0];
  return best && sat(best.hex) >= 0.35 ? best.hex : null;
}
