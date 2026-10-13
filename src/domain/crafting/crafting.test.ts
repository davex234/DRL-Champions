/**
 * F73 · CRAFTEO (puro) — economía de las recetas, semillas de 0059 contra sus suelos, validación del admin y el
 * intercambio de cartas (qué copias se pueden entregar y qué sale).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getCard } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { MAIN_PACK_LINE, packCardClass } from "@/domain/packs/packClass";
import { analyzeRatio, CRAFT_PREMIUM, ratioIsSafe } from "./economy";
import { classEconomy, MIN_OUTPUT_POOL, recipeFloor, validateRecipe } from "./floors";
import { checkSelection, exchangeCandidates, outputPool, pickOutput, type OwnedCopy } from "./cardExchange";
import type { CraftRecipe } from "./types";
import { PACK_STATS } from "@/data/packStats";

/**
 * F80 · recetas de sobres que, con los precios nuevos y las cantidades de 0059 sin tocar (decisión del propietario), quedan
 * por debajo de la PRIMA de coste del 25 % (no de los suelos de valor ni de desguace). Craftear sigue sin ser más barato.
 */
// Icon por sobre (2026-10-09): el Plata vale más (Icon del 1,5 % al 5 %) y «3 Plata → 1 Oro» alcanza su suelo (ratio 3): sale
// de las excepciones y pasa a validar como cualquier receta segura.
// ICON (2026-10-09): Champions → ICON Premium pasa a 3:1 (decisión del propietario) y queda EXACTAMENTE en su suelo (3): sale.
const F80_BELOW_COST_FLOOR = new Set(["pack-oro-masters"]);
/**
 * PACK OPENING 3.0 (2026-10-07, decisión del propietario) · cambio de OPERADOR sobre la semilla de 0059 (la migración
 * aplicada no se edita): con la identidad nueva de los sobres, «2 Plata → 1 Oro» CREABA valor (EV 6.682 → 8.439), así que
 * pasa a 3:1 (entra 10.023, sale 8.439: ya no crea valor). Las tres (Plata → Oro 3:1, Oro → Masters 2:1, Champions → Icon
 * 2:1) NO crean valor pero quedan bajo el MARGEN de seguridad del suelo; aceptado (como F80 aceptó el de coste) y el admin
 * las sigue marcando BELOW_FLOOR.
 */
// Pack Opening 3.0 (Plata → Oro 3:1, aplicado en BD 2026-10-07) + ICON (2026-10-09, decisión del propietario): Champions →
// ICON Premium 3:1 — dato de `craft_recipes` PENDIENTE de aplicar en producción (scripts/_icon-odds/recipe-sql.ts).
const PACK_OPENING_3_QTY: Readonly<Record<string, number>> = { "pack-premium-oro": 3, "pack-champions-icon": 3 };
/**
 * PACK OPENING 3.0 · «3 cartas Plata → 1 Oro» queda bajo la PRIMA de coste (25 %): el rebalance abarata conseguir una Plata
 * (1.412 frente a 2.000 créditos por carta) y no la Oro (4.000). No crea valor (792 → 450) ni es más barata que la vía
 * directa (3 × 1.412 = 4.236 ≥ 4.000). Misma categoría que las excepciones de coste de F80; la Forja no se toca.
 */
const PACK_OPENING_3_CARD_BELOW_COST = new Set(["card-plata-oro"]);
const base = (over: Partial<CraftRecipe>): CraftRecipe => ({ id: "r-x", kind: "PACK", name: "Receta", inputPackId: "estandar", outputPackId: "premium", inputClass: null, outputClass: null, inputQty: 4, status: "ACTIVE", sortOrder: 0, availableFrom: null, availableTo: null, version: 1, ...over });

/** Semillas de la migración 0059, leídas del SQL (la migración y la economía no pueden divergir). */
function seeds(): CraftRecipe[] {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const rows = [...sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'[^']+',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)'/g)];
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  return rows.map((m) => base({ id: m[1], kind: m[2] as "PACK" | "CARD", inputPackId: v(m[3]), outputPackId: v(m[4]), inputClass: v(m[5]) as never, outputClass: v(m[6]) as never, inputQty: PACK_OPENING_3_QTY[m[1]] ?? Number(m[7]), status: m[8] as "ACTIVE" | "DISABLED" }));
}

test("F73 E1 · regla del suelo: el crafteo es ≥ 25 % PEOR que la ruta directa en precio, valor y desguace", () => {
  const a = analyzeRatio({ cost: 1000, value: 4000, salvage: 300 }, { cost: 2500, value: 8000, salvage: 600 });
  assert.equal(a.byCost, 4); assert.equal(a.byValue, 3); assert.equal(a.bySalvage, 3); assert.equal(a.ratio, 4);
  assert.ok(a.lossCost >= 1 - 1 / CRAFT_PREMIUM - 1e-9);
  assert.equal(analyzeRatio({ cost: 10, value: 10, salvage: 10 }, { cost: 1, value: 1, salvage: 1 }).ratio, 2, "nunca por debajo de 2");
  assert.equal(ratioIsSafe(3, a), false); assert.equal(ratioIsSafe(4, a), true);
});

test("F73 E2 · las 11 semillas de 0059: 5 de sobres (línea principal consecutiva) y 6 de cartas; todas ≥ su suelo seguro", () => {
  const s = seeds();
  assert.equal(s.length, 11);
  const packs = s.filter((r) => r.kind === "PACK");
  // ICON (2026-10-09): el Sobre ICON de 1 carta (`icon-single`) entra en la línea pero no tiene receta: la cadena de 0059
  // sigue siendo Bronce → … → Champions → `icon` (Sobre ICON Premium, id histórico).
  const chain = MAIN_PACK_LINE.filter((id) => id !== "icon-single");
  assert.deepEqual(packs.map((r) => [r.inputPackId, r.outputPackId]), chain.slice(0, -1).map((id, i) => [id, chain[i + 1]]));
  for (const r of s) {
    const f = recipeFloor(r)!;
    assert.ok(f, r.id);
    if (F80_BELOW_COST_FLOOR.has(r.id)) {
      // F80 + Pack Opening 3.0 · aceptadas: por debajo del suelo (prima de coste y margen de valor), pero SIN crear valor —
      // lo que entra vale más que lo que sale— y el admin las sigue marcando BELOW_FLOOR (la regla no se relaja).
      assert.ok(r.inputQty < f.ratio, `${r.id}: ${JSON.stringify(f)}`);
      assert.ok(r.inputQty * PACK_STATS[r.inputPackId!].meanValue > PACK_STATS[r.outputPackId!].meanValue, `${r.id}: el crafteo crearía valor`);
      assert.deepEqual(validateRecipe(r, { forActivation: true }).map((p) => p.code), ["BELOW_FLOOR"], r.id);
      continue;
    }
    if (PACK_OPENING_3_CARD_BELOW_COST.has(r.id)) {
      const ce = classEconomy(), a = ce[r.inputClass!], b = ce[r.outputClass!];
      assert.ok(r.inputQty >= f.byValue && r.inputQty >= f.bySalvage && r.inputQty < f.byCost, `${r.id}: ${JSON.stringify(f)}`);
      assert.ok(r.inputQty * a.marketMean > b.marketMean, `${r.id}: crearía valor`);
      assert.ok(r.inputQty * (a.directCostPerCard ?? 0) >= (b.directCostPerCard ?? Infinity), `${r.id}: más barata que la vía directa`);
      assert.deepEqual(validateRecipe(r, { forActivation: true }).map((p) => p.code), ["BELOW_FLOOR"], r.id);
      continue;
    }
    assert.ok(r.inputQty >= f.ratio, `${r.id}: ${r.inputQty} < suelo ${f.ratio}`);
    if (r.status === "ACTIVE") assert.deepEqual(validateRecipe(r, { forActivation: true }), [], r.id);
  }
});

test("F73 E3 · sobres: ratios exactos medidos y precio de crafteo SIEMPRE mayor que comprar el destino", () => {
  const byId = Object.fromEntries(seeds().filter((r) => r.kind === "PACK").map((r) => [r.id, r.inputQty]));
  assert.deepEqual(byId, { "pack-estandar-premium": 4, "pack-premium-oro": 3, "pack-oro-masters": 2, "pack-masters-champions": 3, "pack-champions-icon": 3 });
  const premium: Record<string, number> = {};
  for (const r of seeds().filter((x) => x.kind === "PACK")) {
    const craft = r.inputQty * getPack(r.inputPackId!)!.price, buy = getPack(r.outputPackId!)!.price;
    premium[r.id] = +(craft / buy).toFixed(4);
    // Craftear NUNCA es más barato que comprar el destino; la prima del 25 % se exige salvo en las tres aceptadas en F80.
    assert.ok(craft >= (F80_BELOW_COST_FLOOR.has(r.id) ? 1 : CRAFT_PREMIUM) * buy, r.id);
  }
  // F80 (precios 2.500/6.000/12.000/20.000/35.000/60.000) + Pack Opening 3.0 (Plata → Oro 3:1): recetas 4/3/2/3/2.
  assert.deepEqual(premium, { "pack-estandar-premium": 1.6667, "pack-premium-oro": 1.5, "pack-oro-masters": 1.2, "pack-masters-champions": 1.7143, "pack-champions-icon": 1.3125 });
  // Ninguna receta de sobres crea valor esperado de colección con la identidad nueva.
  // ICON (2026-10-09) · Champions → ICON Premium 3:1: 3 × 27.680 > 63.705, tampoco crea valor (a 2:1 sí lo creaba).
  for (const r of seeds().filter((x) => x.kind === "PACK")) assert.ok(r.inputQty * PACK_STATS[r.inputPackId!].meanValue > PACK_STATS[r.outputPackId!].meanValue, `${r.id} crea valor`);
});

test("F73 E4 · cartas: Prime → Icon DESACTIVADA (solo 3 Icon: sería una garantía); las demás activas y por encima del suelo", () => {
  const card = seeds().filter((r) => r.kind === "CARD");
  assert.deepEqual(card.map((r) => [r.id, r.inputQty, r.status]), [
    ["card-base-plata", 7, "ACTIVE"], ["card-plata-oro", 3, "ACTIVE"], ["card-oro-masters", 8, "ACTIVE"],
    ["card-masters-champions", 14, "ACTIVE"], ["card-champions-prime", 10, "ACTIVE"], ["card-prime-icon", 5, "DISABLED"],
  ]);
  assert.ok(classEconomy().icon.cards < MIN_OUTPUT_POOL);
  assert.ok(validateRecipe(card.find((r) => r.id === "card-prime-icon")!, { forActivation: true }).some((p) => p.code === "SCARCE_OUTPUT"));
});

test("F73 E5 · el admin no puede activar recetas inválidas o explotables", () => {
  const codes = (r: CraftRecipe) => validateRecipe(r, { forActivation: true }).map((p) => p.code);
  assert.ok(codes(base({ inputQty: 2 })).includes("BELOW_FLOOR"), "por debajo del suelo"); // F80: el suelo Bronce→Plata es 3
  assert.ok(codes(base({ inputQty: 0 })).includes("BAD_QTY"));
  assert.ok(codes(base({ outputPackId: "no-existe" })).includes("UNKNOWN_PACK"));
  assert.ok(codes(base({ outputPackId: "estandar" })).includes("CIRCULAR"));
  assert.ok(codes(base({ inputPackId: "premium", outputPackId: "estandar", inputQty: 10 })).includes("DOWNGRADE"));
  assert.ok(codes(base({ inputPackId: "inicial", outputPackId: "estandar" })).includes("NOT_CONVERTIBLE"));
  assert.ok(codes(base({ kind: "CARD", inputPackId: null, outputPackId: null, inputClass: "oro", outputClass: "plata", inputQty: 20 })).includes("DOWNGRADE"));
  assert.ok(codes(base({ kind: "CARD", inputPackId: null, outputPackId: null, inputClass: "base", outputClass: "plata", inputQty: 3 })).includes("BELOW_FLOOR"));
  assert.ok(codes(base({ id: "Mal Id" })).includes("BAD_ID"));
  assert.deepEqual(validateRecipe(base({ inputQty: 2, status: "DISABLED" })), [], "desactivada, puede guardarse como propuesta");
});

/* ───────────── intercambio ───────────── */
const basics = CARDS.filter((c) => packCardClass(c) === "base").slice(0, 3);
const copies = (cardId: string, n: number, prefix: string, locked = false): OwnedCopy[] => Array.from({ length: n }, (_, i) => ({ uid: `${prefix}-${i}`, cardId, locked }));

test("F73 X1 · entregables = copias − 1, sin bloqueadas ni en equipos, solo de la clase de entrada", () => {
  const [a, b, c] = basics;
  const plata = CARDS.find((x) => packCardClass(x) === "plata")!;
  const owned = [...copies(a.id, 4, "a"), ...copies(b.id, 1, "b"), ...copies(c.id, 3, "c"), { uid: "c-lock", cardId: c.id, locked: true }, ...copies(plata.id, 5, "p")];
  const cands = exchangeCandidates(owned, new Set(["a-0"]), "base", getCard);
  const byCard = Object.fromEntries(cands.map((x) => [x.cardId, x]));
  assert.equal(byCard[a.id].available, 3, "4 copias, 1 en equipo → 3 libres; copias−1 = 3");
  assert.ok(!byCard[a.id].uids.includes("a-0"), "la del equipo no se ofrece");
  assert.equal(byCard[b.id], undefined, "una sola copia: nunca se entrega");
  // F79 · «te queda al menos una» = una copia DESBLOQUEADA, como el desguace (0060): la bloqueada (en venta) no cuenta
  // como la que conservas. 4 copias, 1 bloqueada → 3 desbloqueadas → se pueden dar 3 − 1 = 2 (antes 3: con el mercado
  // abierto podía dejarte solo con la copia en venta).
  assert.equal(byCard[c.id].available, 2, "4 copias (1 bloqueada) → 3 libres, desbloqueadas−1 = 2");
  assert.ok(!byCard[c.id].uids.includes("c-lock"));
  assert.equal(byCard[plata.id], undefined, "otra clase no entra");
});

test("F73 X2 · selección: número exacto, sin repetir, solo entregables, y nunca la última copia", () => {
  const [a] = basics;
  const cands = exchangeCandidates(copies(a.id, 3, "a"), new Set(), "base", getCard);
  assert.deepEqual(checkSelection(["a-0"], 2, cands), { ok: false, error: "WRONG_COUNT" });
  assert.deepEqual(checkSelection(["a-0", "a-0"], 2, cands), { ok: false, error: "DUPLICATE_INPUT" });
  assert.deepEqual(checkSelection(["a-0", "zzz"], 2, cands), { ok: false, error: "NOT_ELIGIBLE" });
  assert.equal(cands[0].available, 2, "de 3 copias solo 2 son entregables");
  assert.equal(checkSelection(["a-0", "a-2"], 2, cands).ok, true, "cualesquiera dos de las tres");
  assert.deepEqual(checkSelection(["a-0", "a-1", "a-2"], 3, cands), { ok: false, error: "LAST_COPY" });
});

test("F73 X3 · salida: carta de la clase de salida; el índice lo da el servidor y fuera de rango no hay carta", () => {
  const pool = outputPool(CARDS, "plata");
  assert.ok(pool.length >= 10 && pool.every((c) => packCardClass(c) === "plata"));
  assert.equal(pickOutput(pool, 0)!.id, pool[0].id);
  assert.equal(pickOutput(pool, pool.length), null);
  assert.equal(pickOutput(pool, -1), null);
  assert.equal(pickOutput([], 0), null);
});
