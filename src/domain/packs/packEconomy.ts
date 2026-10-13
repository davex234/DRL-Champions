/**
 * FASE 57.4 · ECONOMÍA DE LA LÍNEA PRINCIPAL — funciones PURAS, derivadas de lo que ya existe. No es un segundo sistema
 * de valoración:
 *
 *   · valor de una carta   → `marketValue` (domain/economy/pricing) y `salvageValue` (domain/economy/salvage);
 *   · probabilidades       → `mainPackPlan` (Pack Opening 3.0): ranuras normales + destacada e inclinación por OVR
 *                            dentro de la clase; el valor esperado se calcula EXACTO con `tierIdentity` (no por medias
 *                            uniformes de clase, que ya no son la probabilidad real);
 *   · precio y cartas      → `PackDef` (`data/packs`), la única fuente de precio (tienda y servidor leen `pack.price`).
 *
 * Distingue EV POR CARTA (Σ p_clase · valor medio de la clase) de EV POR SOBRE (× cartas del sobre). El coste de conseguir
 * una Prime/Icon usa la probabilidad POR SOBRE 1 − (1 − p)^n, no n·p.
 */
import type { CardDef } from "../cards/types";
import { marketValue } from "../economy/pricing";
import { salvageValue } from "../economy/salvage";
import { getPack } from "@/data/packs";
import { mainPackDistribution, mainPackPlan, ovrTiltWeight, packCardClass, PACK_CLASS_ORDER, MAIN_PACK_LINE, type PackCardClass } from "./packClass";
import { tierIdentity, type ClassPools } from "./tierIdentity";

export interface ValueStats { n: number; min: number; p25: number; median: number; mean: number; p75: number; p90: number; max: number }

export function classValueStats(values: number[]): ValueStats {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const n = s.length;
  return n === 0
    ? { n: 0, min: 0, p25: 0, median: 0, mean: 0, p75: 0, p90: 0, max: 0 }
    : { n, min: s[0], p25: q(0.25), median: q(0.5), mean: Math.round((s.reduce((a, b) => a + b, 0) / n) * 100) / 100, p75: q(0.75), p90: q(0.9), max: s[n - 1] };
}

export interface TopTierCost {
  /** Probabilidad por carta (0..1). */
  perCard: number;
  /** Probabilidad de al menos una en el sobre: 1 − (1 − p)^n. */
  pAtLeastOne: number;
  /** Sobres esperados hasta la primera (1 / pAtLeastOne). */
  expectedPacks: number;
  /** Créditos esperados hasta la primera (precio / pAtLeastOne). */
  expectedCost: number;
  /** Créditos por carta de esa clase, de media (precio / (n·p)). */
  costPerCard: number;
}

export interface PackEconomy {
  packId: string;
  price: number;
  cardCount: number;
  meanValueByClass: Record<PackCardClass, number>;
  evPerCard: number;
  evPerPack: number;
  /** EV por sobre / precio. */
  ratio: number;
  salvagePerPack: number;
  salvageRatio: number;
  topTier: { prime: TopTierCost; icon: TopTierCost; primeOrIcon: TopTierCost };
}

function topTier(price: number, n: number, p: number, pAtLeastOneExact?: number): TopTierCost {
  const pAtLeastOne = pAtLeastOneExact ?? 1 - Math.pow(1 - p, n);
  return {
    perCard: p, pAtLeastOne,
    expectedPacks: pAtLeastOne > 0 ? 1 / pAtLeastOne : Number.POSITIVE_INFINITY,
    expectedCost: pAtLeastOne > 0 ? price / pAtLeastOne : Number.POSITIVE_INFINITY,
    costPerCard: p > 0 ? price / (n * p) : Number.POSITIVE_INFINITY,
  };
}

/** Economía analítica de un sobre de la línea principal. `price` permite evaluar un precio candidato sin tocar datos. */
export function packEconomy(packId: string, cards: readonly CardDef[], price = getPack(packId)!.price): PackEconomy {
  const table = mainPackDistribution(packId);
  const plan = mainPackPlan(packId);
  const pack = getPack(packId);
  if (!table || !plan || !pack) throw new Error(`${packId} no es de la línea principal`);
  const pools = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, cards.filter((c) => packCardClass(c) === k)])) as Record<PackCardClass, CardDef[]>;
  // Valor medio de cada clase EN ESTE SOBRE: ponderado por la inclinación por OVR del sobre (λ = 0 → media simple).
  const mv = {} as Record<PackCardClass, number>;
  for (const k of PACK_CLASS_ORDER) {
    const cs = pools[k];
    const w = cs.map((c) => ovrTiltWeight(plan.ovrTilt, c.ovr));
    const tw = w.reduce((a, b) => a + b, 0);
    mv[k] = cs.length && tw > 0 ? cs.reduce((a, c, i) => a + w[i] * marketValue(c), 0) / tw : 0;
  }
  const n = pack.cardCount;
  const ev = tierIdentity(plan, pools as ClassPools, marketValue);
  const salv = tierIdentity(plan, pools as ClassPools, salvageValue);
  // Al menos una de una clase, exacto con ranuras: 1 − (1 − normal)^(n − 1) · (1 − destacada).
  const sumOf = (t: typeof plan.regular) => PACK_CLASS_ORDER.reduce((a, k) => a + t[k], 0) || 1;
  const atLeast = (ks: PackCardClass[]) => {
    const r = ks.reduce((a, k) => a + plan.regular[k], 0) / sumOf(plan.regular);
    const f = ks.reduce((a, k) => a + plan.featured[k], 0) / sumOf(plan.featured);
    return 1 - Math.pow(1 - r, n - 1) * (1 - f);
  };
  return {
    packId, price, cardCount: n, meanValueByClass: mv,
    evPerCard: ev.expectedValue / n, evPerPack: ev.expectedValue, ratio: ev.expectedValue / price,
    salvagePerPack: salv.expectedValue, salvageRatio: salv.expectedValue / price,
    topTier: {
      prime: topTier(price, n, table.prime / 100, atLeast(["prime"])),
      icon: topTier(price, n, table.icon / 100, atLeast(["icon"])),
      primeOrIcon: topTier(price, n, (table.prime + table.icon) / 100, atLeast(["prime", "icon"])),
    },
  };
}

/**
 * REGLA DE VALOR (F57.4). Métrica: EV por sobre / precio (`ratio`). Los cinco primeros deben caer dentro de una banda
 * alrededor de su MEDIANA; Icon puede quedar por debajo (prima de exclusividad) pero con un suelo relativo.
 *
 *   · banda de los cinco:   mediana × [1 − BAND, 1 + BAND]
 *   · Icon:                 ≥ ICON_FLOOR × mediana de los cinco, y ≤ el máximo de los cinco
 *
 * Devuelve los outliers (vacío = economía coherente).
 */
export const VALUE_BAND = 0.2;
export const ICON_FLOOR = 0.6;

export function economyOutliers(cards: readonly CardDef[], priceOf: (id: string) => number = (id) => getPack(id)!.price): string[] {
  const ratios = Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, packEconomy(id, cards, priceOf(id)).ratio]));
  const five = MAIN_PACK_LINE.filter((id) => id !== "icon");
  const sorted = five.map((id) => ratios[id]).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const out: string[] = [];
  for (const id of five) if (Math.abs(ratios[id] / median - 1) > VALUE_BAND) out.push(`${id}: ${ratios[id].toFixed(2)}× fuera de ±${VALUE_BAND * 100} % de la mediana ${median.toFixed(2)}×`);
  if (ratios.icon < ICON_FLOOR * median) out.push(`icon: ${ratios.icon.toFixed(2)}× < ${ICON_FLOOR} × mediana (${(ICON_FLOOR * median).toFixed(2)}×)`);
  if (ratios.icon > sorted[sorted.length - 1]) out.push(`icon: ${ratios.icon.toFixed(2)}× por encima de todos los demás (sin prima)`);
  return out;
}
