/**
 * FASE 69 · F68-011 — la IA del Tactical Coach recomendaba «SAVE / ECO» en la ronda 1 (pistola), con «Su economía está
 * tocada»; el propio panel dice «RONDA PISTOLA. Sin economía». En la ronda 1 los dos equipos parten de `rules.start`:
 * el tramo «eco» es por definición, no una economía rota, y no hay armas que conservar. Regla que el Coach ya modela.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoachSetup } from "@/sim";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { createMatch, stepMatch, makeMatchConfig, type MatchState } from "@/match";
import { scout } from "@/lib/match/scouting";
import { recommendationReasons } from "@/lib/match/coachIntel";
import { aiConcept } from "./ai";
import type { CoachContext } from "./types";
import type { RoundPlan } from "@/preparation";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

/** Avanza hasta la preparación de la ronda 1 (plan + decisión de la IA listos), como `useCoachMatch`. */
function prepared(seed: number, side: "ATK" | "DEF"): MatchState {
  let s = createMatch(makeMatchConfig({ seed, rosters: { home: DEMO_HOME, away: DEMO_AWAY }, homeSetup: { ...SETUP, side } }));
  let g = 0;
  while (s.phase !== "ROUND_PREPARATION" && g++ < 12) s = stepMatch(s);
  return stepMatch(s);
}

const ctx = (plan: Partial<RoundPlan> & { round: number; entryType: RoundPlan["entryType"] }, over: Partial<CoachContext> = {}): CoachContext => ({
  autoPlan: plan as RoundPlan, side: "ATK", roster: DEMO_HOME, momentum: 0, lossStreak: 0, matchPoint: [], lastRoundAce: false, seed: 1, ...over,
});

test("F69 F68-011 · ronda pistola real (motor completo): la IA no recomienda SAVE, en ataque ni en defensa", () => {
  for (const seed of [1, 7, 12345, 20250626, 99]) for (const side of ["ATK", "DEF"] as const) {
    const m = prepared(seed, side);
    assert.equal(m.roundNumber, 1);
    assert.equal(m.phase, "BUY_PHASE");
    assert.ok(m.currentDecision, "hay decisión de la IA");
    assert.notEqual(m.currentDecision!.concept, "save", `seed ${seed} ${side}: SAVE en la pistola`);
    const reasons = recommendationReasons(m.currentDecision!, scout(m), m).join(" ");
    assert.ok(!/econom[ií]a est[aá] tocada|aconseja salvar/i.test(reasons), `seed ${seed} ${side}: «${reasons}»`);
  }
});

test("F69 F68-011 · la regla es mínima: solo la ronda 1 y solo cuando el plan automático daba SAVE", () => {
  // Ronda 1 con entrada de eco (ATK) o apilar (DEF): antes «save», ahora el plan por defecto con su porqué.
  const atk = aiConcept(ctx({ round: 1, entryType: "eco_rush", economy: { buy: "eco" } as RoundPlan["economy"] }));
  assert.equal(atk.concept, "default");
  assert.ok(atk.notes.includes("pistol_round") && !atk.notes.includes("endorse_plan"));
  const def = aiConcept(ctx({ round: 1, entryType: "stack", economy: { buy: "eco" } as RoundPlan["economy"] }, { side: "DEF" }));
  assert.equal(def.concept, "default");
  // A partir de la ronda 2, un SAVE por economía sigue siendo legítimo: la regla no se extiende.
  const later = aiConcept(ctx({ round: 5, entryType: "eco_rush", economy: { buy: "save" } as RoundPlan["economy"] }));
  assert.equal(later.concept, "save");
  assert.ok(later.notes.includes("endorse_plan"));
  // Ronda 1 sin SAVE: intacta.
  const full = aiConcept(ctx({ round: 1, entryType: "default", economy: { buy: "full" } as RoundPlan["economy"] }));
  assert.equal(full.concept, "default");
  assert.ok(full.notes.includes("endorse_plan") && !full.notes.includes("pistol_round"));
});

test("F69 F68-011 · la compra de la pistola la sigue decidiendo el motor económico (no se toca el dinero)", () => {
  for (const seed of [1, 7, 12345]) {
    const m = prepared(seed, "ATK");
    assert.equal(m.currentDecision!.economy.buy, m.economy!.home.lastDecision!.tier, "el tier de compra es el de la economía");
  }
});

test("F69 F68-011 · fase de compra de la pistola: la economía recomienda ECO (pistola + escudo ligero), nunca SAVE ni «broken», sea cual sea el temperamento", async () => {
  const { decideBuy } = await import("@/economy/decide");
  const { teamMetrics } = await import("@/economy/metrics");
  const { DEFAULT_RULES } = await import("@/economy/rules");
  const start = DEFAULT_RULES.start;
  const team = (buyBias: number, credits = start, lastDecision: unknown = null) => ({
    players: { a: credits, b: credits, c: credits, d: credits, e: credits },
    lossStreak: 0, prevBuy: null, prevStatus: null, plannedBuy: null, lastDecision,
    bonus: false, spentThisRound: 0, beforeTotal: credits * 5, lostTotal: 0, buyBias,
  }) as unknown as Parameters<typeof decideBuy>[0];
  const ctx0 = { matchPoint: false, opponentMatchPoint: false, scoreDiff: 0 };
  for (const bias of [-1, -0.5, -0.11, 0, 0.3, 1]) {
    const t = team(bias);
    const d = decideBuy(t, teamMetrics(t, DEFAULT_RULES), ctx0, DEFAULT_RULES);
    assert.equal(d.tier, "eco", `bias ${bias}`);
    assert.notEqual(d.status, "broken", `bias ${bias}`);
    assert.ok(d.reasons.includes("pistol_round"));
  }
  // La regla no se extiende: sin créditos (500) o ya con una ronda decidida, un equipo disciplinado sigue pudiendo SALVAR.
  const broke = team(-0.5, 500);
  assert.equal(decideBuy(broke, teamMetrics(broke, DEFAULT_RULES), ctx0, DEFAULT_RULES).status, "broken");
  const later = team(-0.5, start, { tier: "eco", status: "stable" });
  const dl = decideBuy(later, teamMetrics(later, DEFAULT_RULES), ctx0, DEFAULT_RULES);
  assert.equal(dl.tier, "save");
  // En el motor completo, los dos equipos de la ronda 1 salen con ECO.
  for (const seed of [1, 7, 12345, 20250626, 99]) {
    const m = prepared(seed, "ATK");
    assert.equal(m.economy!.home.plannedBuy, "eco", `seed ${seed} home`);
    assert.equal(m.economy!.away.plannedBuy, "eco", `seed ${seed} away`);
  }
});
