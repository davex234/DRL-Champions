/**
 * Tests del Economy Engine (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/economy/engine.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoachSetup, MatchRosters, RosterEntry } from "@/sim";
import { PROFILES } from "@/sim";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { simulateMatch, makeMatchConfig } from "@/match";
import {
  createEconomy, planRound, settleRound, buyContexts, decideBuy, teamMetrics,
  teamBuyBias, detectEconomicEvents, toTacticalEconomy, economyPosture, buildTacticalSetup,
  DEFAULT_RULES, type EconomyRoundRecord, type TeamEconomyState,
} from "./index";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
const ROSTERS: MatchRosters = { home: DEMO_HOME, away: DEMO_AWAY };

function emptyTeam(over: Partial<TeamEconomyState> = {}): TeamEconomyState {
  return {
    players: { a: 800, b: 800, c: 800, d: 800, e: 800 },
    lossStreak: 0, prevBuy: null, prevStatus: null, plannedBuy: null, lastDecision: null,
    bonus: false, spentThisRound: 0, beforeTotal: 4000, lostTotal: 0, buyBias: 0, ...over,
  };
}
const richPlayers = (c: number) => ({ a: c, b: c, c: c, d: c, e: c });

test("createEconomy: cada jugador arranca con los créditos iniciales", () => {
  const e = createEconomy(ROSTERS);
  assert.equal(Object.keys(e.home.players).length, 5);
  for (const c of Object.values(e.home.players)) assert.equal(c, DEFAULT_RULES.start);
});

test("decide: en pistola (800) se hace eco (no se puede pagar half)", () => {
  const t = emptyTeam();
  const d = decideBuy(t, teamMetrics(t, DEFAULT_RULES), { matchPoint: false, opponentMatchPoint: false, scoreDiff: 0 }, DEFAULT_RULES);
  assert.ok(d.tier === "eco" || d.tier === "save");
  assert.equal(d.canFullBuy, false);
  assert.equal(d.shouldEco, true);
});

test("decide: con créditos de sobra se hace FULL", () => {
  const t = emptyTeam({ players: richPlayers(5000) });
  const d = decideBuy(t, teamMetrics(t, DEFAULT_RULES), { matchPoint: false, opponentMatchPoint: false, scoreDiff: 0 }, DEFAULT_RULES);
  assert.equal(d.tier, "full");
  assert.equal(d.canFullBuy, true);
});

test("decide: economía rota → save/eco (recuperar)", () => {
  const t = emptyTeam({ players: richPlayers(500) });
  const d = decideBuy(t, teamMetrics(t, DEFAULT_RULES), { matchPoint: false, opponentMatchPoint: false, scoreDiff: 0 }, DEFAULT_RULES);
  assert.ok(d.tier === "save" || d.tier === "eco");
  assert.equal(d.status, "broken");
});

test("decide: a tiro de force, un equipo agresivo FUERZA y uno disciplinado ECO", () => {
  const ctx = { matchPoint: false, opponentMatchPoint: false, scoreDiff: 0 };
  const credits = richPlayers(3500); // alcanza force, no full
  const aggro = emptyTeam({ players: credits, buyBias: 0.6 });
  const disc = emptyTeam({ players: credits, buyBias: -0.6 });
  assert.equal(decideBuy(aggro, teamMetrics(aggro, DEFAULT_RULES), ctx, DEFAULT_RULES).tier, "force");
  assert.equal(decideBuy(disc, teamMetrics(disc, DEFAULT_RULES), ctx, DEFAULT_RULES).tier, "eco");
});

test("el temperamento de compra EMERGE del ADN (agresivo > disciplinado)", () => {
  const mk = (id: typeof PROFILES["aggressive-duelist"]): RosterEntry[] =>
    Array.from({ length: 5 }, (_, i) => ({ name: `p${i}`, role: "entry", attrs: { aim: 70, gameSense: 70, utility: 70, leadership: 70 }, identity: id }));
  const aggro = teamBuyBias(mk(PROFILES["aggressive-duelist"]));
  const disc = teamBuyBias(mk(PROFILES["patient-anchor"]));
  assert.ok(aggro > 0, `agresivo deberia ser >0: ${aggro}`);
  assert.ok(disc < 0, `disciplinado deberia ser <0: ${disc}`);
});

test("opponent match point fuerza un force de desesperación aunque esté roto", () => {
  const t = emptyTeam({ players: richPlayers(600) });
  const d = decideBuy(t, teamMetrics(t, DEFAULT_RULES), { matchPoint: false, opponentMatchPoint: true, scoreDiff: -5 }, DEFAULT_RULES);
  assert.equal(d.tier, "force");
  assert.equal(d.status, "match_point_force");
});

test("plan + settle: gasta al comprar y premia al ganar; créditos acotados", () => {
  let e = createEconomy(ROSTERS, { ...DEFAULT_RULES });
  e = planRound(e, buyContexts({ home: 0, away: 0 }, []));
  // tras gastar (eco=0 en pistola) los créditos siguen siendo válidos
  e = settleRound(e, { winner: "home", kills: {} });
  for (const c of Object.values(e.home.players)) {
    assert.ok(c >= 0 && c <= DEFAULT_RULES.max);
  }
  // ganar la pistola subió créditos por encima del arranque
  const avgHome = Object.values(e.home.players).reduce((a, b) => a + b, 0) / 5;
  assert.ok(avgHome > DEFAULT_RULES.start, `home deberia haber cobrado el win: ${avgHome}`);
  assert.equal(e.history.length, 1);
  assert.equal(e.history[0].winner, "home");
});

test("integración en Match: la economía evoluciona y rellena el historial", () => {
  const m = simulateMatch(makeMatchConfig({ seed: 7, rosters: ROSTERS, homeSetup: SETUP }));
  assert.ok(m.economy, "el Economy Engine debe estar activo por defecto");
  assert.equal(m.economy!.history.length, m.history.length);
  // cada ronda del historial del partido lleva las compras reales (placeholder relleno)
  for (const h of m.history) {
    assert.ok(h.economy && typeof h.economy.home === "string" && typeof h.economy.away === "string");
  }
  // sin estados imposibles: créditos dentro de rango y compras coherentes con afford
  for (const rec of m.economy!.history) {
    for (const tr of [rec.home, rec.away]) {
      assert.ok(tr.creditsAfter >= 0 && tr.creditsAfter <= DEFAULT_RULES.max * 5);
      if (tr.buy === "full" && tr.status !== "bonus") {
        assert.ok(tr.creditsBefore / 5 >= DEFAULT_RULES.costs.full - 1, "full sin poder pagarlo");
      }
    }
  }
});

test("hay diversidad de compras (ecos y al menos un full) en un partido", () => {
  const m = simulateMatch(makeMatchConfig({ seed: 7, rosters: ROSTERS, homeSetup: SETUP }));
  const buys = m.economy!.history.flatMap((r) => [r.home.buy, r.away.buy]);
  assert.ok(buys.includes("eco") || buys.includes("save"), "debe haber ecos");
  assert.ok(buys.includes("full"), "debe haber algún full");
  const distinct = new Set(buys).size;
  assert.ok(distinct >= 2, `poca diversidad: ${[...new Set(buys)].join(",")}`);
});

test("determinismo: misma config ⇒ misma economía", () => {
  const cfg = () => makeMatchConfig({ seed: 99, rosters: ROSTERS, homeSetup: SETUP });
  const a = simulateMatch(cfg()).economy!;
  const b = simulateMatch(cfg()).economy!;
  assert.deepEqual(a.history.map((r) => [r.home.buy, r.away.buy, r.winner]),
    b.history.map((r) => [r.home.buy, r.away.buy, r.winner]));
});

test("narrativa económica: detecta cadenas de eco y milagros", () => {
  const rec = (round: number, homeBuy: EconomyRoundRecord["home"]["buy"], winner: EconomyRoundRecord["winner"]): EconomyRoundRecord => ({
    round,
    home: { buy: homeBuy, status: "stable", risk: 0, creditsBefore: 4000, spent: 0, creditsAfter: 4000, reward: 0, avg: 800, min: 800, max: 800 },
    away: { buy: "full", status: "stable", risk: 0, creditsBefore: 21500, spent: 21500, creditsAfter: 5000, reward: 0, avg: 1000, min: 1000, max: 1000 },
    winner,
  });
  const history = [rec(1, "eco", "away"), rec(2, "eco", "home"), rec(3, "save", "away"), rec(4, "full", "home")];
  const events = detectEconomicEvents(history);
  assert.ok(events.some((e) => e.type === "eco_chain" && e.team === "home"));
  assert.ok(events.some((e) => e.type === "economic_miracle" && e.team === "home" && e.round === 2));
});

test("bridge táctico: mapea niveles y postura; full≠force≠eco", () => {
  assert.equal(toTacticalEconomy(emptyTeam({ plannedBuy: "full" })).buy, "full");
  assert.equal(toTacticalEconomy(emptyTeam({ plannedBuy: "save" })).buy, "eco");
  assert.equal(toTacticalEconomy(emptyTeam({ plannedBuy: "eco", bonus: true })).buy, "bonus");

  const eco = economyPosture({ tier: "eco", status: "stable", risk: 0, canFullBuy: false, shouldEco: true, forceWorth: false, shouldSave: false, reasons: [] });
  const full = economyPosture({ tier: "full", status: "stable", risk: 0, canFullBuy: true, shouldEco: false, forceWorth: false, shouldSave: false, reasons: [] });
  const force = economyPosture({ tier: "force", status: "stable", risk: 0, canFullBuy: false, shouldEco: false, forceWorth: true, shouldSave: false, reasons: [] });
  assert.ok(eco.grouped && eco.lowRisk && eco.surprises);
  assert.ok(full.mapControl && full.utility);
  assert.ok(force.fastDuels);

  // buildTacticalSetup mapea home→lado actual
  const e = createEconomy(ROSTERS);
  const setupAtk = buildTacticalSetup(e, "ATK");
  assert.ok(setupAtk.ATK && setupAtk.DEF);
});

test("Tactical consume la economía sin romper el partido (useEconomyTactics)", () => {
  const m = simulateMatch(makeMatchConfig({ seed: 4, rosters: ROSTERS, homeSetup: SETUP, useEconomyTactics: true }));
  assert.equal(m.phase, "MATCH_END");
  assert.ok(m.winner === "home" || m.winner === "away");
});
