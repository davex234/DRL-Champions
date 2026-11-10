/**
 * LIVE ECOSYSTEM — POLÍTICA DE MERCADO.
 *
 * Decide automáticamente qué hacer con una carta nueva: ¿al mercado? ¿limitada?
 * ¿exclusiva? ¿imposible (solo se gana)? ¿en sobres? ¿en colección? Reglas por
 * familia + rareza (datos), no hardcode por jugador. PURO.
 */
import type { RarityTier } from "@/intel";

export interface MarketPolicy {
  toMarket: boolean;
  limited: boolean;
  exclusive: boolean;
  impossible: boolean;   // solo se consigue jugando (no sobres, no mercado)
  inPacks: boolean;
  inCollection: boolean;
  /** Peso relativo en el pool de sobres (0 = no sale). */
  packWeight: number;
}

const SPECIAL = ["mvp", "winner", "champion", "icon", "hall-of-fame", "mythic", "goat", "legend"];
const isSpecial = (family: string) => SPECIAL.some((s) => family.toLowerCase().includes(s));

export function decideMarket(family: string, tier: RarityTier): MarketPolicy {
  const base: MarketPolicy = { toMarket: true, limited: false, exclusive: false, impossible: false, inPacks: true, inCollection: true, packWeight: 0 };
  if (isSpecial(family) || tier === "mitica") {
    return { ...base, toMarket: false, limited: true, exclusive: true, impossible: true, inPacks: false, packWeight: 0 };
  }
  if (tier === "legendaria") return { ...base, limited: true, exclusive: true, packWeight: 1 };
  if (tier === "epica") return { ...base, limited: true, packWeight: 4 };
  if (tier === "rara") return { ...base, packWeight: 12 };
  return { ...base, packWeight: 28 }; // comun
}
