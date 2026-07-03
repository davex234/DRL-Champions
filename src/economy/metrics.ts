/**
 * ECONOMY ENGINE — Métricas derivadas de un equipo.
 * Lo que un TeamEconomy "conoce": media, mínimo, máximo, capacidad de compra,
 * estabilidad, salud y (con la última decisión) riesgo y estado.
 */
import type { EconomyRules, TeamEconomyState, TeamEconomyView, TeamMetrics } from "./types";
import { clamp, lossBonus } from "./rules";

export function teamCredits(team: TeamEconomyState): number[] {
  return Object.values(team.players);
}

export function teamMetrics(team: TeamEconomyState, rules: EconomyRules): TeamMetrics {
  const vals = teamCredits(team);
  const n = Math.max(1, vals.length);
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = total / n;
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 0;
  const buyingPower = clamp(avg / rules.costs.full, 0, 1.2);
  const stability = clamp(1 - (max - min) / rules.max, 0, 1);
  const health: TeamMetrics["health"] =
    avg < rules.costs.half * 0.5 ? "broken" :
    avg < rules.costs.full ? "low" :
    avg < rules.costs.full * 1.5 ? "stable" : "rich";
  return { total, avg, min, max, buyingPower, stability, health };
}

/** Foto completa para Broadcast/UI: métricas + estado y riesgo de la decisión. */
export function teamEconomyView(team: TeamEconomyState, rules: EconomyRules): TeamEconomyView {
  const m = teamMetrics(team, rules);
  return {
    ...m,
    status: team.lastDecision?.status ?? m.health,
    risk: team.lastDecision?.risk ?? 0,
    buy: team.plannedBuy,
    lossBonus: lossBonus(team.lossStreak, rules),
    bonus: team.bonus,
  };
}

/** Ventaja económica (créditos) del equipo home respecto al away. */
export function economicAdvantage(home: TeamEconomyState, away: TeamEconomyState): number {
  return teamCredits(home).reduce((a, b) => a + b, 0) - teamCredits(away).reduce((a, b) => a + b, 0);
}
