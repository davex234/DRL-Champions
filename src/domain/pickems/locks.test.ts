/** F87 · cierre puro (espejo de `pickem_match_locked`): frontera, reprogramación, anulación, política de fase. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveLockAt, isLockedAt, type LockInput } from "./locks";

const T0 = Date.parse("2030-01-01T10:00:00.000Z");
const iso = (n: number) => new Date(n).toISOString();
const base: LockInput = { bracketStatus: "PUBLISHED", lockPolicy: "MATCH", stageLockAt: null, lockAt: iso(T0), lockOverrideAt: null, voided: false, realStatus: "upcoming", realStart: iso(T0) };

test("frontera: −1 ms abierto, 0 cerrado, +1 ms cerrado", () => {
  assert.equal(isLockedAt(base, T0 - 1), false);
  assert.equal(isLockedAt(base, T0), true);
  assert.equal(isLockedAt(base, T0 + 1), true);
});

test("la fuente lo reprograma a MÁS TARDE: no reabre (manda el cierre congelado)", () => {
  const later = { ...base, realStart: iso(T0 + 3_600_000) };
  assert.equal(effectiveLockAt(later), T0);
  assert.equal(isLockedAt(later, T0 + 1), true);
});

test("la fuente lo adelanta: cierra antes", () => {
  const earlier = { ...base, realStart: iso(T0 - 600_000) };
  assert.equal(isLockedAt(earlier, T0 - 1), true);
});

test("reprogramación de admin: abre hasta su hora, nunca más tarde que el inicio real", () => {
  const re = { ...base, realStart: iso(T0 + 7_200_000), lockOverrideAt: iso(T0 + 3_600_000) };
  assert.equal(isLockedAt(re, T0 + 1), false);
  assert.equal(isLockedAt(re, T0 + 3_600_000), true);
  const capped = { ...base, realStart: iso(T0 + 600_000), lockOverrideAt: iso(T0 + 3_600_000) };
  assert.equal(isLockedAt(capped, T0 + 600_000), true);
});

test("estado real, anulación, ámbito no publicado, sin fila real y política de fase", () => {
  assert.equal(isLockedAt({ ...base, realStatus: "live" }, T0 - 99), true);
  assert.equal(isLockedAt({ ...base, voided: true }, T0 - 99), true);
  assert.equal(isLockedAt({ ...base, bracketStatus: "SETTLED" }, T0 - 99), true);
  assert.equal(isLockedAt({ ...base, realStatus: null }, T0 - 99), true);
  const stage = { ...base, lockPolicy: "STAGE" as const, stageLockAt: iso(T0 - 1000), realStart: iso(T0 + 10_000), lockAt: iso(T0 + 10_000) };
  assert.equal(isLockedAt(stage, T0 - 1000), true);
  assert.equal(isLockedAt(stage, T0 - 1001), false);
});
