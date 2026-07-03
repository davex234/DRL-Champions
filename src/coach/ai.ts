/**
 * COACH AI — elige el CONCEPTO de la ronda (sin scripts).
 *
 * Parte del plan automático de preparación (que ya integra economía, ADN y narrativa)
 * y lo ENDOSA o lo ESCALA según la situación: tras derrotas cambia el enfoque; con
 * confianza (ace, momentum, match point propio) se vuelve agresivo; ante match point
 * rival fuerza. Determinista.
 */
import type { EntryType, RoundPlan } from "@/preparation";
import type { Side } from "@/sim";
import type { CoachConcept, CoachContext } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Concepto base equivalente a la entrada del plan automático. */
export function entryToConcept(entry: EntryType): CoachConcept {
  switch (entry) {
    case "fast_execute": return "explode_a";
    case "contact": return "force";
    case "fake": return "fake";
    case "eco_rush": return "save";
    case "stack": return "save";
    case "aggro_info": return "play_picks";
    case "default":
    case "hold_default":
    default: return "default";
  }
}

export function computeConfidence(ctx: CoachContext): number {
  let c = 0.5;
  c += clamp(ctx.momentum / 200, -0.25, 0.25);
  if (ctx.lossStreak >= 3) c -= 0.2;
  else if (ctx.lossStreak === 2) c -= 0.1;
  if (ctx.lastRoundAce) c += 0.15;
  if (ctx.matchPoint.includes("home")) c += 0.1;
  if (ctx.matchPoint.includes("away")) c -= 0.1;
  return Math.round(clamp(c, 0, 1) * 100) / 100;
}

/** El Coach AI decide el concepto. Devuelve también las notas de por qué. */
export function aiConcept(ctx: CoachContext): { concept: CoachConcept; notes: string[] } {
  const side: Side = ctx.side;
  const plan: RoundPlan = ctx.autoPlan;
  const buy = plan.economy.buy;
  const notes: string[] = [];
  let concept = entryToConcept(plan.entryType);

  const facingMatchPoint = ctx.matchPoint.includes("away");
  const confident = ctx.lastRoundAce || ctx.momentum > 50 || ctx.matchPoint.includes("home");
  const reeling = ctx.lossStreak >= 3 || ctx.momentum < -40;

  if (facingMatchPoint) {
    concept = side === "ATK" ? (buy === "eco" || buy === "save" ? "force" : "explode_a") : "force";
    notes.push("react_match_point");
  } else if (reeling) {
    // Tras varias derrotas, el entrenador cambia el enfoque.
    if (buy === "eco" || buy === "save") concept = side === "ATK" ? "play_picks" : "play_retake";
    else if (buy === "force") concept = "force";
    else concept = side === "ATK" ? "explode_a" : "play_picks";
    notes.push("react_to_losses");
  } else if (confident && buy === "full") {
    // Con confianza alta, ejecuta con decisión.
    concept = side === "ATK" ? (ctx.seed % 2 === 0 ? "explode_a" : "explode_b") : "play_picks";
    notes.push("high_confidence");
  } else {
    notes.push("endorse_plan");
  }

  return { concept, notes };
}
