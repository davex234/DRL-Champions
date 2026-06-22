import type { VariantDef, VariantId, RarityPalette } from "./types";

/** Paletas reutilizables por familia visual. */
const PALETTES = {
  bronze: {
    primary: "#cd7f32",
    secondary: "#e3a868",
    text: "#fff4e6",
    background: "linear-gradient(160deg,#5a3a18 0%,#8a5a28 50%,#3a2410 100%)",
  },
  silver: {
    primary: "#c8d2dc",
    secondary: "#ffffff",
    text: "#0b0d18",
    background: "linear-gradient(160deg,#aeb8c4 0%,#eef3f8 50%,#8b96a3 100%)",
  },
  gold: {
    primary: "#ffce4f",
    secondary: "#fff1b0",
    text: "#3a2c00",
    background: "linear-gradient(160deg,#b8860b 0%,#ffd95c 50%,#9c6f08 100%)",
  },
  regional: {
    primary: "#19e3ff",
    secondary: "#a8f6ff",
    text: "#021b22",
    background: "linear-gradient(160deg,#0a3d4a 0%,#16c2db 50%,#062a33 100%)",
  },
  winner: {
    primary: "#37e6a0",
    secondary: "#c5ffe8",
    text: "#02241a",
    background: "linear-gradient(160deg,#0b4a32 0%,#2fd994 50%,#073322 100%)",
  },
  mvp: {
    primary: "#ff2e63",
    secondary: "#ff9ab6",
    text: "#2a0010",
    background: "linear-gradient(160deg,#5a0a23 0%,#ff2e63 50%,#3a0518 100%)",
  },
  cinematic: {
    primary: "#ff8a3d",
    secondary: "#ffd0a8",
    text: "#2a1402",
    background: "linear-gradient(160deg,#6e2c08 0%,#ff8a3d 50%,#4a1c04 100%)",
  },
  legendary: {
    primary: "#ffd35c",
    secondary: "#fff6d6",
    text: "#2a2200",
    background:
      "linear-gradient(160deg,#7a5a00 0%,#ffd35c 45%,#fff6d6 60%,#5a4200 100%)",
  },
  prime: {
    primary: "#7b5cff",
    secondary: "#c9bcff",
    text: "#120526",
    background: "linear-gradient(160deg,#2a1066 0%,#7b5cff 50%,#1a0a40 100%)",
  },
  icon: {
    primary: "#f5f0e6",
    secondary: "#ffffff",
    text: "#1a1408",
    background:
      "linear-gradient(160deg,#2b2b2b 0%,#d9cfae 35%,#fffaf0 55%,#bfb38f 80%,#1a1a1a 100%)",
  },
} satisfies Record<string, RarityPalette>;

/**
 * Registro central de TODAS las variantes de carta del juego.
 * Añadir una edición nueva = añadir una entrada aquí. Nada más.
 */
export const VARIANTS: Record<VariantId, VariantDef> = {
  // ---- Base (el metal lo determina el OVR del jugador) ----
  bronze: { id: "bronze", label: "Bronce", group: "base", animation: "basic", rank: 1, statBoost: 0, serialized: false, palette: PALETTES.bronze },
  silver: { id: "silver", label: "Plata", group: "base", animation: "metallic", rank: 2, statBoost: 0, serialized: false, palette: PALETTES.silver },
  gold: { id: "gold", label: "Oro", group: "base", animation: "premium", rank: 3, statBoost: 0, serialized: false, palette: PALETTES.gold },

  // ---- Regionales ----
  emea: { id: "emea", label: "EMEA", group: "regional", animation: "premium", rank: 4, statBoost: 1, serialized: false, region: "EMEA", palette: PALETTES.regional },
  americas: { id: "americas", label: "Americas", group: "regional", animation: "premium", rank: 4, statBoost: 1, serialized: false, region: "Americas", palette: PALETTES.regional },
  pacific: { id: "pacific", label: "Pacific", group: "regional", animation: "premium", rank: 4, statBoost: 1, serialized: false, region: "Pacific", palette: PALETTES.regional },
  china: { id: "china", label: "China", group: "regional", animation: "premium", rank: 4, statBoost: 1, serialized: false, region: "China", palette: PALETTES.regional },

  // ---- Ganadores regionales ----
  "emea-winner": { id: "emea-winner", label: "EMEA Winner", group: "winner", animation: "winner", rank: 6, statBoost: 2, serialized: true, serialLimit: 500, region: "EMEA", palette: PALETTES.winner },
  "americas-winner": { id: "americas-winner", label: "Americas Winner", group: "winner", animation: "winner", rank: 6, statBoost: 2, serialized: true, serialLimit: 500, region: "Americas", palette: PALETTES.winner },
  "pacific-winner": { id: "pacific-winner", label: "Pacific Winner", group: "winner", animation: "winner", rank: 6, statBoost: 2, serialized: true, serialLimit: 500, region: "Pacific", palette: PALETTES.winner },
  "china-winner": { id: "china-winner", label: "China Winner", group: "winner", animation: "winner", rank: 6, statBoost: 2, serialized: true, serialLimit: 500, region: "China", palette: PALETTES.winner },

  // ---- MVP regionales ----
  "emea-mvp": { id: "emea-mvp", label: "EMEA MVP", group: "mvp", animation: "extended", rank: 7, statBoost: 3, serialized: true, serialLimit: 250, region: "EMEA", palette: PALETTES.mvp },
  "americas-mvp": { id: "americas-mvp", label: "Americas MVP", group: "mvp", animation: "extended", rank: 7, statBoost: 3, serialized: true, serialLimit: 250, region: "Americas", palette: PALETTES.mvp },
  "pacific-mvp": { id: "pacific-mvp", label: "Pacific MVP", group: "mvp", animation: "extended", rank: 7, statBoost: 3, serialized: true, serialLimit: 250, region: "Pacific", palette: PALETTES.mvp },
  "china-mvp": { id: "china-mvp", label: "China MVP", group: "mvp", animation: "extended", rank: 7, statBoost: 3, serialized: true, serialLimit: 250, region: "China", palette: PALETTES.mvp },

  // ---- Internacionales ----
  masters: { id: "masters", label: "Masters", group: "internacional", animation: "premium", rank: 5, statBoost: 1, serialized: false, palette: PALETTES.gold },
  "masters-winner": { id: "masters-winner", label: "Masters Winner", group: "internacional", animation: "winner", rank: 8, statBoost: 2, serialized: true, serialLimit: 300, palette: PALETTES.winner },
  "masters-mvp": { id: "masters-mvp", label: "Masters MVP", group: "internacional", animation: "cinematic", rank: 12, statBoost: 4, serialized: true, serialLimit: 150, palette: PALETTES.cinematic },
  champions: { id: "champions", label: "Champions", group: "internacional", animation: "premium", rank: 5, statBoost: 1, serialized: false, palette: PALETTES.gold },
  "champions-winner": { id: "champions-winner", label: "Champions Winner", group: "internacional", animation: "winner", rank: 9, statBoost: 3, serialized: true, serialLimit: 200, palette: PALETTES.winner },
  "champions-mvp": { id: "champions-mvp", label: "Champions MVP", group: "internacional", animation: "legendary", rank: 13, statBoost: 5, serialized: true, serialLimit: 100, palette: PALETTES.legendary },
  ewc: { id: "ewc", label: "EWC", group: "internacional", animation: "premium", rank: 5, statBoost: 1, serialized: false, palette: PALETTES.gold },
  "ewc-winner": { id: "ewc-winner", label: "EWC Winner", group: "internacional", animation: "winner", rank: 8, statBoost: 2, serialized: true, serialLimit: 300, palette: PALETTES.winner },
  "ewc-mvp": { id: "ewc-mvp", label: "EWC MVP", group: "internacional", animation: "cinematic", rank: 12, statBoost: 4, serialized: true, serialLimit: 150, palette: PALETTES.cinematic },

  // ---- Exclusivas ----
  prime: { id: "prime", label: "Prime", group: "exclusiva", animation: "special", rank: 10, statBoost: 4, serialized: true, serialLimit: 300, palette: PALETTES.prime },
  "game-changers": { id: "game-changers", label: "Game Changers", group: "exclusiva", animation: "extended", rank: 11, statBoost: 3, serialized: true, serialLimit: 250, palette: PALETTES.mvp },
  "icon-series": { id: "icon-series", label: "Icon Series", group: "exclusiva", animation: "icon", rank: 14, statBoost: 6, serialized: true, serialLimit: 100, palette: PALETTES.icon },
  "hall-of-fame": { id: "hall-of-fame", label: "Hall Of Fame", group: "exclusiva", animation: "legendary", rank: 15, statBoost: 6, serialized: true, serialLimit: 50, palette: PALETTES.legendary },
};

export const ALL_VARIANTS: VariantDef[] = Object.values(VARIANTS);

export function getVariant(id: VariantId): VariantDef {
  return VARIANTS[id];
}

/** Variante de metal base según el OVR del jugador (estilo FIFA). */
export function baseMetalForOvr(ovr: number): VariantId {
  if (ovr >= 83) return "gold";
  if (ovr >= 75) return "silver";
  return "bronze";
}
