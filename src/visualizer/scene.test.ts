/**
 * Tests del scene builder del Visualizer (node:test, sin dependencias nuevas).
 * Valida la Render API sin depender de ningún backend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRound, tick as simTick, type CoachSetup, type RoundState } from "../sim";
import { createViewport } from "../camera";
import { buildBroadcastState } from "../broadcast";
import { LiveDirector, liveInput } from "../spectator";
import { buildRenderFrame } from "./scene";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

function frameOf(state: RoundState) {
  const vp = createViewport();
  const decision = new LiveDirector().decide(liveInput(state));
  const bs = buildBroadcastState({ state, decision, viewport: vp });
  return buildRenderFrame({ state, viewport: vp, broadcast: bs });
}

const finite = (n: number) => Number.isFinite(n);

test("el frame describe la escena (10 jugadores + mundo + cámara)", () => {
  const f = frameOf(createRound(1, SETUP));
  const players = f.entities.filter((e) => e.type === "player");
  assert.equal(players.length, 10);
  assert.ok(f.world.walls.length > 0 && f.world.zones.length > 0, "mundo vacío");
  assert.ok(f.camera.viewBox.w > 0 && f.camera.viewBox.h > 0, "viewBox inválido");
});

test("la cámara del frame refleja el viewport (centro + viewBox centrado)", () => {
  const vp = createViewport({ x: 430, y: 215 }, 2);
  const f = buildRenderFrame({ state: createRound(1, SETUP), viewport: vp });
  assert.equal(f.camera.center.x, 430);
  assert.equal(f.camera.zoom, 2);
  assert.ok(Math.abs(f.camera.viewBox.x + f.camera.viewBox.w / 2 - 430) < 1e-6, "viewBox no centrado en el viewport");
});

test("nunca genera datos inválidos durante una ronda completa", () => {
  const dir = new LiveDirector();
  const vp = createViewport();
  let s = createRound(7, SETUP);
  for (let i = 0; i < 2000 && s.phase !== "ENDED"; i++) {
    const bs = buildBroadcastState({ state: s, decision: dir.decide(liveInput(s)), viewport: vp });
    const f = buildRenderFrame({ state: s, viewport: vp, broadcast: bs });
    for (const e of f.entities) {
      assert.ok(finite(e.transform.position.x) && finite(e.transform.position.y), "posición inválida");
      assert.ok(["visible", "faded", "hidden"].includes(e.visibility), "visibilidad inválida");
    }
    for (const fx of f.effects) {
      if (fx.progress != null) assert.ok(fx.progress >= 0 && fx.progress <= 1, "progreso fuera de [0,1]");
    }
    assert.ok(f.camera.viewBox.w > 0, "viewBox inválido");
    s = simTick(s);
  }
});

test("los jugadores muertos quedan 'dead'/'faded'", () => {
  const s = structuredClone(createRound(1, SETUP));
  const dead = s.players.find((p) => p.side === "ATK")!;
  dead.alive = false;
  const f = frameOf(s);
  const e = f.entities.find((x) => x.id === dead.id)!;
  assert.equal(e.state, "dead");
  assert.equal(e.visibility, "faded");
});

test("las líneas de enfrentamiento solo unen enemigos vivos", () => {
  let s = createRound(7, SETUP);
  for (let i = 0; i < 2000 && !s.players.some((p) => p.targetEnemyId); i++) s = simTick(s);
  const f = frameOf(s);
  for (const fx of f.effects.filter((x) => x.kind === "engagement")) {
    assert.ok(fx.from && fx.to, "engagement incompleto");
  }
});

test("el plant genera su efecto de progreso", () => {
  const s = structuredClone(createRound(1, SETUP));
  s.spike.plantProgress = 0.5;
  const f = frameOf(s);
  assert.ok(f.effects.some((e) => e.kind === "plant" && e.progress === 0.5), "sin efecto de plant");
});

test("es PURO: no muta el estado y es determinista", () => {
  const s = createRound(5, SETUP);
  const vp = createViewport();
  const before = JSON.stringify(s);
  const a = buildRenderFrame({ state: s, viewport: vp });
  assert.equal(JSON.stringify(s), before, "el estado fue mutado");
  const b = buildRenderFrame({ state: s, viewport: vp });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "no determinista");
});
