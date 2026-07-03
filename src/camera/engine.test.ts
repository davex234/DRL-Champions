/**
 * Tests del Camera Engine (node:test, sin dependencias nuevas).
 * Ejecutar (tras compilar a JS): `node --test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRound, tick as simTick, ZONES, FIELD, type CoachSetup } from "../sim";
import { LiveDirector, liveInput, type DirectorDecision } from "../spectator";
import { createViewport, updateCamera, ZOOM, MAX_SPEED, MAX_ZOOM_SPEED } from "./index";
import { vdist, vlen } from "./viewport";

const DT = 0.05; // 20 fps
const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

function dec(p: Partial<DirectorDecision>): DirectorDecision {
  return {
    focusPlayerId: null, focusZone: "site", priority: 50, camera: "tactical",
    situation: "default", tier: "tactical", reason: "t", sinceTick: 0, expectedHoldTicks: 40, ...p,
  };
}
const finite = (n: number) => Number.isFinite(n);
const validVp = (vp: ReturnType<typeof createViewport>) =>
  finite(vp.center.x) && finite(vp.center.y) && finite(vp.zoom) && finite(vp.velocity.x) && finite(vp.velocity.y);

test("la cámara CONVERGE a un objetivo estático", () => {
  let vp = createViewport();
  const state = createRound(1, SETUP);
  const d = dec({ focusZone: "site", camera: "tactical" });
  for (let i = 0; i < 400; i++) vp = updateCamera(vp, { decision: d, state, dt: DT });
  assert.ok(vdist(vp.center, ZONES.site) < 5, `no convergió: dist ${vdist(vp.center, ZONES.site).toFixed(1)}`);
  assert.ok(vlen(vp.velocity) < 5, `no se detuvo: vel ${vlen(vp.velocity).toFixed(1)}`);
});

test("nunca genera posiciones inválidas ni sale de límites (ronda completa)", () => {
  const dir = new LiveDirector();
  let s = createRound(7, SETUP);
  let vp = createViewport();
  for (let i = 0; i < 2000 && s.phase !== "ENDED"; i++) {
    const decision = dir.decide(liveInput(s));
    vp = updateCamera(vp, { decision, state: s, dt: DT });
    assert.ok(validVp(vp), `viewport inválido en paso ${i}`);
    assert.ok(vp.center.x >= 0 && vp.center.x <= FIELD.w, "centro X fuera del campo");
    assert.ok(vp.center.y >= 0 && vp.center.y <= FIELD.h, "centro Y fuera del campo");
    assert.ok(vp.zoom >= ZOOM.min && vp.zoom <= ZOOM.max, `zoom fuera de límites: ${vp.zoom}`);
    s = simTick(s);
  }
});

test("NO hay saltos bruscos (desplazamiento por paso acotado)", () => {
  const dir = new LiveDirector();
  let s = createRound(13, SETUP);
  let vp = createViewport();
  const maxStep = MAX_SPEED * DT * 1.05 + 1;
  const maxZStep = MAX_ZOOM_SPEED * DT * 1.05 + 0.01;
  for (let i = 0; i < 2000 && s.phase !== "ENDED"; i++) {
    const decision = dir.decide(liveInput(s));
    const prev = vp;
    vp = updateCamera(vp, { decision, state: s, dt: DT });
    assert.ok(vdist(vp.center, prev.center) <= maxStep, `salto de centro: ${vdist(vp.center, prev.center).toFixed(1)}`);
    assert.ok(Math.abs(vp.zoom - prev.zoom) <= maxZStep, `salto de zoom: ${Math.abs(vp.zoom - prev.zoom).toFixed(3)}`);
    s = simTick(s);
  }
});

test("las transiciones son estables (objetivos alternos extremos)", () => {
  let vp = createViewport();
  const state = createRound(2, SETUP);
  const A = dec({ focusZone: "atk_spawn", camera: "tactical" });
  const B = dec({ focusZone: "def_spawn", camera: "player" });
  for (let i = 0; i < 300; i++) {
    vp = updateCamera(vp, { decision: i % 20 < 10 ? A : B, state, dt: DT });
    assert.ok(validVp(vp), `inestable en ${i}`);
    assert.ok(vp.center.x >= 0 && vp.center.x <= FIELD.w && vp.center.y >= 0 && vp.center.y <= FIELD.h, "fuera de campo");
    assert.ok(vp.zoom >= ZOOM.min && vp.zoom <= ZOOM.max, "zoom fuera de rango");
  }
});

test("el zoom siempre permanece dentro de límites bajo objetivos cambiantes", () => {
  let vp = createViewport();
  const state = createRound(3, SETUP);
  const cams = ["tactical", "player", "clutch", "cinematic", "plant"] as const;
  for (let i = 0; i < 500; i++) {
    vp = updateCamera(vp, { decision: dec({ camera: cams[i % cams.length] }), state, dt: DT });
    assert.ok(vp.zoom >= ZOOM.min && vp.zoom <= ZOOM.max, `zoom ${vp.zoom} fuera de límites`);
  }
});

test("la semántica de zoom respeta la cámara (clutch más cerca que tactical)", () => {
  const state = createRound(4, SETUP);
  const settle = (camera: DirectorDecision["camera"]) => {
    let vp = createViewport();
    const d = dec({ focusZone: "site", camera });
    for (let i = 0; i < 400; i++) vp = updateCamera(vp, { decision: d, state, dt: DT });
    return vp.zoom;
  };
  assert.ok(settle("clutch") > settle("tactical"), "clutch debería acercar más que tactical");
});

test("es PURA: no muta la entrada y es determinista", () => {
  const vp = createViewport();
  const state = createRound(5, SETUP);
  const d = dec({ focusZone: "site", camera: "player" });
  const before = JSON.stringify(vp);
  const a = updateCamera(vp, { decision: d, state, dt: DT });
  assert.equal(JSON.stringify(vp), before, "updateCamera mutó la entrada");
  const b = updateCamera(vp, { decision: d, state, dt: DT });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "no determinista");
});
