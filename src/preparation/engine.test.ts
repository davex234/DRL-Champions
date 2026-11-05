/**
 * Tests del Round Preparation Engine (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/preparation/engine.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RosterEntry } from "@/sim";
import { PROFILES } from "@/sim";
import { createEconomy, planRound, buyContexts, type EconomyState } from "@/economy";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { buildRoundPlan, planToSetup, isValidPlan, computePressure } from "./index";
import type { PrepContext } from "./types";

function roster(profile: keyof typeof PROFILES): RosterEntry[] {
  const roles = ["entry", "igl", "lurk", "anchor", "support"] as const;
  return roles.map((role, i) => ({
    name: `${profile.slice(0, 3)}${i}`,
    role,
    attrs: { aim: 75, gameSense: 75, utility: 75, leadership: 75 },
    identity: PROFILES[profile],
  }));
}

function ctx(over: Partial<PrepContext> = {}): PrepContext {
  return {
    round: 1, side: "ATK", score: { home: 0, away: 0 }, matchPoint: [],
    momentum: 0, homeRoster: DEMO_HOME, economy: null, seed: 1, ...over,
  };
}

/** Economía con una compra ya decidida para el equipo home, en un contexto dado. */
function ecoWith(credits: number, score = { home: 0, away: 0 }, mp: ("home" | "away")[] = []): EconomyState {
  let e = createEconomy({ home: DEMO_HOME, away: DEMO_AWAY });
  for (const k of Object.keys(e.home.players)) e.home.players[k] = credits;
  e = planRound(e, buyContexts(score, mp));
  return e;
}

test("determinismo: mismo contexto ⇒ mismo plan", () => {
  const c = ctx({ economy: ecoWith(5000) });
  assert.deepEqual(buildRoundPlan(c), buildRoundPlan(c));
});

test("plan SIEMPRE válido (no planes imposibles)", () => {
  for (const side of ["ATK", "DEF"] as const) {
    for (const credits of [600, 2500, 5000]) {
      const plan = buildRoundPlan(ctx({ side, economy: ecoWith(credits) }));
      assert.ok(isValidPlan(plan), `plan inválido ${side}/${credits}: ${JSON.stringify(plan)}`);
    }
  }
});

test("economía → entrada: eco en ATK produce eco_rush; full produce default/execute", () => {
  const eco = buildRoundPlan(ctx({ side: "ATK", economy: ecoWith(800) }));
  assert.equal(eco.entryType, "eco_rush");
  assert.equal(eco.approach, "rush-main");
  assert.ok(["eco", "save"].includes(eco.economy.buy));

  const full = buildRoundPlan(ctx({ side: "ATK", economy: ecoWith(5000) }));
  assert.equal(full.economy.buy, "full");
  assert.ok(["default", "fast_execute", "fake"].includes(full.entryType));
});

test("DEF en eco apila el sitio (stack)", () => {
  const plan = buildRoundPlan(ctx({ side: "DEF", economy: ecoWith(800) }));
  assert.equal(plan.entryType, "stack");
  assert.equal(plan.approach, "stack-a");
});

test("ADN: equipo agresivo tiende a más agresión que uno disciplinado (mismo dinero)", () => {
  const credits = ecoWith(5000);
  const aggro = buildRoundPlan(ctx({ side: "ATK", economy: credits, homeRoster: roster("aggressive-duelist") }));
  const disc = buildRoundPlan(ctx({ side: "ATK", economy: credits, homeRoster: roster("patient-anchor") }));
  assert.equal(aggro.influences.identity, "aggressive_dna");
  assert.equal(disc.influences.identity, "disciplined_dna");
  const rank = { passive: 0, balanced: 1, aggressive: 2 };
  assert.ok(rank[aggro.aggression] >= rank[disc.aggression]);
});

test("narrativa: 3 derrotas seguidas suben la presión", () => {
  const calm = computePressure(ctx());
  const e = ecoWith(2500);
  e.home.lossStreak = 3;
  const stressed = computePressure(ctx({ economy: e, momentum: -50 }));
  assert.ok(stressed.value > calm.value);
  assert.ok(stressed.tags.includes("losing_streak"));
});

test("presión alta empuja a force a dinero de force", () => {
  // La economía decide CON el contexto de partido (déficit) → force; el plan lo hereda.
  const e = ecoWith(3500, { home: 2, away: 8 }); // alcanza force, no full, e ir por detrás
  e.home.lossStreak = 3;
  const plan = buildRoundPlan(ctx({ side: "ATK", economy: e, momentum: -60, score: { home: 2, away: 8 } }));
  assert.equal(plan.economy.buy, "force");
  assert.equal(plan.aggression, "aggressive");
  assert.equal(plan.tempo, "fast");
});

test("planToSetup traduce el plan a CoachSetup que consume el sim", () => {
  const plan = buildRoundPlan(ctx({ side: "ATK", economy: ecoWith(5000) }));
  const setup = planToSetup(plan);
  assert.equal(setup.side, "ATK");
  assert.equal(setup.approach, plan.approach);
  assert.equal(setup.tempo, plan.tempo);
  assert.equal(setup.aggression, plan.aggression);
});

test("economía desactivada → plan nominal de full buy", () => {
  const plan = buildRoundPlan(ctx({ economy: null }));
  assert.equal(plan.economy.buy, "full");
  assert.ok(isValidPlan(plan));
});
