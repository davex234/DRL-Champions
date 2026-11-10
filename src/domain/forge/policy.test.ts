/**
 * F79.1 · POLÍTICA DE CAMBIOS DE PROGRESIÓN — una edición normal no puede bajar a nadie; lo regresivo se detecta, y las
 * ventanas de los objetivos hacen que retirar congele y reactivar no regale el pasado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FORGE_CONFIG } from "./defaults";
import type { ForgeConfig } from "./types";
import { progressionRegressions, stampWindows } from "./policy";
import { forgeXp, levelFromXp, EMPTY_INVENTORY, type CraftOpFact } from "./progression";
import { objectivesCompleted } from "./objectives";

const live = (): ForgeConfig => ({
  ...DEFAULT_FORGE_CONFIG,
  chains: DEFAULT_FORGE_CONFIG.chains.map((c) => ({ ...c, status: "ACTIVE" })),
  recipes: DEFAULT_FORGE_CONFIG.recipes.map((r) => ({ ...r, status: "ACTIVE" })),
  blueprints: DEFAULT_FORGE_CONFIG.blueprints.map((b) => ({ ...b, status: "ACTIVE" })),
  objectives: DEFAULT_FORGE_CONFIG.objectives.map((o) => ({ ...o, status: "ACTIVE", activeWindows: [{ from: 0, to: null }] })),
});
const codes = (a: ForgeConfig, b: ForgeConfig) => progressionRegressions(a, b).map((r) => r.code).sort();

test("F79.1 R1 · cambios MONÓTONOS (más XP, curva más suave, más niveles, umbrales más bajos, contenido nuevo) se aceptan sin más", () => {
  const a = live();
  assert.deepEqual(codes(a, a), [], "sin cambios: nada");
  const b: ForgeConfig = {
    ...a,
    xp: { ...a.xp, craftPack: a.xp.craftPack + 5 },
    curve: { ...a.curve, growth: 1.1, maxLevel: a.curve.maxLevel + 10 },
    mastery: a.mastery.map((m) => ({ ...m, thresholds: [...m.thresholds.map((t) => Math.max(1, t - 1)), 999] })),
    chains: [...a.chains, { id: "nueva", name: "Nueva", description: "", status: "DRAFT", steps: [] }],
  };
  assert.deepEqual(codes(a, b), []);
});

test("F79.1 R2 · cada cambio REGRESIVO se detecta (y nombra qué y dónde)", () => {
  const a = live();
  assert.deepEqual(codes(a, { ...a, xp: { ...a.xp, craftCard: 10 } }), ["XP_LOWERED"]);
  assert.deepEqual(codes(a, { ...a, curve: { ...a.curve, base: 150 } }), ["CURVE_HARDER"]);
  assert.deepEqual(codes(a, { ...a, curve: { ...a.curve, maxLevel: 20 } }), ["MAX_LEVEL_LOWERED"]);
  assert.deepEqual(codes(a, { ...a, mastery: a.mastery.map((m, i) => (i === 0 ? { ...m, thresholds: m.thresholds.map((t) => t + 1) } : m)) }), ["MASTERY_HARDER"]);
  assert.deepEqual(codes(a, { ...a, mastery: a.mastery.slice(1) }), ["MASTERY_REMOVED"]);
  assert.deepEqual(codes(a, { ...a, chains: a.chains.map((c) => ({ ...c, status: "DRAFT" })) }), ["CHAIN_REMOVED"]);
  assert.deepEqual(codes(a, { ...a, chains: a.chains.map((c) => ({ ...c, steps: c.steps.slice(0, 2) })) }), ["CHAIN_CHANGED"]);
  assert.deepEqual(codes(a, { ...a, objectives: a.objectives.map((o, i) => (i === 0 ? { ...o, target: o.target + 1 } : o)) }), ["OBJECTIVE_CHANGED"]);
  assert.deepEqual(codes(a, { ...a, objectives: a.objectives.slice(1) }), ["OBJECTIVE_REMOVED"]);
  assert.deepEqual(codes(a, { ...a, recipes: a.recipes.map((r, i) => (i === 0 ? { ...r, unlock: [{ type: "FORGE_LEVEL", min: 9 }] } : r)) }), ["UNLOCK_CHANGED"]);
  assert.deepEqual(codes(a, { ...a, blueprints: a.blueprints.map((b) => ({ ...b, source: { type: "FORGE_LEVEL", min: 30 } })) }), ["BLUEPRINT_CHANGED"]);
  // RETIRAR una cadena u objetivo NO es regresivo: siguen contando lo ya ganado (y el objetivo se congela).
  assert.deepEqual(codes(a, { ...a, chains: a.chains.map((c) => ({ ...c, status: "RETIRED" })), objectives: a.objectives.map((o) => ({ ...o, status: "RETIRED" })) }), []);
});

test("F79.1 R3 · la detección es SEGURA: si dice «monótono», ningún jugador baja de nivel (500 historiales aleatorios)", () => {
  const a = live();
  const b: ForgeConfig = { ...a, xp: { ...a.xp, craftAdvanced: a.xp.craftAdvanced + 40 }, curve: { ...a.curve, base: 90 } };
  assert.deepEqual(codes(a, b), []);
  let s = 7;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let i = 0; i < 500; i++) {
    const ops: CraftOpFact[] = Array.from({ length: Math.floor(r() * 80) }, (_, k) => ({ ref: `r${k}`, kind: r() < 0.5 ? "PACK" : "CARD", recipeId: r() < 0.2 ? "forge-ruta-oro" : "card-plata-oro", at: k * 3_600_000, inputs: [], outputs: [] }));
    const f = { ops, projectClaims: [], completedMissions: new Set<string>(), inventory: EMPTY_INVENTORY };
    const lv = (cfg: ForgeConfig) => levelFromXp(forgeXp(cfg, f, 0, objectivesCompleted(cfg, ops)).total, cfg.curve).level;
    assert.ok(lv(b) >= lv(a), `historial ${i}`);
  }
});

test("F79.1 R4 · ventanas del servidor: activar no regala el pasado, retirar CONGELA (ni pierde ni gana), reactivar abre otra ventana", () => {
  const draft: ForgeConfig = { ...DEFAULT_FORGE_CONFIG, objectives: [{ id: "o", name: "Diario", period: "DAILY", metric: "CRAFT_ANY", target: 1, reward: {}, status: "DRAFT" }] };
  const DAY = 86_400_000;
  const day = (n: number): CraftOpFact => ({ ref: `d${n}`, kind: "PACK", recipeId: "pack-estandar-premium", at: n * DAY + 1000, inputs: [], outputs: [] });
  const panelLies = { ...draft, objectives: [{ ...draft.objectives[0], status: "ACTIVE" as const, activeWindows: [{ from: 0, to: null }] }] };
  const on = stampWindows(draft, panelLies, 10 * DAY);
  assert.deepEqual(on.objectives[0].activeWindows, [{ from: 10 * DAY, to: null }], "lo que mande el panel se ignora: el servidor sella");
  const ops = Array.from({ length: 30 }, (_, n) => day(n));
  assert.equal(objectivesCompleted(on, ops.slice(0, 10)), 0, "activar el día 10 no cuenta los días 0–9");
  const off = stampWindows(on, { ...on, objectives: [{ ...on.objectives[0], status: "RETIRED" }] }, 15 * DAY);
  assert.equal(objectivesCompleted(off, ops), 5, "retirado el día 15: cuentan los días 10–14, ni uno más");
  assert.deepEqual(progressionRegressions(on, off), [], "retirar no es regresivo");
  const again = stampWindows(off, { ...off, objectives: [{ ...off.objectives[0], status: "ACTIVE" }] }, 20 * DAY);
  assert.equal(objectivesCompleted(again, ops), 5 + 10, "reactivado el día 20: + días 20–29, sin los 15–19");
  assert.deepEqual(progressionRegressions(off, again), []);
});
