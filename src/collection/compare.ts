/**
 * CARD COMPARISON (Collection Fase 1/7).
 *
 * Compara dos cartas del registro (OVR/rareza/stats). Puro y determinista.
 */
import type { CardRegistry } from "./registry";
import type { PlayerStats, CompareResult } from "./types";

const STAT_KEYS: (keyof PlayerStats)[] = ["dmg", "scr", "com", "hs", "ast", "clu"];

export function compareCards(registry: CardRegistry, aId: string, bId: string): CompareResult | null {
  const a = registry.card(aId), b = registry.card(bId);
  if (!a || !b) return null;
  const va = registry.variant(a.variantId), vb = registry.variant(b.variantId);
  const statDeltas = {} as Record<keyof PlayerStats, number>;
  for (const k of STAT_KEYS) statDeltas[k] = a.stats[k] - b.stats[k];
  const ovrDelta = a.ovr - b.ovr;
  return {
    a: aId, b: bId, ovrDelta, rankDelta: va.rank - vb.rank, statDeltas,
    better: ovrDelta > 0 ? "a" : ovrDelta < 0 ? "b" : "equal",
  };
}
