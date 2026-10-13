import test from "node:test";
import assert from "node:assert/strict";
import {
  packLifecycle, isPurchasable, isStoreVisible, isPubliclyOpenable, isHistoricallyResolvable,
  guardPurchase, guardPublicOpen,
} from "./lifecycle";
import type { PackDef } from "./types";

/** Un PackDef mínimo con el estado que se quiera probar. */
function mk(over: Partial<PackDef>): PackDef {
  return {
    id: "x", name: "X", description: "", price: 100, cardCount: 5,
    weights: { common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
    accent: "#fff", ...over,
  };
}

const DRAFT = mk({ lifecycle: "DRAFT" });
const ACTIVE = mk({ lifecycle: "ACTIVE" });
const RETIRED = mk({ lifecycle: "RETIRED" });

// ─────────────────────────── DERIVACIÓN Y RETROCOMPAT ───────────────────────────
test("packLifecycle deriva el estado y respeta retired (retrocompatible)", () => {
  assert.equal(packLifecycle(DRAFT), "DRAFT");
  assert.equal(packLifecycle(ACTIVE), "ACTIVE");
  assert.equal(packLifecycle(RETIRED), "RETIRED");
  // Sin lifecycle: retired manda.
  assert.equal(packLifecycle(mk({})), "ACTIVE", "por defecto ACTIVE");
  assert.equal(packLifecycle(mk({ retired: true })), "RETIRED", "retired:true ⇒ RETIRED");
  assert.equal(packLifecycle(mk({ retired: false })), "ACTIVE");
  // lifecycle explícito gana sobre retired si coexistieran.
  assert.equal(packLifecycle(mk({ lifecycle: "ACTIVE", retired: true })), "ACTIVE");
});

// ─────────────────────────── PREDICADOS ───────────────────────────
test("predicados de estado: comprable / visible / abrible / resoluble", () => {
  // ACTIVE: todo.
  assert.ok(isPurchasable(ACTIVE) && isStoreVisible(ACTIVE) && isPubliclyOpenable(ACTIVE));
  // DRAFT: nada público.
  assert.ok(!isPurchasable(DRAFT) && !isStoreVisible(DRAFT) && !isPubliclyOpenable(DRAFT));
  // RETIRED: no comprable, no en tienda, pero abrible (histórico).
  assert.ok(!isPurchasable(RETIRED) && !isStoreVisible(RETIRED) && isPubliclyOpenable(RETIRED));
  // Resoluble para histórico: los tres estados sí; inexistente no.
  for (const p of [DRAFT, ACTIVE, RETIRED]) assert.ok(isHistoricallyResolvable(p));
  assert.ok(!isHistoricallyResolvable(undefined));
});

// ─────────────────────────── GUARDA DE COMPRA ───────────────────────────
test("guardPurchase — solo ACTIVE compra; DRAFT 404, RETIRED 409, inexistente 404", () => {
  assert.deepEqual(guardPurchase(ACTIVE), { ok: true });
  assert.deepEqual(guardPurchase(DRAFT), { ok: false, reason: "Sobre no encontrado", status: 404 });
  const r = guardPurchase(RETIRED);
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 409);
  assert.deepEqual(guardPurchase(undefined), { ok: false, reason: "Sobre no encontrado", status: 404 });
  // El sobre heredado con retired:true se rechaza como RETIRED.
  assert.equal((guardPurchase(mk({ retired: true })) as { status: number }).status, 409);
});

// ─────────────────────────── GUARDA DE APERTURA PÚBLICA ───────────────────────────
test("guardPublicOpen — ACTIVE y RETIRED sí; DRAFT 404; inexistente 404", () => {
  assert.deepEqual(guardPublicOpen(ACTIVE), { ok: true });
  assert.deepEqual(guardPublicOpen(RETIRED), { ok: true }, "RETIRED abrible si se posee (histórico)");
  assert.deepEqual(guardPublicOpen(DRAFT), { ok: false, reason: "Sobre no encontrado", status: 404 });
  assert.deepEqual(guardPublicOpen(undefined), { ok: false, reason: "Sobre no encontrado", status: 404 });
});

// ─────────────────────────── DETERMINISMO / TOTALIDAD ───────────────────────────
test("las guardas son totales y deterministas para los tres estados y el inexistente", () => {
  for (const p of [DRAFT, ACTIVE, RETIRED, undefined]) {
    const a = JSON.stringify(guardPurchase(p));
    const b = JSON.stringify(guardPublicOpen(p));
    for (let i = 0; i < 3; i++) {
      assert.equal(JSON.stringify(guardPurchase(p)), a);
      assert.equal(JSON.stringify(guardPublicOpen(p)), b);
    }
  }
});
