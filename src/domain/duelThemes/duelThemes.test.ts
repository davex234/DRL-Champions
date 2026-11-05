/** F71 · TEMÁTICAS DE DUELO — selección pura y validación. */
import test from "node:test";
import assert from "node:assert/strict";
import { CODE_DEFAULT_THEME, inWindow, selectDuelTheme, validateThemeInput, themeMetaOf, type DuelThemeRecord } from "./index";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const T = (over: Partial<DuelThemeRecord>): DuelThemeRecord => ({
  id: over.slug ?? "x", slug: "x", name: "Tema", status: "active", startAt: null, endAt: null, priority: 0, isDefault: false, rev: 1,
  assetStatus: "approved", wide: `https://cdn/${over.slug ?? "x"}.webp`, narrow: `https://cdn/${over.slug ?? "x"}-960.webp`, ...over,
});

test("F71 THEMES 01 · sin temas → DEFAULT de código (la arena de siempre)", () => {
  assert.deepEqual(selectDuelTheme([], NOW), CODE_DEFAULT_THEME);
  assert.equal(CODE_DEFAULT_THEME.wide, "/game/arenas/nexus-champions/stage-1920.webp");
});

test("F71 THEMES 02 · evento activo en fechas gana al default", () => {
  const r = selectDuelTheme([T({ slug: "base", isDefault: true }), T({ slug: "champions", startAt: "2026-09-30T00:00:00Z", endAt: "2026-10-05T00:00:00Z" })], NOW);
  assert.equal(r.slug, "champions"); assert.equal(r.source, "event");
});

test("F71 THEMES 03 · evento caducado o futuro no aplica → default del panel", () => {
  const themes = [T({ slug: "base", isDefault: true }), T({ slug: "old", endAt: "2026-09-01T00:00:00Z" }), T({ slug: "future", startAt: "2026-11-01T00:00:00Z" })];
  const r = selectDuelTheme(themes, NOW);
  assert.equal(r.slug, "base"); assert.equal(r.source, "panel-default");
  assert.equal(inWindow({ startAt: null, endAt: "2026-10-01T12:00:00Z" }, NOW), false, "el fin es exclusivo");
});

test("F71 THEMES 04 · prioridad decide entre eventos; empate → inicio más reciente → slug", () => {
  assert.equal(selectDuelTheme([T({ slug: "a", priority: 1 }), T({ slug: "b", priority: 5 })], NOW).slug, "b");
  assert.equal(selectDuelTheme([T({ slug: "a", startAt: "2026-09-01T00:00:00Z" }), T({ slug: "b", startAt: "2026-09-20T00:00:00Z" })], NOW).slug, "b");
  assert.equal(selectDuelTheme([T({ slug: "b" }), T({ slug: "a" })], NOW).slug, "a");
  // Determinista: el orden de entrada no cambia el resultado.
  const xs = [T({ slug: "m", priority: 3 }), T({ slug: "n", priority: 3 }), T({ slug: "o", priority: 2 })];
  assert.equal(selectDuelTheme(xs, NOW).slug, selectDuelTheme([...xs].reverse(), NOW).slug);
});

test("F71 THEMES 05 · desactivado, asset no aprobado o sin URL → no es candidato (cae al siguiente)", () => {
  assert.equal(selectDuelTheme([T({ slug: "off", status: "inactive", priority: 9 })], NOW).source, "code-default");
  assert.equal(selectDuelTheme([T({ slug: "arch", assetStatus: "archived", priority: 9 })], NOW).source, "code-default");
  assert.equal(selectDuelTheme([T({ slug: "gone", wide: null, priority: 9 }), T({ slug: "base", isDefault: true })], NOW).slug, "base");
  assert.equal(selectDuelTheme([T({ slug: "base", isDefault: true, status: "inactive" })], NOW).source, "code-default");
});

test("F71 THEMES 06 · fechas corruptas nunca activan un tema", () => {
  assert.equal(selectDuelTheme([T({ slug: "bad", startAt: "not-a-date", priority: 9 })], NOW).source, "code-default");
});

test("F71 THEMES 07 · validación de la entrada del panel", () => {
  assert.equal(validateThemeInput({ slug: "champions-2026", name: "Champions 2026", status: "active", priority: 10 }).ok, true);
  for (const bad of [
    { slug: "default", name: "X Y", status: "active" }, { slug: "Bad Slug", name: "X Y", status: "active" }, { slug: "ok", name: "<script>", status: "active" },
    { slug: "ok", name: "Ok", status: "live" }, { slug: "ok", name: "Ok", status: "active", priority: 5000 },
    { slug: "ok", name: "Ok", status: "active", startAt: "2026-10-05T00:00:00Z", endAt: "2026-10-01T00:00:00Z" },
    { slug: "ok", name: "Ok", status: "active", isDefault: true, startAt: "2026-10-01T00:00:00Z" },
  ]) assert.equal(validateThemeInput(bad).ok, false, JSON.stringify(bad));
  assert.equal(themeMetaOf({ derived: {} }), null, "un fondo sin meta de tema no es tema");
});
