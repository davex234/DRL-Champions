/**
 * ECONOMY ENGINE — La DECISIÓN (el cerebro). NUNCA compra armas: recomienda.
 *
 * Combina tres cosas:
 *   1) Lo que se PUEDE permitir (créditos vs coste por nivel).
 *   2) La SITUACIÓN de partido (match point propio/rival, ir por detrás, bonus).
 *   3) El TEMPERAMENTO del equipo (sesgo de compra de la identidad: agresivo fuerza,
 *      disciplinado acepta eco, ego tiende a comprar).
 *
 * Responde a: ¿podemos full? ¿conviene eco? ¿es mejor force? ¿conviene guardar?
 * ¿qué riesgo asumimos?
 */
import type { BuyContext, BuyDecision, BuyTier, EconomyRules, EconomyStatus, TeamEconomyState, TeamMetrics } from "./types";
import { clamp, lossBonus } from "./rules";

export function decideBuy(
  team: TeamEconomyState,
  m: TeamMetrics,
  ctx: BuyContext,
  rules: EconomyRules,
): BuyDecision {
  const C = rules.costs;
  const bias = team.buyBias;
  const reasons: string[] = [];

  // 1) Nivel que se puede permitir por la media del equipo.
  const afford: BuyTier =
    m.avg >= C.full ? "full" :
    m.avg >= C.force ? "force" :
    m.avg >= C.half ? "half" : "eco";

  let tier: BuyTier;
  let status: EconomyStatus = "stable";

  if (team.bonus) {
    // Ganaron un eco/save: juegan con armas conservadas → compra de oportunidad.
    tier = "full";
    status = "bonus";
    reasons.push("bonus_kept_guns");
  } else if (afford === "full") {
    tier = "full";
    reasons.push("can_full");
  } else if (afford === "force") {
    const worth = ctx.matchPoint || ctx.opponentMatchPoint || bias > 0.15 || ctx.scoreDiff <= -2;
    if (worth) {
      tier = "force";
      if (ctx.opponentMatchPoint) { status = "match_point_force"; reasons.push("deny_match_point"); }
      else { reasons.push(ctx.matchPoint ? "close_it_out" : ctx.scoreDiff <= -2 ? "need_rounds" : "force_temperament"); }
    } else {
      tier = "eco";
      reasons.push("save_to_full");
    }
  } else if (afford === "half") {
    tier = bias > 0 ? "half" : "eco";
    reasons.push(tier === "half" ? "half_buy" : "save_to_full");
  } else {
    /*
     * F69 · F68-011 — RONDA PISTOLA. El primer plan del partido, con los créditos iniciales intactos (`rules.start`),
     * no es una economía rota: es la pistola, y el modelo ya dice qué se compra en ella («eco»: pistola + escudo
     * ligero). Clasificarla como «broken» recomendaba SAVE («no comprar, guardar todo») sin nada que guardar.
     */
    const pistol = team.lastDecision === null && m.avg === rules.start;
    // Rango eco: ¿está rota la economía?
    const broke = !pistol && m.avg < C.half * 0.5;
    if (pistol) {
      tier = "eco";
      reasons.push("pistol_round");
    } else if (broke) {
      if (ctx.opponentMatchPoint) { tier = "force"; status = "match_point_force"; reasons.push("desperation"); }
      else { tier = bias < -0.1 ? "save" : "eco"; status = "broken"; reasons.push("broken"); }
    } else {
      tier = bias < 0 ? "save" : "eco";
      reasons.push("eco");
    }
  }

  // Recuperación: venía de economía rota y ahora ahorra para reconstruir.
  if (team.prevStatus === "broken" && (tier === "eco" || tier === "save") && status === "stable") {
    status = "recovery";
    reasons.push("rebuild");
  }

  // 2) Riesgo: una compra que te deja sin nada si pierdes es arriesgada.
  const cost = team.bonus ? 0 : C[tier];
  const projLoseAvg = Math.max(0, m.avg - cost) + lossBonus(team.lossStreak, rules);
  const spendy = tier === "force" || tier === "full";
  const risk = clamp(
    spendy ? (C.half - projLoseAvg) / C.half + (tier === "force" ? 0.25 : 0) : 0.05,
    0, 1,
  );

  return {
    tier,
    status,
    risk: Math.round(risk * 100) / 100,
    canFullBuy: m.avg >= C.full || team.bonus,
    shouldEco: tier === "eco" || tier === "save",
    forceWorth: tier === "force",
    shouldSave: tier === "save",
    reasons,
  };
}
