/**
 * Tests del Broadcast Engine (node:test, sin dependencias nuevas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRound, tick as simTick, type CoachSetup, type RoundState } from "../sim";
import { LiveDirector, liveInput } from "../spectator";
import { createViewport } from "../camera";
import { buildBroadcastState } from "./engine";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

function bs(state: RoundState) {
  const decision = new LiveDirector().decide(liveInput(state));
  return buildBroadcastState({ state, decision, viewport: createViewport() });
}

function withAlive(atkN: number, defN: number): RoundState {
  const s = structuredClone(createRound(1, SETUP));
  s.phase = "EXECUTE";
  s.players.filter((p) => p.side === "ATK").forEach((p, i) => { p.alive = i < atkN; });
  s.players.filter((p) => p.side === "DEF").forEach((p, i) => { p.alive = i < defN; });
  return s;
}

test("estado inicial limpio (reset correcto)", () => {
  const b = bs(createRound(1, SETUP));
  assert.equal(b.match.score.atk, 0);
  assert.equal(b.match.score.def, 0);
  assert.equal(b.events.killFeed.length, 0);
  assert.equal(b.events.flags.firstBlood, false);
  assert.equal(b.teams.atk.alive, 5);
  assert.equal(b.teams.def.alive, 5);
  assert.ok(b.match.timeLeft > 0);
});

test("BroadcastState consistente y SIN datos imposibles (ronda completa)", () => {
  const dir = new LiveDirector();
  const vp = createViewport();
  let s = createRound(7, SETUP);
  for (let i = 0; i < 2000 && s.phase !== "ENDED"; i++) {
    const b = buildBroadcastState({ state: s, decision: dir.decide(liveInput(s)), viewport: vp });
    for (const t of [b.teams.atk, b.teams.def]) {
      assert.ok(t.alive >= 0 && t.alive <= t.total, "vivos imposibles");
      assert.ok(t.economyEstimate >= 0 && Number.isFinite(t.economyEstimate), "economía imposible");
    }
    assert.ok(b.match.timeLeft >= 0, "tiempo negativo");
    const wp = b.stats.winProb;
    assert.ok(wp.atk >= 0 && wp.atk <= 1 && wp.def >= 0 && wp.def <= 1, "winprob fuera de [0,1]");
    assert.ok(Math.abs(wp.atk + wp.def - 1) < 1e-6, "winprob no suma 1");
    assert.ok(b.events.killFeed.length <= 6, "kill feed sin límite");
    s = simTick(s);
  }
});

test("Kill Feed correcto (nombres y bandos opuestos)", () => {
  let s = createRound(7, SETUP);
  for (let i = 0; i < 2000 && s.events.filter((e) => e.type === "kill").length < 3; i++) s = simTick(s);
  const b = bs(s);
  const totalKills = s.events.filter((e) => e.type === "kill").length;
  assert.equal(b.events.killFeed.length, Math.min(totalKills, 6));
  for (const k of b.events.killFeed) {
    assert.ok(k.killer && k.victim, "nombres vacíos");
    assert.notEqual(k.killerSide, k.victimSide, "matar a un aliado");
  }
});

test("Win Probability válida y coherente con los vivos", () => {
  const ahead = bs(withAlive(4, 1)).stats.winProb;     // ATK con ventaja
  assert.ok(ahead.atk > 0.5, "ATK con ventaja debería tener winprob>0.5");

  // Mismos vivos: plantar sube la probabilidad del ataque.
  const notPlanted = withAlive(3, 3);
  const planted = structuredClone(notPlanted);
  planted.spike.planted = true; planted.spike.plantedTick = planted.tick; planted.phase = "POSTPLANT";
  assert.ok(bs(planted).stats.winProb.atk > bs(notPlanted).stats.winProb.atk, "plantar no subió la winprob del ataque");
});

test("bandera de CLUTCH (1vX) y su ausencia en 5v5", () => {
  assert.equal(bs(withAlive(1, 3)).events.flags.clutch, true);
  assert.equal(bs(withAlive(1, 3)).events.flags.clutchSide, "ATK");
  assert.equal(bs(createRound(1, SETUP)).events.flags.clutch, false);
});

test("bandera de ACE (un jugador con 5 bajas)", () => {
  const s = withAlive(5, 0);
  const killer = s.players.find((p) => p.side === "ATK")!;
  for (let i = 0; i < 5; i++) {
    s.events.push({ tick: 10 + i, type: "kill", data: {
      by: killer.id, byName: killer.name, bySide: "ATK", victim: `DEF-${i}`, victimName: `def${i}`, held: false,
    } });
  }
  const b = bs(s);
  assert.equal(b.events.flags.ace, true);
  assert.equal(b.events.flags.aceBy, killer.name);
});

test("cambio de estado de ronda y marcador al terminar", () => {
  const s = structuredClone(createRound(1, SETUP));
  s.winner = "ATK"; s.phase = "ENDED";
  const b = bs(s);
  assert.equal(b.match.score.atk, 1);
  assert.equal(b.match.score.def, 0);
  assert.equal(b.match.phase, "ENDED");
  assert.ok(b.match.phaseLabel.length > 0);
});
