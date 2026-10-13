/**
 * `power.ts` DESPUÉS DE LA FASE 57.3 — el techo de OVR del Hotfix 57.2 ya no gobierna ningún sobre.
 *
 * Bronce, Plata, Oro e Icon (los cuatro que tenían techo) pasan a la PACK CLASS DISTRIBUTION con Masters y Champions
 * (`./packClass`, contrato completo en `packClass.test.ts`). Aquí se fija que el mecanismo sigue existiendo pero sin reglas,
 * que no hay dos filtros a la vez y que los productos que nunca tuvieron techo conservan el pool EXACTO de antes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { CARDS, getCard } from "@/data/catalog";
import { PACKS, getPack } from "@/data/packs";
import { buildPool, isEligible } from "./pool";
import type { PackDef } from "./types";
import { PACK_POWER_RULES, BASE_LINE, powerRuleFor, withinPackPower, packPowerCap } from "./power";
import { mainPackDistribution, MAIN_PACK_LINE, packCardClass } from "./packClass";
import { packOddsFor } from "./odds";

const REG = new CardRegistry();
/** El mismo sobre con otro id: sin regla de ningún tipo (ni techo ni tabla). */
const control = (p: PackDef): PackDef => ({ ...p, id: `${p.id}__control` });
const idsOf = (p: PackDef) => new Set(buildPool(REG, p).flat.map((c) => c.id));

test("57.3 · PACK_POWER_RULES vacío: ningún sobre tiene techo de OVR y ningún techo convive con la tabla", () => {
  assert.deepEqual(Object.keys(PACK_POWER_RULES), []);
  for (const p of PACKS) {
    assert.equal(powerRuleFor(p.id), null, p.id);
    assert.equal(packPowerCap(p.id), null, p.id);
    assert.equal(packOddsFor(p, null).powerCap, null, p.id);
  }
  // Los cuatro de la escalera de 57.2 siguen existiendo y son de la línea con tabla.
  assert.deepEqual([...BASE_LINE], ["estandar", "premium", "oro", "icon"]);
  for (const id of BASE_LINE) assert.ok(getPack(id) && mainPackDistribution(id), id);
});

test("57.3 · withinPackPower no filtra nada (sin regla, siempre sí); ids heredados de Object no activan regla", () => {
  for (const id of ["estandar", "premium", "oro", "icon", "toString", "constructor", "__proto__", "hasOwnProperty", ""]) {
    assert.equal(powerRuleFor(id), null, id);
    assert.equal(withinPackPower(id, { ovr: 99 }), true, id);
  }
});

test("REGRESIÓN 57.2 → 57.3 → 3.0 · brawk__masters-l (OVR 93) es clase Masters: Bronce solo puede darla por su ranura destacada", () => {
  const card = getCard("brawk__masters-l")!;
  assert.equal(card.ovr, 93);
  assert.equal(packCardClass(card), "masters");
  assert.equal(isEligible(REG, getPack("estandar")!, card), true, "elegible: la decide el plan, no un techo");
  // Pack Opening 3.0 · Masters solo en la destacada de Bronce (10 %), y dentro de la clase un 93 pesa e^(−0,3·23).
  assert.ok(Math.abs(mainPackDistribution("estandar")!.masters - 2) < 1e-9);
  assert.equal(mainPackDistribution("icon")!.masters, 0, "Icon nunca da Masters");
});

test("ESPECIALES · los productos fuera de la línea tienen el pool EXACTO de un control sin reglas", () => {
  const specials = PACKS.filter((p) => !MAIN_PACK_LINE.includes(p.id));
  assert.ok(specials.length >= 25, "hay productos especiales que auditar");
  for (const p of specials) assert.deepEqual([...idsOf(p)].sort(), [...idsOf(control(p))].sort(), `${p.id}: pool intacto`);
});

test("CATÁLOGO · siguen siendo 331 cartas", () => {
  assert.equal(CARDS.length, 331);
  assert.equal(REG.cards.length, 331);
});
