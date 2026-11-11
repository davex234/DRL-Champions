/**
 * Tests de la regla «ATK eco ⇒ eco_rush salvo justificación del entrenador» (`./ecoEntry.ts`).
 * Ejecutar: `npx tsx --test src/coach/ecoEntry.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { createEconomy, planRound, buyContexts, type EconomyState } from "@/economy";
import { buildRoundPlan } from "@/preparation";
import type { PrepContext } from "@/preparation/types";
import { DEFAULT_SWITCH_AFTER } from "@/match/config";
import { decideCoach, applyCoachToPlan } from "./engine";
import type { CoachContext } from "./types";
import { checkEcoEntry, ECO_ENTRY_JUSTIFICATIONS, type EcoRoundFacts } from "./ecoEntry";

const base: EcoRoundFacts = {
  side: "ATK", planBuy: "eco", entryType: "eco_rush", realBuy: "eco",
  coach: { notes: ["endorse_plan", "obeyed"], deviated: false },
};
const facts = (over: Partial<EcoRoundFacts>): EcoRoundFacts => ({ ...base, ...over });
const coach = (notes: string[], deviated = false) => ({ notes, deviated });

test("no aplica: defensa, o ataque sin compra eco/save", () => {
  assert.deepEqual(checkEcoEntry(facts({ side: "DEF", entryType: "stack" })), { applies: false });
  for (const planBuy of ["half", "force", "full"] as const) {
    assert.deepEqual(checkEcoEntry(facts({ planBuy, realBuy: planBuy, entryType: "default" })), { applies: false }, planBuy);
  }
});

test("eco_rush vale siempre (eco y save; con o sin entrenador; obedezca o improvise)", () => {
  for (const tier of ["eco", "save"] as const) {
    for (const c of [null, coach(["endorse_plan", "obeyed"]), coach(["pistol_round", "improvised"], true)]) {
      const v = checkEcoEntry(facts({ planBuy: tier, realBuy: tier, coach: c }));
      assert.deepEqual(v, { applies: true, ok: true, reason: "eco_rush" }, `${tier} ${JSON.stringify(c)}`);
    }
  }
});

test("excepciones permitidas: pistol_round, react_match_point y react_to_losses (equipo obediente)", () => {
  for (const j of ECO_ENTRY_JUSTIFICATIONS) {
    for (const entryType of ["default", "contact"] as const) {
      const v = checkEcoEntry(facts({ entryType, coach: coach([j, "obeyed"]) }));
      assert.deepEqual(v, { applies: true, ok: true, reason: j }, `${j} ${entryType}`);
    }
  }
  // Con nota de inclinación (force) junto a la justificación, también.
  assert.equal(checkEcoEntry(facts({ entryType: "contact", coach: coach(["react_match_point", "lean_force", "obeyed"]) })).applies, true);
  assert.deepEqual(checkEcoEntry(facts({ entryType: "contact", coach: coach(["react_match_point", "lean_force", "obeyed"]) })),
    { applies: true, ok: true, reason: "react_match_point" });
});

test("sigue fallando: sin justificación (endorse_plan, sin notas, notas desconocidas)", () => {
  for (const notes of [["endorse_plan", "obeyed"], [], ["high_confidence", "obeyed"], ["manual", "obeyed"]]) {
    assert.deepEqual(checkEcoEntry(facts({ entryType: "default", coach: coach(notes) })),
      { applies: true, ok: false, reason: "unjustified" }, notes.join(","));
  }
});

test("sigue fallando: notas contradictorias — endorse_plan junto a una justificación táctica", () => {
  // `endorse_plan` dice «se juega el plan automático» (eco_rush); una justificación dice «se cambia». Si aparecen
  // juntas, la decisión es incoherente y no autoriza la desviación.
  for (const j of ECO_ENTRY_JUSTIFICATIONS) {
    assert.deepEqual(checkEcoEntry(facts({ entryType: "default", coach: coach(["endorse_plan", j, "obeyed"]) })),
      { applies: true, ok: false, reason: "contradictory" }, j);
    // Con eco_rush no hay desviación que autorizar: sigue valiendo.
    assert.deepEqual(checkEcoEntry(facts({ coach: coach(["endorse_plan", j, "obeyed"]) })),
      { applies: true, ok: true, reason: "eco_rush" }, `${j} con eco_rush`);
  }
});

test("sigue fallando: el equipo improvisó (aunque haya justificación)", () => {
  assert.deepEqual(checkEcoEntry(facts({ entryType: "default", coach: coach(["pistol_round", "improvised"], true) })),
    { applies: true, ok: false, reason: "improvised" });
  // Cualquiera de las dos señales basta.
  assert.equal((checkEcoEntry(facts({ entryType: "default", coach: coach(["pistol_round", "improvised"], false) })) as { reason: string }).reason, "improvised");
  assert.equal((checkEcoEntry(facts({ entryType: "default", coach: coach(["pistol_round"], true) })) as { reason: string }).reason, "improvised");
});

test("sigue fallando: entrada distinta de eco_rush sin entrenador", () => {
  assert.deepEqual(checkEcoEntry(facts({ entryType: "default", coach: null })), { applies: true, ok: false, reason: "no_coach" });
});

test("sigue fallando: compra incoherente o sin registrar (aunque la entrada sea eco_rush o esté justificada)", () => {
  for (const over of [{}, { entryType: "default" as const, coach: coach(["pistol_round", "obeyed"]) }]) {
    assert.deepEqual(checkEcoEntry(facts({ ...over, realBuy: "force" })), { applies: true, ok: false, reason: "buy_mismatch" });
    assert.deepEqual(checkEcoEntry(facts({ ...over, planBuy: "save", realBuy: "eco" })), { applies: true, ok: false, reason: "buy_mismatch" });
    assert.deepEqual(checkEcoEntry(facts({ ...over, realBuy: null })), { applies: true, ok: false, reason: "no_real_buy" });
  }
});

/* ── Contrato con el entrenador REAL: todo lo que hace hoy en eco cumple la regla. ── */

function ecoWith(credits: number): EconomyState {
  let e = createEconomy({ home: DEMO_HOME, away: DEMO_AWAY });
  for (const k of Object.keys(e.home.players)) e.home.players[k] = credits;
  return planRound(e, buyContexts({ home: 0, away: 0 }, []));
}

test("contrato: plan automático en eco ⇒ eco_rush; cada decisión del entrenador en eco pasa la regla", () => {
  const situations: [string, number, Partial<CoachContext>][] = [
    ["normal", 5, {}],
    ["pistola 1", 1, {}],
    ["pistola tras el cambio de lado", DEFAULT_SWITCH_AFTER + 1, {}],
    ["punto de partido del rival", 5, { matchPoint: ["away"] }],
    ["racha de derrotas", 5, { lossStreak: 3 }],
    ["momentum muy negativo", 5, { momentum: -60 }],
  ];
  const reasons = new Set<string>();
  for (const [name, round, over] of situations) {
    for (let seed = 1; seed <= 40; seed++) {
      const prep: PrepContext = {
        round, side: "ATK", score: { home: 0, away: 0 }, matchPoint: [], momentum: 0,
        homeRoster: DEMO_HOME, economy: ecoWith(800), seed,
      };
      const autoPlan = buildRoundPlan(prep);
      assert.equal(autoPlan.entryType, "eco_rush", `${name} seed ${seed}: el plan automático usa eco_rush`);
      const ctx: CoachContext = {
        autoPlan, side: "ATK", roster: DEMO_HOME, momentum: 0, lossStreak: 0,
        matchPoint: [], lastRoundAce: false, seed, ...over,
      };
      const { plan, decision } = applyCoachToPlan(ctx, decideCoach(ctx, { mode: "ai" }));
      const v = checkEcoEntry({
        side: plan.side, planBuy: plan.economy.buy, entryType: plan.entryType,
        realBuy: plan.economy.buy, coach: { notes: decision.notes, deviated: decision.deviated },
      });
      assert.ok(v.applies && v.ok, `${name} seed ${seed}: ${JSON.stringify(v)} [${decision.notes.join(",")}] ${plan.entryType}`);
      if (v.applies) reasons.add(v.reason);
    }
  }
  // El contrato tiene que haber ejercitado eco_rush y las tres justificaciones.
  for (const r of ["eco_rush", ...ECO_ENTRY_JUSTIFICATIONS]) assert.ok(reasons.has(r), `sin casos de ${r}: ${[...reasons].join(",")}`);
});
