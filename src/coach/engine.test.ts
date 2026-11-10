/**
 * Tests del Coach Decision Engine (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/coach/engine.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RosterEntry, Side } from "@/sim";
import { PROFILES } from "@/sim";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { buildRoundPlan, isValidPlan, type RoundPlan } from "@/preparation";
import { simulateMatch, makeMatchConfig } from "@/match";
import {
  decideCoach, applyCoachToPlan, runCoach, sanitizeConcept, obedienceProfile, computeConfidence,
} from "./index";
import type { CoachContext } from "./types";

function roster(profile: keyof typeof PROFILES): RosterEntry[] {
  const roles = ["entry", "igl", "lurk", "anchor", "support"] as const;
  return roles.map((role, i) => ({
    name: `${profile.slice(0, 3)}${i}`, role,
    attrs: { aim: 75, gameSense: 75, utility: 75, leadership: 75 }, identity: PROFILES[profile],
  }));
}

function autoPlan(side: Side): RoundPlan {
  return buildRoundPlan({
    round: 1, side, score: { home: 0, away: 0 }, matchPoint: [],
    momentum: 0, homeRoster: DEMO_HOME, economy: null, seed: 1,
  });
}
function ctx(over: Partial<CoachContext> = {}): CoachContext {
  return {
    autoPlan: autoPlan("ATK"), side: "ATK", roster: DEMO_HOME,
    momentum: 0, lossStreak: 0, matchPoint: [], lastRoundAce: false, seed: 1, ...over,
  };
}

test("sanitizeConcept reconduce conceptos cruzados al lado correcto", () => {
  assert.equal(sanitizeConcept("explode_a", "DEF"), "play_picks");
  assert.equal(sanitizeConcept("play_retake", "ATK"), "default");
  assert.equal(sanitizeConcept("force", "DEF"), "force");
});

test("modo manual usa el concepto del usuario (saneado)", () => {
  const d = decideCoach(ctx(), { mode: "manual", concept: "explode_a" });
  assert.equal(d.source, "manual");
  assert.equal(d.concept, "explode_a");
  assert.equal(d.entryType, "fast_execute");
});

test("modo IA elige un concepto válido (sin scripts)", () => {
  const d = decideCoach(ctx(), { mode: "ai" });
  assert.equal(d.source, "ai");
  assert.ok(["slow", "default", "explode_a", "explode_b", "fake", "play_picks", "play_retake", "force", "save"].includes(d.concept));
});

test("el plan final SIEMPRE es válido (no imposibles)", () => {
  for (const side of ["ATK", "DEF"] as const) {
    for (const concept of ["explode_a", "play_retake", "force", "save", "fake"] as const) {
      const r = applyCoachToPlan(ctx({ side, autoPlan: autoPlan(side) }), decideCoach(ctx({ side, autoPlan: autoPlan(side) }), { mode: "manual", concept }));
      assert.ok(isValidPlan(r.plan), `inválido ${side}/${concept}`);
    }
  }
});

test("ADN: un equipo disciplinado obedece más que uno creativo", () => {
  const disc = obedienceProfile(roster("patient-anchor"));
  const creative = obedienceProfile(roster("flank-lurker"));
  const adher = (p: { obedience: number; improvisation: number }) => p.obedience - p.improvisation * 0.5;
  assert.ok(adher(disc) > adher(creative), `${adher(disc)} > ${adher(creative)}`);
});

test("equipo disciplinado adopta el concepto del coach", () => {
  const c = ctx({ roster: roster("patient-anchor"), autoPlan: autoPlan("ATK"), seed: 3 });
  const r = applyCoachToPlan(c, decideCoach(c, { mode: "manual", concept: "explode_a" }));
  assert.equal(r.decision.deviated, false);
  assert.equal(r.plan.entryType, "fast_execute");
});

test("equipo creativo improvisa en alguna ronda (se desvía del coach)", () => {
  let deviations = 0;
  for (let seed = 0; seed < 12; seed++) {
    const c = ctx({ roster: roster("flank-lurker"), autoPlan: autoPlan("ATK"), seed });
    const r = applyCoachToPlan(c, decideCoach(c, { mode: "manual", concept: "explode_a" }));
    if (r.decision.deviated) deviations++;
  }
  assert.ok(deviations > 0, "un equipo creativo debería improvisar a veces");
});

test("ego: un equipo egocéntrico asume más riesgo", () => {
  const c = ctx({ roster: roster("explosive-star"), autoPlan: autoPlan("ATK"), seed: 5 });
  const r = applyCoachToPlan(c, decideCoach(c, { mode: "manual", concept: "save" }));
  assert.notEqual(r.plan.riskLevel, "low"); // el ego sube el riesgo desde 'low'
  assert.ok(r.decision.notes.includes("ego_risk"));
});

test("narrativa: un ace en la ronda previa sube la confianza", () => {
  const calm = computeConfidence(ctx());
  const hyped = computeConfidence(ctx({ lastRoundAce: true, momentum: 60 }));
  assert.ok(hyped > calm);
});

test("narrativa: tras 3 derrotas el coach cambia el enfoque", () => {
  const d = decideCoach(ctx({ lossStreak: 3, momentum: -60 }), { mode: "ai" });
  assert.ok(d.notes.includes("react_to_losses") || d.notes.includes("react_match_point"));
});

test("changes refleja lo que el coach cambió respecto al plan automático", () => {
  const base = autoPlan("ATK");
  const c = ctx({ roster: roster("patient-anchor"), autoPlan: base, seed: 3 });
  const r = applyCoachToPlan(c, decideCoach(c, { mode: "manual", concept: "explode_a" }));
  if (base.entryType !== "fast_execute") assert.ok(r.decision.changes.includes("entryType"));
});

test("integración en Match: el coach decide cada ronda; 'none' lo desactiva", () => {
  const cfg = (mode: "ai" | "none") => makeMatchConfig({ seed: 7, rosters: { home: DEMO_HOME, away: DEMO_AWAY }, homeSetup: { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" }, coach: { mode } });
  const ai = simulateMatch(cfg("ai"));
  assert.ok(ai.history.every((h) => h.coach != null));
  assert.ok(ai.history.every((h) => isValidPlan(h.plan!)));
  const none = simulateMatch(cfg("none"));
  assert.ok(none.history.every((h) => h.coach == null));
});

test("determinismo: misma config ⇒ mismas decisiones", () => {
  const cfg = () => makeMatchConfig({ seed: 21, rosters: { home: DEMO_HOME, away: DEMO_AWAY }, homeSetup: { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" }, coach: { mode: "ai" } });
  const a = simulateMatch(cfg()).history.map((h) => h.coach?.concept);
  const b = simulateMatch(cfg()).history.map((h) => h.coach?.concept);
  assert.deepEqual(a, b);
});
