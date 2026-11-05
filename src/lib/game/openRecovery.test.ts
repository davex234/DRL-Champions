/**
 * RECUPERACIÓN DE APERTURAS — `lib/game/openRecovery`.
 *
 * Los siete primeros casos son los de la Fase 21.2 (guardar/recuperar, packId distinto, vacío,
 * clear, TTL, JSON malformado, sobrescritura), reconstruidos a partir de su informe tras haberse
 * sobrescrito el fichero por error durante la Fase 25. Los tres últimos son de la Fase 25: el
 * gesto pendiente (un gesto por apertura; el reintento reutiliza el mismo; caduca).
 *
 * `window.sessionStorage` es de mentira; el módulo lo lee en cada llamada, no al importar.
 */
import test from "node:test";
import assert from "node:assert/strict";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    raw: m,
  };
}
const storage = fakeStorage();
(globalThis as unknown as { window: unknown }).window = { sessionStorage: storage };

import * as mod from "./openRecovery";
import type { OpenedResult } from "@/store/useGameStore";

const result = (uid: string): OpenedResult => ({ uid, card: { id: `card-${uid}` } as never, isNew: true, value: 10 });

/* ─────────────── Fase 21.2 (reconstruidos) ─────────────── */

test("guardar/recuperar · lo guardado para un sobre vuelve tal cual", () => {
  mod.clearOpenReveal();
  const results = [result("a"), result("b")];
  mod.saveOpenReveal("estandar", results);
  assert.deepEqual(mod.loadOpenReveal("estandar"), results);
});

test("packId distinto · el revelado de un sobre no se recupera desde otro", () => {
  mod.saveOpenReveal("estandar", [result("a")]);
  assert.equal(mod.loadOpenReveal("premium"), null);
});

test("vacío · un resultado sin cartas no se guarda y sin nada guardado se devuelve null", () => {
  mod.clearOpenReveal();
  mod.saveOpenReveal("estandar", []);
  assert.equal(storage.getItem("drl-open-reveal"), null);
  assert.equal(mod.loadOpenReveal("estandar"), null);
});

test("clear · después de limpiar no queda nada que recuperar", () => {
  mod.saveOpenReveal("estandar", [result("a")]);
  mod.clearOpenReveal();
  assert.equal(mod.loadOpenReveal("estandar"), null);
});

test("TTL · un revelado de hace más de 10 minutos ha caducado y se limpia", () => {
  storage.setItem("drl-open-reveal", JSON.stringify({ packId: "estandar", results: [result("a")], at: Date.now() - 11 * 60_000 }));
  assert.equal(mod.loadOpenReveal("estandar"), null);
  assert.equal(storage.getItem("drl-open-reveal"), null, "caducado → borrado");
});

test("JSON malformado · un valor corrupto en sessionStorage no rompe: se devuelve null", () => {
  storage.setItem("drl-open-reveal", "{esto no es json");
  assert.equal(mod.loadOpenReveal("estandar"), null);
  storage.setItem("drl-open-reveal", JSON.stringify({ packId: "estandar", results: "no-array", at: Date.now() }));
  assert.equal(mod.loadOpenReveal("estandar"), null);
});

test("sobrescritura · guardar otra apertura sustituye a la anterior (solo se recupera la última)", () => {
  mod.saveOpenReveal("estandar", [result("vieja")]);
  mod.saveOpenReveal("premium", [result("nueva")]);
  assert.equal(mod.loadOpenReveal("estandar"), null);
  assert.deepEqual(mod.loadOpenReveal("premium"), [result("nueva")]);
});

/* ─────────────── Fase 25 · gesto pendiente ─────────────── */

test("10 · el gesto es único por apertura y se guarda ANTES de pedir; el reintento devuelve el mismo", () => {
  mod.clearPendingOpen();
  const g1 = mod.newOpenGesture();
  const g2 = mod.newOpenGesture();
  assert.notEqual(g1, g2);
  assert.match(g1, /^[\w-]{1,128}$/, "cabe en la validación de `ref` de la ruta");
  mod.savePendingOpen("estandar", g1);
  assert.equal(mod.loadPendingOpen("estandar"), g1, "reintentar = mismo gesto = misma apertura en el servidor");
  assert.equal(mod.loadPendingOpen("premium"), null, "un gesto es de UN sobre");
  mod.clearPendingOpen();
  assert.equal(mod.loadPendingOpen("estandar"), null);
});

test("11 · el revelado guardado sobrevive a la recarga y no se reabre: se restaura tal cual", () => {
  const results = [{ uid: "u1", card: { id: "c" } as never, isNew: true, value: 10 }];
  mod.saveOpenReveal("estandar", results as never);
  assert.deepEqual(mod.loadOpenReveal("estandar"), results);
  mod.clearOpenReveal();
});

test("12 · un gesto pendiente caducado (TTL 10 min) o corrupto no se reutiliza", () => {
  storage.setItem("drl-open-pending", JSON.stringify({ packId: "estandar", ref: "viejo", at: Date.now() - 11 * 60_000 }));
  assert.equal(mod.loadPendingOpen("estandar"), null);
  storage.setItem("drl-open-pending", "{no es json");
  assert.equal(mod.loadPendingOpen("estandar"), null);
});

/* ─────────────── Fase 40 · «Abrir el siguiente sobre» no enseña el resumen anterior ─────────────── */

test("F40-1 · un revelado VISTO no se recupera al llegar desde otra pantalla; sí al recargar la propia", () => {
  mod.clearOpenReveal();
  mod.saveOpenReveal("inicial", [result("a"), result("b")]);
  assert.equal(mod.loadOpenReveal("inicial", { allowSeen: false })?.length, 2, "sin ver el resumen (recarga a mitad) se recupera siempre");
  mod.markOpenRevealSeen("inicial");
  assert.equal(mod.loadOpenReveal("inicial", { allowSeen: false }), null, "visto + llegada desde el vestíbulo → sobre sellado");
  assert.equal(mod.loadOpenReveal("inicial", { allowSeen: true })?.length, 2, "visto + recarga de la misma pantalla → resumen");
  assert.equal(mod.loadOpenReveal("inicial")?.length, 2, "por defecto se mantiene el comportamiento anterior");
});

test("F40-2 · marcar como visto solo afecta a ESE sobre y no reactiva nada caducado", () => {
  mod.clearOpenReveal();
  mod.saveOpenReveal("estandar", [result("c")]);
  mod.markOpenRevealSeen("inicial");
  assert.equal(mod.loadOpenReveal("estandar", { allowSeen: false })?.length, 1);
  mod.clearOpenReveal();
  mod.markOpenRevealSeen("estandar");
  assert.equal(mod.loadOpenReveal("estandar"), null);
});

test("F40-3 · sin Navigation Timing (servidor / tests) no se considera recarga", () => {
  assert.equal(mod.isReloadOf("/abrir/inicial"), false, "Node no tiene entrada de navegación: nunca es recarga");
  const real = globalThis.performance;
  const fake = (type: string, name: string) => ({ getEntriesByType: () => [{ type, name }] }) as unknown as Performance;
  try {
    Object.defineProperty(globalThis, "performance", { value: fake("reload", "http://127.0.0.1:3005/abrir/inicial"), configurable: true });
    assert.equal(mod.isReloadOf("/abrir/inicial"), true, "recarga de la propia pantalla");
    assert.equal(mod.isReloadOf("/abrir/estandar"), false, "recarga de otra ruta");
    Object.defineProperty(globalThis, "performance", { value: fake("reload", "http://127.0.0.1:3005/"), configurable: true });
    assert.equal(mod.isReloadOf("/abrir/inicial"), false, "recargó el vestíbulo y llegó por navegación del cliente");
    Object.defineProperty(globalThis, "performance", { value: fake("navigate", "http://127.0.0.1:3005/abrir/inicial"), configurable: true });
    assert.equal(mod.isReloadOf("/abrir/inicial"), false, "llegada escribiendo la URL");
  } finally {
    Object.defineProperty(globalThis, "performance", { value: real, configurable: true });
  }
});
