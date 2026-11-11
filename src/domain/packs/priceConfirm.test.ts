/**
 * ICON (2026-10-09) · EL PRECIO QUE EL JUGADOR VIO. `expectedPrice` solo puede BLOQUEAR un cobro (409, sin cobrar); el
 * importe lo decide siempre el servidor (`pack.price`). Regresión del verify de experiencia (sección packs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRICE_CONFIRMATION_REQUIRED, checkExpectedPrice, validExpectedPrice } from "./priceConfirm";

const ICON = { id: "icon", price: 80_000 };
const STD = { id: "standard", price: 1_000 };

test("PC-1 · precio visto = precio del servidor → se puede cobrar", () => {
  assert.deepEqual(checkExpectedPrice(ICON, 80_000), { ok: true });
  assert.deepEqual(checkExpectedPrice(STD, 1_000), { ok: true });
});

test("PC-2 · precio cambiado → 409 PRICE_CHANGED, dice el precio actual y que no se cobró nada", () => {
  const r = checkExpectedPrice(ICON, 60_000);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.status, 409);
  assert.equal(r.code, "PRICE_CHANGED");
  assert.match(r.error, /No se ha cobrado nada/);
  assert.equal(checkExpectedPrice(STD, 2_000).ok, false, "también al alza o a la baja en cualquier sobre");
});

test("PC-3 · sin precio visto: los sobres que lo exigen se rechazan; los demás siguen (clientes antiguos)", () => {
  assert.ok(PRICE_CONFIRMATION_REQUIRED.has("icon"));
  const r = checkExpectedPrice(ICON, undefined);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "PRICE_CONFIRMATION_REQUIRED");
  assert.deepEqual(checkExpectedPrice(STD, undefined), { ok: true });
});

test("PC-4 · forma del campo: entero ≥ 0 (o ausente); nada de cadenas, decimales, negativos ni cifras absurdas", () => {
  for (const ok of [undefined, 0, 1_000, 80_000, 100_000_000]) assert.equal(validExpectedPrice(ok), true, String(ok));
  for (const bad of [-1, 1.5, "80000", null, Number.NaN, Number.POSITIVE_INFINITY, 100_000_001, {}]) assert.equal(validExpectedPrice(bad), false, String(bad));
});

test("PC-5 · el servicio comprueba el precio ANTES de cobrar y cobra el SUYO; la ruta lo prohíbe al abrir", () => {
  const svc = readFileSync(join(process.cwd(), "src/server/services/packs.ts"), "utf8");
  const buy = svc.slice(svc.indexOf("export async function buyPack("), svc.indexOf('sb.rpc("app_buy_pack"'));
  assert.ok(buy.includes("const seen = checkExpectedPrice(pack, opts.expectedPrice);") && buy.includes("if (!seen.ok) return fail(seen.error, seen.status);"));
  assert.ok(svc.includes("p_price: pack.price,") && !/p_price:\s*(opts\.)?expectedPrice/.test(svc), "el importe nunca sale del cliente");
  const buyAndOpen = svc.slice(svc.indexOf("export async function buyAndOpen("));
  assert.ok(/buyPack\(sb, userId, packId, \w+, resolve, opts\)/.test(buyAndOpen), "comprar y abrir pasa por la misma barrera");
  const route = readFileSync(join(process.cwd(), "src/app/api/game/packs/route.ts"), "utf8");
  assert.ok(route.includes('if (!validExpectedPrice(body.expectedPrice) || (action === "open" && body.expectedPrice !== undefined)) {'));
});
