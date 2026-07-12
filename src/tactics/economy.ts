/**
 * TACTICAL INTELLIGENCE ENGINE — Economía ESTIMADA (no autoritativa).
 *
 * ⚠️ CONSOLIDATION F1.1 — la economía REAL y única del juego es `src/economy/` (createEconomy/
 * planRound/settleRound); en partido, la táctica se SIEMBRA desde ella vía
 * `economy/tactical.ts::buildTacticalSetup`. Este archivo queda como estimador ligero:
 * `pistolEconomy` la usa el runtime táctico como semilla neutra, y la progresión
 * (`nextEconomy`/`applyBuy`/`buyOf`) SOLO la consumen los reports headless
 * (`scripts/{tactics,spatial}-report.ts`). NO usar como contabilidad del juego.
 */
import type { Buy, TeamEconomy } from "./types";

const CAP = 9000;
const COST_FULL = 3900;
const COST_FORCE = 2300;
const COST_ECO = 400;

export function pistolEconomy(): TeamEconomy {
  return { credits: 800, buy: "eco", lossStreak: 0 };
}

export function buyOf(credits: number): Buy {
  if (credits >= COST_FULL) return "full";
  if (credits >= COST_FORCE) return "force";
  return "eco";
}

const costOf = (buy: Buy): number =>
  buy === "full" || buy === "bonus" ? COST_FULL : buy === "force" ? COST_FORCE : COST_ECO;

/**
 * Avanza la economía tras una ronda. Decide la compra de la SIGUIENTE.
 * `won` = ganó la ronda; `kills` = bajas del equipo (recompensa menor).
 */
export function nextEconomy(prev: TeamEconomy, won: boolean, kills: number): TeamEconomy {
  const lossStreak = won ? 0 : prev.lossStreak + 1;
  const reward = won ? 3000 : 1900 + Math.min(2, prev.lossStreak) * 500;
  const credits = Math.min(CAP, prev.credits + reward + kills * 200);
  let buy = buyOf(credits);
  // Bono: si la ronda anterior fue eco y la ganaron, juegan con armas conservadas.
  if (prev.buy === "eco" && won && buy !== "full") buy = "bonus";
  return { credits, buy, lossStreak };
}

/** Tras decidir la compra, descuenta el coste (para la siguiente estimación). */
export function applyBuy(eco: TeamEconomy): TeamEconomy {
  return { ...eco, credits: Math.max(0, eco.credits - costOf(eco.buy)) };
}
