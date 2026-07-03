/**
 * Tests del Viewport Renderer (node:test, sin dependencias nuevas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRound, tick as simTick, FIELD, type CoachSetup } from "../sim";
import { LiveDirector, liveInput } from "../spectator";
import { createViewport, updateCamera } from "../camera";
import { toViewBox, viewBoxString, isVisible } from "./svgCamera";

const DT = 0.05;
const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
const ASPECT = FIELD.w / FIELD.h;

test("el viewBox es válido y mantiene el aspecto del campo a cualquier zoom", () => {
  for (const zoom of [0.8, 1, 1.5, 2.6, 4]) {
    const vp = createViewport({ x: 500, y: 350 }, zoom);
    const b = toViewBox(vp);
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0 && b.h > 0, "viewBox inválido");
    assert.ok(Math.abs(b.w / b.h - ASPECT) < 1e-6, `aspecto roto a zoom ${zoom}`);
  }
});

test("el zoom mantiene el foco (centro) visible y centrado", () => {
  const vp = createViewport({ x: 430, y: 215 }, 3.2);
  const b = toViewBox(vp);
  assert.ok(isVisible(vp, vp.center), "el centro no es visible");
  assert.ok(Math.abs((b.x + b.w / 2) - vp.center.x) < 1e-6, "centro X descuadrado");
  assert.ok(Math.abs((b.y + b.h / 2) - vp.center.y) < 1e-6, "centro Y descuadrado");
});

test("es independiente del tamaño de pantalla (función pura del viewport)", () => {
  const vp = createViewport({ x: 600, y: 300 }, 2);
  assert.equal(viewBoxString(vp), viewBoxString(vp)); // determinista
  // No recibe ningún parámetro de pantalla: el mismo viewport ⇒ el mismo viewBox.
  const a = toViewBox(vp);
  const b = toViewBox({ ...vp });
  assert.deepEqual(a, b);
});

test("NO hay saltos en el viewBox durante una ronda real (cámara suave)", () => {
  const dir = new LiveDirector();
  let s = createRound(7, SETUP);
  let vp = createViewport();
  let prev = toViewBox(vp);
  // Cota: el centro no puede moverse más que MAX_SPEED·dt por paso ⇒ el viewBox tampoco.
  const maxCenterStep = 1600 * DT * 1.1 + 1;
  for (let i = 0; i < 2000 && s.phase !== "ENDED"; i++) {
    const decision = dir.decide(liveInput(s));
    vp = updateCamera(vp, { decision, state: s, dt: DT });
    const b = toViewBox(vp);
    const cxPrev = prev.x + prev.w / 2, cyPrev = prev.y + prev.h / 2;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    assert.ok(Math.hypot(cx - cxPrev, cy - cyPrev) <= maxCenterStep, `salto de encuadre en ${i}`);
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0, "viewBox inválido en ronda");
    prev = b;
    s = simTick(s);
  }
});

test("a zoom 1 el encuadre cubre el campo completo", () => {
  const vp = createViewport({ x: FIELD.w / 2, y: FIELD.h / 2 }, 1);
  const b = toViewBox(vp);
  assert.ok(Math.abs(b.w - FIELD.w) < 1e-6 && Math.abs(b.h - FIELD.h) < 1e-6, "no cubre el campo a zoom 1");
  assert.ok(Math.abs(b.x) < 1e-6 && Math.abs(b.y) < 1e-6, "origen incorrecto a zoom 1");
});
