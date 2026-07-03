/**
 * Tests del Director de Realización (node:test, sin dependencias nuevas).
 * Ejecutar (tras compilar a JS): `node --test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRound, tick as simTick, type CoachSetup, type RoundState } from "../sim";
import { LiveDirector, liveInput } from "./director";
import type { CameraType } from "./types";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
const CAMERAS: CameraType[] = ["auto", "tactical", "player", "clutch", "plant", "defuse", "retake", "cinematic"];

function freshRound(): RoundState {
  return createRound(42, SETUP);
}

/** Estado artificial con N atacantes y M defensores vivos (para escenarios). */
function withAlive(atkN: number, defN: number): RoundState {
  const s = structuredClone(freshRound());
  s.phase = "EXECUTE";
  s.players.filter((p) => p.side === "ATK").forEach((p, i) => { p.alive = i < atkN; });
  s.players.filter((p) => p.side === "DEF").forEach((p, i) => { p.alive = i < defN; });
  return s;
}

test("siempre devuelve una decisión válida durante toda la ronda", () => {
  const dir = new LiveDirector();
  let s = freshRound();
  const ids = new Set(s.players.map((p) => p.id));
  for (let i = 0; i < 2000 && s.phase !== "ENDED"; i++) {
    const d = dir.decide(liveInput(s));
    assert.ok(d.priority >= 0 && d.priority <= 100, `prioridad fuera de rango: ${d.priority}`);
    assert.ok(CAMERAS.includes(d.camera), `cámara inválida: ${d.camera}`);
    assert.ok(typeof d.reason === "string" && d.reason.length > 0, "razón vacía");
    assert.ok(d.focusPlayerId === null || ids.has(d.focusPlayerId), "foco inexistente");
    assert.ok(d.expectedHoldTicks > 0, "duración prevista inválida");
    s = simTick(s);
  }
});

test("el Director NUNCA modifica el estado (independencia)", () => {
  const dir = new LiveDirector();
  const s = withAlive(1, 3);
  const before = JSON.stringify(s);
  dir.decide(liveInput(s));
  assert.equal(JSON.stringify(s), before, "el estado fue mutado por el Director");
});

test("un clutch SIEMPRE tiene más prioridad que un default", () => {
  const dClutch = new LiveDirector();
  const dDefault = new LiveDirector();
  const clutch = dClutch.decide(liveInput(withAlive(1, 3)));
  const def = dDefault.decide(liveInput(freshRound())); // SETUP, sin contacto

  assert.equal(clutch.situation, "clutch", `esperado clutch, fue ${clutch.situation}`);
  assert.equal(clutch.camera, "clutch");
  assert.ok(clutch.priority > def.priority, `clutch(${clutch.priority}) no supera default(${def.priority})`);
});

test("la prioridad del clutch escala con la desventaja (1v3 > 1v1)", () => {
  const a = new LiveDirector().decide(liveInput(withAlive(1, 1)));
  const b = new LiveDirector().decide(liveInput(withAlive(1, 3)));
  assert.ok(b.priority > a.priority, `1v3(${b.priority}) debería superar a 1v1(${a.priority})`);
});

test("los lulls / fases tácticas dan prioridad baja", () => {
  const d = new LiveDirector().decide(liveInput(freshRound()));
  assert.equal(d.tier, "tactical");
  assert.ok(d.priority < 60, `prioridad táctica demasiado alta: ${d.priority}`);
});

test("la decisión es consistente (mismo estado ⇒ misma prioridad)", () => {
  const s = withAlive(1, 3);
  const x = new LiveDirector().decide(liveInput(s));
  const y = new LiveDirector().decide(liveInput(s));
  assert.equal(x.situation, y.situation);
  assert.equal(x.priority, y.priority);
  assert.equal(x.focusPlayerId, y.focusPlayerId);
});

test("NO cambia de objetivo constantemente (memoria/histéresis)", () => {
  const dir = new LiveDirector();
  let s = freshRound();
  let ticks = 0;
  for (let i = 0; i < 2000 && s.phase !== "ENDED"; i++) {
    dir.decide(liveInput(s));
    s = simTick(s);
    ticks++;
  }
  const switches = dir.debugLog.length;
  // Un observer pro corta pocas veces: muy por debajo de "uno por tick".
  assert.ok(switches >= 1, "no tomó ninguna decisión");
  assert.ok(switches < ticks / 10, `demasiados cambios de foco: ${switches} en ${ticks} ticks`);

  // Y los cambios consecutivos no se amontonan (salvo interrupciones duras por muertes).
  const log = dir.debugLog;
  let tooClose = 0;
  for (let i = 1; i < log.length; i++) {
    if (log[i].tick - log[i - 1].tick < 5) tooClose++;
  }
  const kills = s.events.filter((e) => e.type === "kill").length;
  assert.ok(tooClose <= kills + 1, `cortes demasiado seguidos: ${tooClose} (kills=${kills})`);
});

test("reset() limpia la memoria", () => {
  const dir = new LiveDirector();
  dir.decide(liveInput(withAlive(1, 3)));
  assert.ok(dir.debugLog.length > 0);
  dir.reset();
  assert.equal(dir.debugLog.length, 0);
});
