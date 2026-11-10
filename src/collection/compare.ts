/**
 * CARD COMPARISON (Collection Fase 1/7).
 *
 * Compara dos cartas del registro (OVR/rareza/stats). Puro y determinista.
 *
 * Fase 37 · `compareCombat` es la comparación del producto: usa EXACTAMENTE las stats de combate del catálogo
 * (`CardDef.combat`, calculadas por `domain/cards/combat.ts`) y el OVR del catálogo. No recalcula nada y no declara
 * un ganador: una carta con más Entryfrag y menos Stronghold no es «mejor» sin contexto. `compareCards` (legado, stats
 * de origen) se conserva para quien ya lo usa.
 */
import type { CardRegistry } from "./registry";
import type { PlayerStats, CompareResult, CardDef } from "./types";
import { COMBAT_STAT_META, COMBAT_STAT_ORDER, type CombatStatKey } from "@/domain/cards/combat";

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

export interface CombatCompareRow {
  key: "ovr" | CombatStatKey;
  label: string;
  a: number;
  b: number;
  /** a − b. */
  delta: number;
  /** «+3», «−5» o «=» (signo tipográfico real). */
  deltaText: string;
  /** Frase accesible: «Stronghold: 71 frente a 68, 3 más». */
  sentence: string;
}

export interface CombatCompare {
  a: string;
  b: string;
  sameCard: boolean;
  samePlayer: boolean;
  rows: CombatCompareRow[];
}

export const deltaText = (d: number): string => (d === 0 ? "=" : d > 0 ? `+${d}` : `−${Math.abs(d)}`);

function row(key: CombatCompareRow["key"], label: string, a: number, b: number): CombatCompareRow {
  const delta = a - b;
  const how = delta === 0 ? "igual" : delta > 0 ? `${delta} más` : `${Math.abs(delta)} menos`;
  return { key, label, a, b, delta, deltaText: deltaText(delta), sentence: `${label}: ${a} frente a ${b}, ${how}` };
}

/** OVR + Stronghold/Gamesense/Entryfrag del catálogo. `null` si a alguna le faltan stats de combate. */
export function compareCombat(a: CardDef, b: CardDef): CombatCompare | null {
  if (!a.combat || !b.combat) return null;
  return {
    a: a.id, b: b.id, sameCard: a.id === b.id, samePlayer: a.playerId === b.playerId,
    rows: [
      row("ovr", "OVR", a.ovr, b.ovr),
      ...COMBAT_STAT_ORDER.map((k) => row(k, COMBAT_STAT_META[k].full, a.combat![k], b.combat![k])),
    ],
  };
}
