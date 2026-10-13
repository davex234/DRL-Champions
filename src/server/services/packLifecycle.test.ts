import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buyPack, openPackForUser, buyAndOpen, type PackResolver } from "./packs";
import { getPack, PACKS } from "@/data/packs";
import { packLifecycle } from "@/domain/packs/lifecycle";
import type { PackDef } from "@/domain/packs/types";

/**
 * PRUEBA DE SERVIDOR del ciclo de vida (Fase 20.4). Demuestra que la protección vive en el
 * SERVICIO, no en React: un `SupabaseClient` que lanza en cuanto se le toca separa dos casos con
 * total claridad —
 *
 *   · GUARDA RECHAZA  → la función devuelve un `ServiceResult` de error y **nunca toca la BD**
 *                       (no salta el sentinel).
 *   · GUARDA PASA     → la función llega a la BD y salta el sentinel (prueba de que superó el
 *                       estado del producto y procede a la operación real).
 *
 * Así se comprueba el rechazo ANTES de cualquier RPC/lectura, que es lo que pide §SEGURIDAD.
 */
const SENTINEL = "SB_TOCADO";
const throwingSb = new Proxy(
  {},
  { get() { throw new Error(SENTINEL); }, apply() { throw new Error(SENTINEL); } },
) as unknown as SupabaseClient;

function mk(over: Partial<PackDef>): PackDef {
  return {
    id: "x", name: "X", description: "", price: 100, cardCount: 5,
    weights: { common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
    accent: "#fff", ...over,
  };
}

// Catálogo sintético con los tres estados. NO se añade a PACKS: se inyecta por el resolutor.
const CATALOG: Record<string, PackDef> = {
  draft: mk({ id: "draft", lifecycle: "DRAFT" }),
  active: mk({ id: "active", lifecycle: "ACTIVE" }),
  retired: mk({ id: "retired", lifecycle: "RETIRED" }),
  // Pack Opening 3.1 · un especial REAL dentro de la compuerta económica (EMEA, plan por ranuras).
  emea: getPack("emea")!,
};
const resolve: PackResolver = (id) => CATALOG[id];

const U = "user-1";
/** Espera que la llamada REBOTE en la guarda: devuelve error y no toca la BD. */
async function expectGuarded(p: Promise<{ ok: boolean; status?: number }>, status: number, label: string): Promise<void> {
  const r = await p; // si tocara la BD, el sentinel lanzaría aquí y el test fallaría con SB_TOCADO
  assert.equal(r.ok, false, `${label}: debería rechazar`);
  assert.equal((r as { status: number }).status, status, `${label}: código`);
}
/** Espera que la llamada SUPERE la guarda y llegue a la BD (salta el sentinel). */
async function expectReachedDb(p: Promise<unknown>, label: string): Promise<void> {
  await assert.rejects(p, new RegExp(SENTINEL), `${label}: debería haber llegado a la BD`);
}

// ─────────────────────────── COMPRA ───────────────────────────
test("COMPRA · DRAFT rechazado server-side (404), sin tocar la BD", async () => {
  await expectGuarded(buyPack(throwingSb, U, "draft", undefined, resolve), 404, "buy DRAFT");
});
test("COMPRA · RETIRED rechazado server-side (409), sin tocar la BD", async () => {
  await expectGuarded(buyPack(throwingSb, U, "retired", undefined, resolve), 409, "buy RETIRED");
});
test("COMPRA · ACTIVE dentro de la compuerta económica supera las guardas y procede a la BD", async () => {
  await expectReachedDb(buyPack(throwingSb, U, "emea", undefined, resolve), "buy ACTIVE (EMEA)");
});
test("COMPRA · Pack Opening 3.1: un especial ACTIVE SIN plan (pesos por rareza) rebota en la compuerta económica (409), sin tocar la BD", async () => {
  await expectGuarded(buyPack(throwingSb, U, "active", undefined, resolve), 409, "buy ACTIVE sin plan");
});
test("COMPRA · pack inexistente → 404, sin tocar la BD", async () => {
  await expectGuarded(buyPack(throwingSb, U, "no-existe", undefined, resolve), 404, "buy inexistente");
});
test("COMPRA · IDs manipulados no resuelven → 404, sin tocar la BD", async () => {
  for (const id of ["../estandar", "active ", "'; DROP TABLE packs;--", "ACTIVE", "dr aft", ""]) {
    await expectGuarded(buyPack(throwingSb, U, id, undefined, resolve), 404, `buy «${id}»`);
  }
});

// ─────────────────────────── APERTURA PÚBLICA ───────────────────────────
test("APERTURA · DRAFT rechazado server-side (404), sin tocar la BD", async () => {
  await expectGuarded(openPackForUser(throwingSb, U, "draft", undefined, resolve), 404, "open DRAFT");
});
test("APERTURA · inexistente → 404, sin tocar la BD", async () => {
  await expectGuarded(openPackForUser(throwingSb, U, "no-existe", undefined, resolve), 404, "open inexistente");
});
test("APERTURA · ACTIVE supera la guarda y procede a la BD (comprobación de posesión)", async () => {
  await expectReachedDb(openPackForUser(throwingSb, U, "active", undefined, resolve), "open ACTIVE");
});
test("APERTURA · RETIRED supera la guarda (histórico: abrible si se posee)", async () => {
  await expectReachedDb(openPackForUser(throwingSb, U, "retired", undefined, resolve), "open RETIRED");
});

// ─────────────────────────── BUY_AND_OPEN ───────────────────────────
test("BUY_AND_OPEN · DRAFT y RETIRED se rechazan en la compra, sin tocar la BD", async () => {
  await expectGuarded(buyAndOpen(throwingSb, U, "draft", undefined, resolve), 404, "buy_and_open DRAFT");
  await expectGuarded(buyAndOpen(throwingSb, U, "retired", undefined, resolve), 409, "buy_and_open RETIRED");
});

// ─────────────────────────── CATÁLOGO REAL (compatibilidad) ───────────────────────────
test("CATÁLOGO REAL · prime (retired) se rechaza en compra; estandar (active) procede", async () => {
  // Sin resolutor inyectado: usa el catálogo de producción (getPack). Demuestra que la guarda
  // protege los sobres reales, no solo los sintéticos.
  assert.equal(packLifecycle(getPack("prime")!), "RETIRED", "prime debe seguir siendo RETIRED (retired:true)");
  assert.equal(packLifecycle(getPack("estandar")!), "ACTIVE");
  await expectGuarded(buyPack(throwingSb, U, "prime"), 409, "buy prime real");
  await expectReachedDb(buyPack(throwingSb, U, "estandar"), "buy estandar real");
});

test("CATÁLOGO REAL · prime sigue siendo ABRIBLE (histórico), no borrado del catálogo", async () => {
  // La compra se rechaza, pero la apertura supera la guarda: si el jugador lo posee, se abre.
  await expectReachedDb(openPackForUser(throwingSb, U, "prime"), "open prime real");
  // Y todos los sobres de producción tienen un estado válido.
  for (const id of ["inicial", "estandar", "premium", "prime", "ewc", "team-g2", "team-navi"]) {
    assert.ok(["DRAFT", "ACTIVE", "RETIRED"].includes(packLifecycle(getPack(id)!)), `${id} sin estado válido`);
  }
});

test("TEAM PACKS DRAFT (Fase 20.5) · todo Team Pack DRAFT es rechazado server-side en compra y apertura", async () => {
  // Dinámico: cubre las Olas 1 y 2 (y cualquiera futura) sin fijar ids. Los Team Packs vivos
  // (team-g2, team-navi, team-heretics, team-fnatic) NO son DRAFT y no entran aquí.
  const drafts = PACKS.filter((p) => p.team && packLifecycle(p) === "DRAFT");
  // 2026-09-22: Team Liquid y Karmine Corp salieron de DRAFT al llegar su arte oficial (era su
  // único bloqueo auditado). Quedan 13; el contrato es el mismo para los que siguen en DRAFT.
  assert.ok(drafts.length >= 13, `esperados ≥13 Team Packs DRAFT, hay ${drafts.length}`);
  for (const id of ["team-liquid", "team-karmine"]) {
    assert.ok(!drafts.some((p) => p.id === id), `${id} ya no es DRAFT`);
  }
  for (const pack of drafts) {
    assert.ok(!pack.guaranteedMin && !pack.guarantees?.length, `${pack.id}: no puede garantizar carta`);
    await expectGuarded(buyPack(throwingSb, U, pack.id), 404, `buy ${pack.id}`);
    await expectGuarded(openPackForUser(throwingSb, U, pack.id), 404, `open ${pack.id}`);
  }
  // Y los Team Packs vivos siguen siendo comprables/abribles (no se han vuelto DRAFT por error).
  for (const id of ["team-g2", "team-heretics", "team-fnatic", "team-liquid", "team-karmine"]) {
    assert.equal(packLifecycle(getPack(id)!), "ACTIVE", `${id} debe seguir ACTIVE`);
  }
  /*
   * NAVI se RETIRÓ del escaparate el 2026-09-22 (decisión de producto). Retirado no es DRAFT: el
   * servidor lo saca de la tienda pero sigue abriéndose, que es lo que protege el inventario ya
   * comprado. Esto lo fija aquí para que nadie lo convierta en DRAFT «para limpiarlo».
   */
  assert.equal(packLifecycle(getPack("team-navi")!), "RETIRED", "NAVI retirado, no DRAFT ni borrado");
});
