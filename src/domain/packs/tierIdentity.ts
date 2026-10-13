/**
 * PACK OPENING 3.0 · IDENTIDAD ESTADÍSTICA EXACTA de la línea principal (sin simular).
 *
 * El sorteo de un sobre de la línea (`openByClass`) es, por construcción, un producto de huecos INDEPENDIENTES: en cada
 * hueco, clase con la tabla de su ranura y carta con peso ∝ peso del pool × e^(−λ·(OVR − 70)). Por eso todo lo que la
 * ficha enseña y los tests fijan se calcula de forma EXACTA a partir de las mismas piezas que usa el servidor
 * (`mainPackPlan`, `ovrTiltWeight`, el pool de clases del sobre):
 *
 *   · probabilidad de cada carta en cada ranura;
 *   · P(mejor carta ≥ X) = 1 − Π_huecos P(hueco < X)  (y con ello los cuantiles exactos de la mejor carta);
 *   · P(≥ k cartas ≥ X): Poisson-binomial sobre los huecos (heterogéneos: normales y destacada);
 *   · valor esperado por sobre (lineal: Σ_huecos Σ_cartas p · valor).
 *
 * Puro: sin RNG, sin BD, sin reloj. El servidor no lo usa para decidir; lo usan la ficha pública, la economía analítica,
 * el panel y los tests de identidad. Si el motor cambia y esto no, `tierIdentity.test.ts` lo detecta (simulación
 * determinista del motor real frente a estos números).
 */
import type { CardDef } from "../cards/types";
import { ovrTiltWeight, PACK_CLASS_ORDER, type ClassTable, type MainPackPlan, type PackCardClass } from "./packClass";

export type ClassPools = Readonly<Record<PackCardClass, readonly CardDef[]>>;

/** Probabilidad de cada carta en un hueco con esa tabla (por mil) — clase × peso relativo dentro de la clase. */
export function slotCardProbabilities(table: ClassTable, pools: ClassPools, plan: Pick<MainPackPlan, "ovrTilt">, weightOf: (c: CardDef) => number = () => 1): Map<string, { card: CardDef; p: number }> {
  let total = 0;
  for (const k of PACK_CLASS_ORDER) total += Math.max(0, table[k]);
  const out = new Map<string, { card: CardDef; p: number }>();
  if (total <= 0) return out;
  for (const k of PACK_CLASS_ORDER) {
    const pk = Math.max(0, table[k]) / total;
    if (pk <= 0) continue;
    const cards = pools[k];
    let w = 0;
    const ws = cards.map((c) => { const x = Math.max(0, weightOf(c)) * ovrTiltWeight(plan.ovrTilt, c.ovr); w += x; return x; });
    if (w <= 0) continue;
    cards.forEach((c, i) => {
      const prev = out.get(c.id);
      const p = pk * ws[i] / w;
      out.set(c.id, { card: c, p: (prev?.p ?? 0) + p });
    });
  }
  return out;
}

/** Las tablas de cada hueco del sobre, en orden (normales y, al final, la destacada). */
export function slotTables(plan: MainPackPlan): ClassTable[] {
  return Array.from({ length: plan.cards }, (_, i) => (i === plan.cards - 1 ? plan.featured : plan.regular));
}

export interface TierIdentity {
  cards: number;
  /** P(mejor carta ≥ X) para X en 70..99 (0..1). */
  bestAtLeast: Record<number, number>;
  /** Cuantiles EXACTOS de la mejor carta del sobre. */
  best: { p50: number; p90: number; p99: number; mean: number };
  /** P(al menos k cartas ≥ 90), k = 1..3 (0..1). */
  ge90Count: { atLeast1: number; atLeast2: number; atLeast3: number };
  /** P(el sobre trae ≥ 1 Prime o Icon) (0..1): el «jackpot» de clase. */
  jackpot: number;
  /** Valor esperado por sobre con la función de valor dada. */
  expectedValue: number;
  /** OVR medio por carta. */
  meanOvr: number;
}

/** P(hueco ≥ X) para cada X de 0..100, a partir de la distribución por carta del hueco. */
function tailOf(probs: Map<string, { card: CardDef; p: number }>): Float64Array {
  const atLeast = new Float64Array(102);
  for (const { card, p } of probs.values()) {
    const o = Math.max(0, Math.min(100, Math.floor(card.ovr)));
    atLeast[o] += p;
  }
  for (let x = 100; x >= 0; x--) atLeast[x] += atLeast[x + 1];
  return atLeast;
}

/** Identidad exacta de un sobre de la línea. `value` = valor de una carta (p. ej. `marketValue`). */
export function tierIdentity(plan: MainPackPlan, pools: ClassPools, value: (c: CardDef) => number, weightOf?: (c: CardDef) => number): TierIdentity {
  const slots = slotTables(plan).map((t) => slotCardProbabilities(t, pools, plan, weightOf));
  const tails = slots.map(tailOf);
  const bestAtLeast: Record<number, number> = {};
  for (let x = 70; x <= 99; x++) bestAtLeast[x] = 1 - tails.reduce((acc, t) => acc * (1 - Math.min(1, t[x])), 1);

  // Cuantiles: el menor OVR x con P(mejor ≤ x) ≥ q. P(mejor ≤ x) = Π P(hueco < x + 1).
  const cdf = (x: number) => tails.reduce((acc, t) => acc * (1 - Math.min(1, t[x + 1])), 1);
  const quant = (q: number) => { for (let x = 0; x <= 100; x++) if (cdf(x) >= q - 1e-12) return x; return 100; };
  let bestMean = 0;
  for (let x = 1; x <= 100; x++) bestMean += 1 - cdf(x - 1); // E[max] = Σ_{x≥1} P(max ≥ x)

  // Poisson-binomial de «carta ≥ 90» sobre los huecos.
  let dist = [1];
  for (const t of tails) {
    const p = Math.min(1, t[90]);
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((v, k) => { next[k] += v * (1 - p); next[k + 1] += v * p; });
    dist = next;
  }
  const atLeastK = (k: number) => dist.slice(k).reduce((a, b) => a + b, 0);

  const jackpot = 1 - slots.reduce((acc, s) => {
    let p = 0; for (const { card, p: q } of s.values()) if (card.variantId === "future-star" || card.variantId === "record-breaker" || card.variantId === "moments") p += q;
    return acc * (1 - p);
  }, 1);

  let ev = 0, ovr = 0;
  for (const s of slots) for (const { card, p } of s.values()) { ev += p * value(card); ovr += p * card.ovr; }

  return {
    cards: plan.cards,
    bestAtLeast,
    best: { p50: quant(0.5), p90: quant(0.9), p99: quant(0.99), mean: bestMean },
    ge90Count: { atLeast1: atLeastK(1), atLeast2: atLeastK(2), atLeast3: atLeastK(3) },
    jackpot,
    expectedValue: ev,
    meanOvr: ovr / plan.cards,
  };
}
