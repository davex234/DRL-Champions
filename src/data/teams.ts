import type { Region } from "@/domain/cards/types";

/**
 * Registro de equipos oficiales. El logo se resuelve a `/teams/{slug}.png`.
 * Añadir un equipo = añadir una entrada aquí (preparado para crecer).
 */
export interface TeamDef {
  /** Nombre completo (coincide con `Player.team`). */
  name: string;
  /** Etiqueta corta mostrada en la carta. */
  tag: string;
  /** Slug del archivo de logo: `/teams/{slug}.png`. */
  slug: string;
  region?: Region;
  /** Color de marca para el fallback (monograma) y acentos. */
  color: string;
}

export const TEAMS: Record<string, TeamDef> = {
  "Team Heretics": { name: "Team Heretics", tag: "TH", slug: "heretics", region: "EMEA", color: "#1a1a1a" },
  Fnatic: { name: "Fnatic", tag: "FNC", slug: "fnatic", region: "EMEA", color: "#ff5900" },
  "Team Liquid": { name: "Team Liquid", tag: "TL", slug: "liquid", region: "EMEA", color: "#0a1f44" },
  "Karmine Corp": { name: "Karmine Corp", tag: "KC", slug: "karmine", region: "EMEA", color: "#0a3cff" },
  NRG: { name: "NRG", tag: "NRG", slug: "nrg", region: "Americas", color: "#000000" },
  Sentinels: { name: "Sentinels", tag: "SEN", slug: "sentinels", region: "Americas", color: "#e0353b" },
  MIBR: { name: "MIBR", tag: "MIBR", slug: "mibr", region: "Americas", color: "#1f2a44" },
  "Gen.G": { name: "Gen.G", tag: "GENG", slug: "geng", region: "Pacific", color: "#aa8a4b" },
  DRX: { name: "DRX", tag: "DRX", slug: "drx", region: "Pacific", color: "#0a4bd6" },
  "EDward Gaming": { name: "EDward Gaming", tag: "EDG", slug: "edg", region: "China", color: "#111111" },
  "Shopify Rebellion": { name: "Shopify Rebellion", tag: "SR", slug: "shopify", region: "EMEA", color: "#5b8a3c" },
  "G2 Gozen": { name: "G2 Gozen", tag: "G2", slug: "g2", region: "Americas", color: "#111111" },
  "Leviatán": { name: "Leviatán", tag: "LEV", slug: "leviatan", region: "Americas", color: "#5a2d82" },

  // Equipos preparados para futuros jugadores (sin roster aún).
  "Paper Rex": { name: "Paper Rex", tag: "PRX", slug: "prx", region: "Pacific", color: "#ff3ea5" },
  "Natus Vincere": { name: "Natus Vincere", tag: "NAVI", slug: "navi", region: "EMEA", color: "#ffe500" },
  KOI: { name: "KOI", tag: "KOI", slug: "koi", region: "EMEA", color: "#1fb98c" },
};

export function getTeam(name: string): TeamDef | undefined {
  return TEAMS[name];
}

/** Slug del equipo (fallback: nombre normalizado). */
export function teamSlug(name: string): string {
  return TEAMS[name]?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
