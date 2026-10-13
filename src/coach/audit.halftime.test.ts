/**
 * FULL GAME AUDIT (2026-10-07) · el descanso (cambio de lado tras la ronda 12) es la SEGUNDA PISTOLA.
 *
 * Antes `onSideSwitch` solo daba la vuelta a los lados: la ronda 13 heredaba los créditos, la racha de derrotas y el
 * bonus de la primera mitad, así que en una «RONDA PISTOLA. Sin economía» (lo que dice el panel) se compraban rifles
 * y escudo pesado. Motor completo y semillas reales, como `useCoachMatch`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildManualPlan, conceptDefaults } from "@/coach";
import type { CoachSetup } from "@/sim";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { createMatch, stepMatch, makeMatchConfig, type MatchState } from "@/match";
import { DEFAULT_RULES, startSecondHalf } from "@/economy";
import { aiConcept } from "./ai";
import type { CoachContext } from "./types";
import type { RoundPlan } from "@/preparation";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

/** Avanza hasta que la ronda 13 tiene su plan (fase de compra), o hasta que el partido termina. */
function toRound13(seed: number): MatchState {
  let s = createMatch(makeMatchConfig({ seed, rosters: { home: DEMO_HOME, away: DEMO_AWAY }, homeSetup: SETUP }));
  for (let g = 0; g < 20_000 && s.phase !== "MATCH_END"; g++) {
    if (s.roundNumber === 13 && s.phase === "BUY_PHASE") return s;
    s = stepMatch(s);
  }
  return s;
}

test("AUDIT-COACH-1 · ronda 13 (motor completo): créditos iniciales, sin racha ni bonus, compra de pistola", () => {
  let checked = 0;
  for (const seed of [1, 7, 99, 12345, 20250626]) {
    const m = toRound13(seed);
    if (m.phase === "MATCH_END") continue; // un 13-0 no llega a la 13
    checked++;
    for (const slot of ["home", "away"] as const) {
      const t = m.economy![slot];
      assert.equal(t.lossStreak, 0, `seed ${seed} ${slot}: la racha no cruza el descanso`);
      assert.equal(t.bonus, false, `seed ${seed} ${slot}: no hay armas guardadas tras el descanso`);
      assert.equal(t.beforeTotal, DEFAULT_RULES.start * Object.keys(t.players).length, `seed ${seed} ${slot}: créditos iniciales`);
      assert.ok(t.lastDecision?.reasons.includes("pistol_round"), `seed ${seed} ${slot}: ${t.lastDecision?.tier} ${t.lastDecision?.reasons}`);
      assert.notEqual(t.lastDecision?.tier, "full", `seed ${seed} ${slot}: nada de rifles en la pistola`);
    }
    assert.notEqual(m.currentDecision?.concept, "save", `seed ${seed}: la IA no recomienda SAVE en la segunda pistola`);
  }
  assert.ok(checked >= 3, `al menos 3 partidos llegan a la 13 (${checked})`);
});

test("AUDIT-COACH-2 · startSecondHalf: reinicia el dinero de los dos equipos y conserva el historial", () => {
  const s0 = toRound13(1);
  const fake = { ...s0.economy!, home: { ...s0.economy!.home, players: Object.fromEntries(Object.keys(s0.economy!.home.players).map((k) => [k, 9000])), lossStreak: 4, bonus: true } };
  const r = startSecondHalf(fake);
  assert.ok(Object.values(r.home.players).every((v) => v === DEFAULT_RULES.start));
  assert.equal(r.home.lossStreak, 0); assert.equal(r.home.bonus, false); assert.equal(r.home.lastDecision, null);
  assert.equal(r.history, fake.history, "lo jugado no se toca");
});

test("AUDIT-COACH-3 · la IA trata la ronda 13 como pistola (no recomienda SAVE); las demás no cambian", () => {
  const ctx = (round: number): CoachContext => ({
    autoPlan: { round, entryType: "eco_rush", economy: { buy: "eco" } } as RoundPlan, side: "ATK", roster: DEMO_HOME, momentum: 0, lossStreak: 0, matchPoint: [], lastRoundAce: false, seed: 1,
  });
  assert.notEqual(aiConcept(ctx(13)).concept, "save");
  assert.ok(aiConcept(ctx(13)).notes.includes("pistol_round"));
  assert.equal(aiConcept(ctx(14)).concept, aiConcept(ctx(5)).concept, "fuera de las pistolas, la regla de siempre");
});

/* ───────── FULL GAME AUDIT · la estrategia elegida manda sobre la recomendación anterior ───────── */

test("AUDIT-COACH-4 · «Explode A» elegido con la IA recomendando «Explode B»: el plan va por A (carril, tempo y riesgo de A)", () => {
  const prep = toRound13(7);
  const ctx: CoachContext = { autoPlan: prep.currentPlan ?? ({ round: 13, entryType: "default", economy: { buy: "full" }, prioritySide: "mid" } as unknown as RoundPlan), side: "ATK", roster: DEMO_HOME, momentum: 0, lossStreak: 0, matchPoint: [], lastRoundAce: false, seed: 1 };
  const a = conceptDefaults("explode_a", "ATK");
  assert.equal(a.mapPriority, "main");
  // Lo que publica ahora el panel al pulsar «Explode A» (objetivo sin tocar → vacío: manda la estrategia).
  const r = buildManualPlan(ctx, { concept: "explode_a", tempo: a.tempo, aggression: a.aggression, riskLevel: a.riskLevel, primaryObjective: "", mapPriority: "", utility: "entry" });
  assert.equal(r.decision.mapPriority, "main", "antes: «tree» (el carril de la recomendación Explode B)");
  assert.equal(r.decision.primaryObjective, "execute_site");
  assert.equal(r.decision.tempo, "fast");
});

test("AUDIT-COACH-5 · el panel: elegir estrategia pone sus diales y su objetivo (contrato del componente)", () => {
  const src = readFileSync(join(process.cwd(), "src/components/coach/CoachTacticalPanel.tsx"), "utf8");
  assert.match(src, /onClick=\{\(\) => pickConcept\(s\.concept\)\}/);
  assert.match(src, /const d = conceptDefaults\(c, prep\.side\);/);
  assert.match(src, /concept === rec\.concept \? rec\.mapPriority : ""/);
});
