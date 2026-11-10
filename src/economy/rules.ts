/**
 * ECONOMY ENGINE — Reglas por defecto y helpers puros.
 * Todo configurable; nada de números mágicos repartidos por la lógica.
 */
import type { BuyTier, EconomyRules } from "./types";

/** Valores tipo Valorant (en créditos abstractos; sin armas reales aún). */
export const DEFAULT_RULES: EconomyRules = {
  start: 800,
  max: 9000,
  win: 3000,
  lossBase: 1900,
  lossStep: 500,
  lossMax: 2900,
  kill: 200,
  costs: { save: 0, eco: 0, half: 2300, force: 3400, full: 4300 },
};

/** Orden de los niveles de compra (para comparaciones). */
export const TIER_RANK: Record<BuyTier, number> = { save: 0, eco: 1, half: 2, force: 3, full: 4 };

/** Bono de derrota según la racha (con tope). */
export function lossBonus(streak: number, rules: EconomyRules): number {
  return Math.min(rules.lossMax, rules.lossBase + rules.lossStep * Math.max(0, streak));
}

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function makeRules(partial: Partial<EconomyRules> = {}): EconomyRules {
  return {
    ...DEFAULT_RULES,
    ...partial,
    costs: { ...DEFAULT_RULES.costs, ...(partial.costs ?? {}) },
  };
}
