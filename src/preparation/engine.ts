/**
 * ROUND PREPARATION ENGINE — Síntesis del RoundPlan (puro, determinista).
 *
 * Combina las aportaciones de cada motor (ninguno manda):
 *   · Economy   → tipo de compra, riesgo, capacidad, recomendación.
 *   · Identity  → temperamento (agresivo fuerza/ejecuta rápido; disciplinado defaults).
 *   · Narrative → presión (rachas, momentum, ir por detrás, match point).
 *   · Tactical  → traducción a entrada/approach/objetivos (vocabulario que el sim consume).
 *
 * El Match Engine solo coordina: pasa el contexto y recibe el plan.
 */
import type { Aggression, CoachSetup, Side, Tempo } from "@/sim";
import { teamMetrics, teamBuyBias, type BuyDecision, type BuyTier } from "@/economy";
import { computePressure } from "./narrative";
import {
  DEFAULT_DECISION, type EntryType, type PrepContext, type RiskLevel, type RoundPlan,
} from "./types";

const LANES = ["main", "tree", "mid"] as const;

const ATK_APPROACH: Record<string, string> = {
  eco_rush: "rush-main", contact: "rush-main", fast_execute: "split", fake: "fake-commit", default: "default",
};
const DEF_APPROACH: Record<string, string> = {
  stack: "stack-a", aggro_info: "aggro-info", hold_default: "balanced",
};

/** Approach (que consume el sim) para un tipo de entrada y lado. Reutilizable. */
export function approachForEntry(side: Side, entry: EntryType): string {
  return (side === "ATK" ? ATK_APPROACH : DEF_APPROACH)[entry] ?? (side === "ATK" ? "default" : "balanced");
}

function recommendation(dec: BuyDecision): string {
  return dec.status === "stable" ? dec.tier : `${dec.tier}/${dec.status}`;
}

function chooseTempo(tier: BuyTier, bias: number, pressure: number, aggressive: boolean): Tempo {
  if (pressure > 0.6) return "fast";
  if (tier === "eco" || tier === "save") return bias > 0 || pressure > 0.4 ? "fast" : "slow";
  if (tier === "force") return "fast";
  // full/half/bonus
  return aggressive ? "fast" : bias < -0.2 ? "slow" : "mid";
}

function riskOf(dec: BuyDecision, tier: BuyTier, pressure: number): RiskLevel {
  if (dec.risk > 0.6 || (tier === "force" && pressure > 0.5)) return "high";
  if ((tier === "eco" || tier === "save") && pressure < 0.4) return "low";
  return "medium";
}

/** Construye el RoundPlan a partir del contexto. Determinista. */
export function buildRoundPlan(ctx: PrepContext): RoundPlan {
  const dec = ctx.economy?.home.lastDecision ?? DEFAULT_DECISION;
  const tier = dec.tier;
  const bias = teamBuyBias(ctx.homeRoster);
  const capacity = ctx.economy ? teamMetrics(ctx.economy.home, ctx.economy.rules).buyingPower : 1;
  const { value: pressure, tags } = computePressure(ctx);

  const aggressive = tier === "force" || dec.status === "bonus" || pressure > 0.5 || bias > 0.3;
  const passive = (tier === "eco" || tier === "save") && bias < 0 && pressure < 0.3;
  const aggression: Aggression = aggressive ? "aggressive" : passive ? "passive" : "balanced";
  const tempo = chooseTempo(tier, bias, pressure, aggressive);

  let entryType: EntryType;
  let primaryObjective: string;
  let secondaryObjective: string;
  let retakePlan: string;
  let defensePlan: string;
  let fallback: string;
  let prioritySide: string;
  const changeConditions = ["man_down→regroup"];

  if (ctx.side === "ATK") {
    if (tier === "eco" || tier === "save") entryType = "eco_rush";
    else if (tier === "force") entryType = "contact";
    else if (pressure > 0.5 || (aggressive && ctx.seed % 3 === 0)) entryType = "fast_execute";
    else if (bias < -0.2 && ctx.seed % 4 === 0) entryType = "fake";
    else entryType = "default";

    prioritySide = LANES[ctx.seed % LANES.length];
    primaryObjective =
      entryType === "eco_rush" ? "surprise_pick" :
      entryType === "contact" ? "win_duels" :
      entryType === "fast_execute" ? "execute_site" :
      entryType === "fake" ? "bait_rotation" : "map_control";
    secondaryObjective = "plant_default";
    retakePlan = "rehit_or_save";
    defensePlan = "—";
    fallback = (tier === "eco" || tier === "save") ? "save" : entryType === "default" ? "rehit" : "save_if_lost";
    changeConditions.push("contact_bad→" + fallback, "planted→postplant");
  } else {
    if (tier === "eco" || tier === "save") entryType = "stack";
    else if (tier === "force") entryType = aggressive ? "aggro_info" : "stack";
    else entryType = bias > 0.2 ? "aggro_info" : "hold_default";

    prioritySide = entryType === "stack" ? LANES[ctx.seed % LANES.length] : "balanced";
    primaryObjective =
      entryType === "stack" ? "stack_site" :
      entryType === "aggro_info" ? "gather_info" : "hold_default";
    secondaryObjective = "prepare_retake";
    retakePlan = (tier === "eco" || tier === "save") ? "save_if_lost" : "coordinated_retake";
    defensePlan = entryType === "stack" ? "stack_one_site" : "spread_default";
    fallback = "retake_or_save";
    changeConditions.push("site_hit→rotate", "planted→retake");
  }

  const approach = approachForEntry(ctx.side, entryType);

  return {
    round: ctx.round,
    side: ctx.side,
    primaryObjective,
    secondaryObjective,
    tempo,
    prioritySide,
    entryType,
    approach,
    aggression,
    economy: { buy: tier, risk: dec.risk, capacity, recommendation: recommendation(dec) },
    riskLevel: riskOf(dec, tier, pressure),
    retakePlan,
    defensePlan,
    changeConditions,
    fallback,
    influences: {
      economy: `${tier} (risk ${dec.risk})`,
      identity: bias > 0.2 ? "aggressive_dna" : bias < -0.2 ? "disciplined_dna" : "balanced_dna",
      narrative: tags.join(","),
      tactical: entryType,
    },
  };
}

/** Traduce el plan al `CoachSetup` que consume `createRound`. */
export function planToSetup(plan: RoundPlan): CoachSetup {
  return { side: plan.side, approach: plan.approach, tempo: plan.tempo, aggression: plan.aggression };
}

const VALID_ATK_APPROACH = new Set(Object.values(ATK_APPROACH));
const VALID_DEF_APPROACH = new Set(Object.values(DEF_APPROACH));

/** Comprueba que un plan es coherente (no "imposible"). */
export function isValidPlan(plan: RoundPlan): boolean {
  const approachOk = plan.side === "ATK" ? VALID_ATK_APPROACH.has(plan.approach) : VALID_DEF_APPROACH.has(plan.approach);
  const tempoOk = (["slow", "mid", "fast"] as Tempo[]).includes(plan.tempo);
  const aggrOk = (["passive", "balanced", "aggressive"] as Aggression[]).includes(plan.aggression);
  const riskOk = ["low", "medium", "high"].includes(plan.riskLevel);
  return approachOk && tempoOk && aggrOk && riskOk && plan.changeConditions.length > 0;
}
