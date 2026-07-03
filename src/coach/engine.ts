/**
 * COACH DECISION ENGINE — decisión + aplicación al RoundPlan.
 *
 *   Economy → autoPlan (Preparation) → COACH (decide + aplica) → RoundPlan final
 *
 * El coach elige un concepto (IA o manual), lo traduce a campos de plan y lo aplica
 * SOBRE el plan automático. Los jugadores lo siguen según su ADN (obediencia): un
 * equipo disciplinado adopta el concepto; uno creativo improvisa; el ego sube el riesgo.
 * No mueve jugadores ni compra armas: solo reescribe el plan de alto nivel.
 */
import type { Aggression, Side, Tempo } from "@/sim";
import { approachForEntry, type EntryType, type RiskLevel, type RoundPlan } from "@/preparation";
import { obedienceProfile } from "./identity";
import { aiConcept, computeConfidence } from "./ai";
import type { CoachConcept, CoachConfig, CoachContext, CoachDecision, CoachResult } from "./types";

const RISK_RANK: RiskLevel[] = ["low", "medium", "high"];
const bumpRisk = (r: RiskLevel): RiskLevel => RISK_RANK[Math.min(2, RISK_RANK.indexOf(r) + 1)];
const AGGR_RANK: Aggression[] = ["passive", "balanced", "aggressive"];
const bumpAggr = (a: Aggression): Aggression => AGGR_RANK[Math.min(2, AGGR_RANK.indexOf(a) + 1)];

/** Concepto válido para el lado (los cruzados se reconducen al equivalente). */
export function sanitizeConcept(concept: CoachConcept, side: Side): CoachConcept {
  if (side === "DEF" && (concept === "explode_a" || concept === "explode_b" || concept === "fake")) {
    return "play_picks";
  }
  if (side === "ATK" && concept === "play_retake") return "default";
  return concept;
}

interface ConceptShape {
  entryType: EntryType;
  tempo: Tempo;
  aggression: Aggression;
  primaryObjective: string;
  mapPriority?: string;
  riskLevel: RiskLevel;
  retakePlan?: string;
  defensePlan?: string;
  fallback?: string;
  economyLean?: "force" | "save";
}

/** Traduce un concepto a campos de plan (según el lado y el plan base). */
function conceptShape(concept: CoachConcept, side: Side, base: RoundPlan): ConceptShape {
  const atk = side === "ATK";
  switch (concept) {
    case "slow":
      return { entryType: atk ? "default" : "hold_default", tempo: "slow", aggression: "balanced",
        primaryObjective: atk ? "map_control" : "hold_default", riskLevel: "low" };
    case "default":
      return { entryType: atk ? "default" : "hold_default", tempo: "mid", aggression: "balanced",
        primaryObjective: atk ? "map_control" : "hold_default", riskLevel: "medium" };
    case "explode_a":
      return { entryType: "fast_execute", tempo: "fast", aggression: "aggressive",
        primaryObjective: "execute_site", mapPriority: "main", riskLevel: "medium" };
    case "explode_b":
      return { entryType: "fast_execute", tempo: "fast", aggression: "aggressive",
        primaryObjective: "execute_site", mapPriority: "tree", riskLevel: "medium" };
    case "fake":
      return { entryType: "fake", tempo: "mid", aggression: "balanced",
        primaryObjective: "bait_rotation", riskLevel: "medium" };
    case "play_picks":
      return { entryType: atk ? "default" : "aggro_info", tempo: "slow", aggression: "passive",
        primaryObjective: atk ? "surprise_pick" : "gather_info", riskLevel: "low" };
    case "play_retake":
      return { entryType: "hold_default", tempo: "slow", aggression: "passive",
        primaryObjective: "hold_default", defensePlan: "spread_default", retakePlan: "coordinated_retake", riskLevel: "low" };
    case "force":
      return { entryType: atk ? "contact" : "aggro_info", tempo: "fast", aggression: "aggressive",
        primaryObjective: atk ? "win_duels" : "gather_info", riskLevel: "high", fallback: "save_if_lost", economyLean: "force" };
    case "save":
      return { entryType: atk ? "eco_rush" : "stack", tempo: "slow", aggression: "passive",
        primaryObjective: atk ? "surprise_pick" : "stack_site", riskLevel: "low", fallback: "save", economyLean: "save" };
  }
}

/** El entrenador decide (IA o manual). Devuelve la decisión (intención). */
export function decideCoach(ctx: CoachContext, config: CoachConfig): CoachDecision {
  const manual = config.mode === "manual" && config.concept;
  const picked = manual ? config.concept! : aiConcept(ctx).concept;
  const concept = sanitizeConcept(picked, ctx.side);
  const notes = manual ? ["manual"] : aiConcept(ctx).notes;
  const shape = conceptShape(concept, ctx.side, ctx.autoPlan);
  if (shape.economyLean) notes.push(`lean_${shape.economyLean}`);

  return {
    source: manual ? "manual" : "ai",
    concept,
    primaryObjective: shape.primaryObjective,
    secondaryObjective: ctx.autoPlan.secondaryObjective,
    aggression: shape.aggression,
    tempo: shape.tempo,
    mapPriority: shape.mapPriority ?? ctx.autoPlan.prioritySide,
    entryType: shape.entryType,
    economy: ctx.autoPlan.economy,
    riskLevel: shape.riskLevel,
    retakePlan: shape.retakePlan ?? ctx.autoPlan.retakePlan,
    defensePlan: shape.defensePlan ?? ctx.autoPlan.defensePlan,
    fallback: shape.fallback ?? ctx.autoPlan.fallback,
    notes,
    confidence: computeConfidence(ctx),
    changes: [],
    deviated: false,
  };
}

const fract = (seed: number): number => (Math.imul(seed >>> 0, 2654435761) >>> 0) / 2 ** 32;

/** Aplica la decisión al plan automático, modulada por la obediencia (ADN). */
export function applyCoachToPlan(ctx: CoachContext, decision: CoachDecision): CoachResult {
  const auto = ctx.autoPlan;
  const prof = obedienceProfile(ctx.roster);
  const adherence = Math.max(0, Math.min(1, prof.obedience - prof.improvisation * 0.5));
  const deviated = fract(ctx.seed ^ 0x5bd1e995) > adherence;
  const notes = [...decision.notes];

  // Plan que QUIERE el coach.
  let entryType = decision.entryType;
  let primaryObjective = decision.primaryObjective;
  let prioritySide = decision.mapPriority;
  let tempo = decision.tempo;
  let aggression = decision.aggression;
  let riskLevel = decision.riskLevel;

  if (deviated) {
    // El equipo improvisa: vuelve a su lectura automática en lo esencial.
    entryType = auto.entryType;
    primaryObjective = auto.primaryObjective;
    prioritySide = auto.prioritySide;
    tempo = auto.tempo;
    aggression = auto.aggression;
    riskLevel = auto.riskLevel;
    notes.push("improvised");
  } else {
    notes.push("obeyed");
  }

  // El ego sube el riesgo asumido (independiente de obediencia).
  if (prof.egoRisk > 0.6) {
    riskLevel = bumpRisk(riskLevel);
    aggression = bumpAggr(aggression);
    notes.push("ego_risk");
  }

  const approach = approachForEntry(ctx.side, entryType);

  const plan: RoundPlan = {
    ...auto,
    primaryObjective,
    secondaryObjective: decision.secondaryObjective,
    tempo,
    prioritySide,
    entryType,
    approach,
    aggression,
    riskLevel,
    retakePlan: deviated ? auto.retakePlan : decision.retakePlan,
    defensePlan: deviated ? auto.defensePlan : decision.defensePlan,
    fallback: deviated ? auto.fallback : decision.fallback,
    influences: { ...auto.influences, tactical: `coach:${decision.concept}${deviated ? "(improv)" : ""}` },
  };

  // Qué cambió respecto al plan automático inicial.
  const changes: string[] = [];
  const cmp: (keyof RoundPlan)[] = ["entryType", "approach", "tempo", "aggression", "primaryObjective", "prioritySide", "riskLevel"];
  for (const k of cmp) if (plan[k] !== auto[k]) changes.push(k);

  return { plan, decision: { ...decision, notes, changes, deviated } };
}

/** Atajo: decide y aplica en un paso. */
export function runCoach(ctx: CoachContext, config: CoachConfig): CoachResult {
  return applyCoachToPlan(ctx, decideCoach(ctx, config));
}
