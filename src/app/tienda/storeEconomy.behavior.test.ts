import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKS, getPack } from "@/data/packs";
import { isStoreVisible, packLifecycle } from "@/domain/packs/lifecycle";
import { resolveStore } from "@/domain/store/resolve";

/**
 * CICLO ECONÓMICO DE LA TIENDA (Fase 21.4; recableado a la Tienda 4.0 en la Fase 49). Las mismas
 * propiedades del CABLEADO de `/tienda`: compra por el flujo existente, respeta el ciclo de vida y no
 * decide economía en React. En la Fase 49 la visibilidad la aplica el resolvedor (`domain/store/resolve`)
 * y el saldo insuficiente, el modal de compra; por eso se leen esos ficheros, no la vitrina antigua.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");
const SHOP = read("app", "tienda", "page.tsx");
const RESOLVE = read("domain", "store", "resolve.ts");
const MODAL = read("components", "store", "PurchaseModal.tsx");
const NOW = Date.parse("2026-09-21T12:00:00Z");

test("VISIBILIDAD · la tienda muestra solo ACTIVE (ciclo de vida), y Team Heretics está entre ellos", () => {
  // Es la misma autoridad del servidor: `isStoreVisible` = ACTIVE, e `isPurchasable` para vender.
  assert.match(SHOP, /resolveStore\(Date\.now\(\)\)/, "la página pinta lo que resuelve el dominio");
  assert.match(RESOLVE, /isStoreVisible\(pack\) && isPurchasable\(pack\)/, "filtra por ciclo de vida, no por una regla propia");
  const visibles = PACKS.filter((p) => isStoreVisible(p));
  assert.ok(visibles.every((p) => packLifecycle(p) === "ACTIVE"), "todo lo visible es ACTIVE");
  const shown = resolveStore(NOW).packs.map((p) => p.packId);
  assert.ok(shown.includes("team-heretics"), "Team Heretics aparece");
  // DRAFT y RETIRED quedan fuera.
  for (const id of ["team-loud", "team-tyl", "team-xlg", "prime"]) assert.ok(!shown.includes(id), `${id} no aparece`);
});

test("COMPRA · usa el flujo existente (servidor o motor local) y encadena a la apertura", () => {
  // Con sesión, la cobra el servidor; sin ella, el motor local. Ninguna vía nueva para los sobres.
  assert.match(SHOP, /buyPackOnline\(/, "compra online por el servidor");
  assert.match(SHOP, /buyPack\(packId\)/, "o el motor local existente");
  // Tras comprar, «Abrir ahora» encadena a la ceremonia existente.
  assert.match(SHOP, /router\.push\(`\/abrir\/\$\{packId\}`\)/, "comprar → /abrir/:id");
});

test("ECONOMÍA · la tienda NO decide precio ni descuenta créditos en React", () => {
  assert.ok(!/price:\s*\d/.test(SHOP), "no hay precios inventados en la página");
  assert.ok(!/credits\s*[-+]=/.test(SHOP), "no se resta/suma al saldo en el cliente");
  assert.ok(!/setCredits\(/.test(SHOP), "no hay un balance local paralelo");
  assert.match(SHOP, /const credits = useGameStore\(\(s\) => s\.credits\)/, "el saldo se lee del store");
  // El precio del sobre en créditos sale del PackDef (fuente única), vía el resolvedor.
  assert.match(RESOLVE, /m === "GAME_CURRENCY" \? pack\.price/, "el precio sale del PackDef");
  // El saldo tras la compra es el que devuelve el servidor (sincronizado en el store), no una resta.
  assert.match(SHOP, /balance: useGameStore\.getState\(\)\.credits/);
});

test("SALDO INSUFICIENTE · el modal lo dice y no deja confirmar", () => {
  assert.match(MODAL, /const short = canPayCredits && credits < price;/, "compara saldo con precio");
  assert.match(MODAL, /faltan/, "muestra cuánto falta");
  assert.match(MODAL, /disabled=\{working \|\| short\}/, "deshabilita confirmar sin saldo o mientras compra");
});

test("DOBLE COMPRA · un guardián `busy` impide pulsar dos veces (la protección real es el servidor)", () => {
  assert.match(SHOP, /if \(busy[^)]*\) return;/, "sale si ya está comprando");
  assert.match(SHOP, /setBusy\(true\)[\s\S]*finally[\s\S]*setBusy\(false\)/, "estado de proceso con finally");
});

test("PUENTE · la tienda enlaza al catálogo por categoría, no lo duplica", () => {
  for (const h of ["/packs", "/packs#rareza", "/packs#regiones", "/packs#equipos"]) {
    assert.ok(SHOP.includes(`"${h}"`), `enlaza a ${h}`);
  }
  assert.ok(!/catalogGroups\(/.test(SHOP), "no duplica la rejilla categorizada de /packs");
});

test("PRECIO CANÓNICO · lo que la tienda muestra es el precio del PackDef, sin alterarlo", () => {
  for (const p of resolveStore(NOW).packs) {
    const game = p.options.find((o) => o.method === "GAME_CURRENCY")!;
    assert.equal(game.price, getPack(p.packId!)!.price, p.productId);
    assert.ok(Number.isFinite(game.price) && game.price! >= 0);
  }
});

test("DINERO REAL · la página nunca llama a una compra con dinero real ni finge un cobro", () => {
  assert.ok(!/REAL_MONEY/.test(SHOP), "la página no inicia pagos con dinero real");
  assert.ok(!/api\/game\/store/.test(SHOP), "ni llama al checkout: sin pasarela, el botón es «Próximamente»");
  assert.match(MODAL, /El pago con dinero real todavía no está activo\. No se te cobrará nada\./);
});
