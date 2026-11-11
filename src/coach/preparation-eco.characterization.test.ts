/**
 * INVESTIGACIÓN · «la economía manda la entrada (ATK eco ⇒ eco_rush 100%)» (scripts/preparation-verify.ts).
 *
 * Test de CARACTERIZACIÓN: documenta el comportamiento ACTUAL para la investigación; NO fija una decisión de diseño.
 * Si se elige cambiar el comportamiento (opciones A/B/C de la propuesta), este test se reescribe con esa decisión.
 *
 * Hipótesis que comprueba, sin simular partidos (milisegundos):
 *   1. El motor de preparación cumple la regla: ATK con compra eco/save ⇒ entrada eco_rush.
 *   2. El entrenador de IA (activo por defecto en los partidos) la reescribe A PROPÓSITO en tres casos, y copia la
 *      economía del plan automático, de modo que el plan final queda «buy eco» con otra entrada:
 *        - ronda de pistola (1 y la primera tras el cambio de lado)  → concepto default  (nota pistol_round);
 *        - el rival tiene punto de partido                           → concepto force    (nota react_match_point);
 *        - racha de derrotas / momentum muy negativo                 → concepto play_picks (nota react_to_losses).
 *   3. Si el equipo IMPROVISA (desobedece por ADN), vuelve a la entrada automática (eco_rush).
 * `preparation-verify` lee el plan FINAL del historial con la regla del motor de preparación: de ahí el fallo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { createEconomy, planRound, buyContexts, type EconomyState } from "@/economy";
import { buildRoundPlan, type RoundPlan } from "@/preparation";
import type { PrepContext } from "@/preparation/types";
import { DEFAULT_SWITCH_AFTER } from "@/match/config";
import { decideCoach, applyCoachToPlan } from "./engine";
import type { CoachContext } from "./types";

const AI = { mode: "ai" } as const;
const ECO = ["eco", "save"];
const PISTOL_2 = DEFAULT_SWITCH_AFTER + 1;

/** Economía con todo el equipo home en `credits` y la compra ya decidida (mismo patrón que preparation/engine.test). */
function ecoWith(credits: number): EconomyState {
  let e = createEconomy({ home: DEMO_HOME, away: DEMO_AWAY });
  for (const k of Object.keys(e.home.players)) e.home.players[k] = credits;
  return planRound(e, buyContexts({ home: 0, away: 0 }, []));
}

function autoPlanAtk(round: number, seed = 7): RoundPlan {
  const ctx: PrepContext = {
    round, side: "ATK", score: { home: 0, away: 0 }, matchPoint: [],
    momentum: 0, homeRoster: DEMO_HOME, economy: ecoWith(800), seed,
  };
  return buildRoundPlan(ctx);
}

function coachCtx(autoPlan: RoundPlan, over: Partial<CoachContext> = {}): CoachContext {
  return {
    autoPlan, side: "ATK", roster: DEMO_HOME, momentum: 0, lossStreak: 0,
    matchPoint: [], lastRoundAce: false, seed: 7, ...over,
  };
}

test("1 · motor de preparación: ATK con compra eco ⇒ eco_rush (también en pistolas)", () => {
  for (const round of [1, 5, PISTOL_2]) {
    const p = autoPlanAtk(round);
    assert.ok(ECO.includes(p.economy.buy), `ronda ${round}: compra ${p.economy.buy}`);
    assert.equal(p.entryType, "eco_rush", `ronda ${round}`);
  }
});

test("2a · entrenador, ronda normal: respalda el eco (eco_rush, endorse_plan)", () => {
  const d = decideCoach(coachCtx(autoPlanAtk(5)), AI);
  assert.equal(d.concept, "save");
  assert.equal(d.entryType, "eco_rush");
  assert.ok(d.notes.includes("endorse_plan"), d.notes.join(","));
});

test("2b · entrenador, pistolas (1 y tras el cambio de lado): default con compra eco (pistol_round)", () => {
  for (const round of [1, PISTOL_2]) {
    const d = decideCoach(coachCtx(autoPlanAtk(round)), AI);
    assert.equal(d.concept, "default", `ronda ${round}`);
    assert.equal(d.entryType, "default", `ronda ${round}`);
    assert.ok(d.notes.includes("pistol_round"), d.notes.join(","));
    assert.ok(ECO.includes(d.economy.buy), `ronda ${round}: la economía se copia del plan automático (${d.economy.buy})`);
  }
});

test("2c · entrenador, rival en punto de partido: force/contact con compra eco (react_match_point)", () => {
  const d = decideCoach(coachCtx(autoPlanAtk(5), { matchPoint: ["away"] }), AI);
  assert.equal(d.concept, "force");
  assert.equal(d.entryType, "contact");
  assert.ok(d.notes.includes("react_match_point") && d.notes.includes("lean_force"), d.notes.join(","));
  assert.ok(ECO.includes(d.economy.buy), `compra ${d.economy.buy}`);
});

test("2d · entrenador, racha de derrotas: play_picks/default con compra eco (react_to_losses)", () => {
  for (const over of [{ lossStreak: 3 }, { momentum: -60 }] as Partial<CoachContext>[]) {
    const d = decideCoach(coachCtx(autoPlanAtk(5), over), AI);
    assert.equal(d.concept, "play_picks", JSON.stringify(over));
    assert.equal(d.entryType, "default", JSON.stringify(over));
    assert.ok(d.notes.includes("react_to_losses"), d.notes.join(","));
    assert.ok(ECO.includes(d.economy.buy), `compra ${d.economy.buy}`);
  }
});

test("3 · plan aplicado: si el equipo obedece queda «buy eco» con otra entrada; si improvisa, vuelve a eco_rush", () => {
  const cases: [string, number, Partial<CoachContext>, string][] = [
    ["pistola", 1, {}, "default"],
    ["punto de partido", 5, { matchPoint: ["away"] }, "contact"],
    ["racha", 5, { lossStreak: 3 }, "default"],
  ];
  for (const [name, round, over, wanted] of cases) {
    let obeyed = 0;
    let improvised = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const ctx = coachCtx(autoPlanAtk(round, seed), { ...over, seed });
      const { plan, decision } = applyCoachToPlan(ctx, decideCoach(ctx, AI));
      assert.ok(ECO.includes(plan.economy.buy), `${name} seed ${seed}: el plan final conserva la compra ${plan.economy.buy}`);
      if (decision.deviated) {
        improvised++;
        assert.equal(plan.entryType, "eco_rush", `${name} seed ${seed}: improvisa ⇒ entrada automática`);
      } else {
        obeyed++;
        assert.equal(plan.entryType, wanted, `${name} seed ${seed}: obedece ⇒ entrada del entrenador`);
      }
    }
    // Sin al menos un caso obedecido el test no demostraría nada.
    assert.ok(obeyed > 0, `${name}: ningún caso obedecido en 60 semillas (obedece ${obeyed}, improvisa ${improvised})`);
  }
});
