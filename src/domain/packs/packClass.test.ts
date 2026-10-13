/**
 * FASE 57.3 · PACK CLASS DISTRIBUTION — el contrato de la línea principal (Bronce, Plata, Oro, Masters, Champions, Icon).
 *
 * Fija: la clasificación de las 331 cartas (cada una en EXACTAMENTE una clase), la tabla (cifras exactas, suma 100,
 * progresión estricta de Prime e Icon), el sorteo del motor real (clase → carta, sin fallback, fallo cerrado), Icon = 1
 * carta Prime/Icon, que `power.ts` ya no filtra ninguno de estos seis, y que los demás sobres NO cambian.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { PackEngine } from "@/pack/engine";
import { validatePack } from "@/pack/validate";
import { CARDS } from "@/data/catalog";
import { PACKS, getPack } from "@/data/packs";
import {
  packCardClass, mainPackDistribution, packPlan, packDrawMode, classGuarantee, activeClasses,
  MAIN_PACK_DISTRIBUTION, MAIN_PACK_PLAN, MAIN_PACK_LINE, PACK_CLASS_ORDER, EmptyPackClassError, type PackCardClass,
} from "./packClass";
import { openPack, classPool } from "./openPack";
import { freshPity } from "./pity";
import { powerRuleFor, PACK_POWER_RULES } from "./power";
import { buildPool } from "./pool";
import { packOddsFor, classOddsFor } from "./odds";
import type { PackDef } from "./types";

const REG = new CardRegistry();
const pack = (id: string) => getPack(id)!;
const draw = (p: PackDef, seed: number, owned: Set<string> = new Set()) =>
  openPack(REG, p, { seed, owned, pity: freshPity() }).decisions;

/* ───────────────────────────── 1 · CLASIFICACIÓN ───────────────────────────── */

test("CLASIFICACIÓN · las 331 cartas: classified 331, unclassified 0, multiClassified 0", () => {
  assert.equal(CARDS.length, 331);
  let classified = 0, unclassified = 0, multi = 0;
  for (const c of CARDS) {
    // Cada clase como predicado independiente: una carta en dos predicados sería multiclasificada.
    const hits = PACK_CLASS_ORDER.filter((k) => packCardClass(c) === k).length;
    if (hits === 0) unclassified++; else if (hits > 1) multi++; else classified++;
  }
  assert.deepEqual({ classified, unclassified, multi }, { classified: 331, unclassified: 0, multi: 0 });
});

test("CLASIFICACIÓN · recuento exacto por clase del catálogo real (suma 331)", () => {
  const n = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, 0])) as Record<PackCardClass, number>;
  for (const c of CARDS) n[packCardClass(c)!]++;
  assert.deepEqual(n, { base: 75, plata: 60, oro: 34, masters: 119, champions: 20, prime: 20, icon: 3 });
  assert.equal(Object.values(n).reduce((a, b) => a + b, 0), 331);
});

test("CLASIFICACIÓN · reglas por edición y OVR, con bordes; nada fuera de la línea tiene clase", () => {
  const k = (variantId: string, ovr: number) => packCardClass({ variantId: variantId as never, ovr });
  assert.equal(k("base", 70), "base"); assert.equal(k("base", 81), "base");
  assert.equal(k("base", 82), "plata"); assert.equal(k("base", 85), "plata");
  assert.equal(k("base", 86), "oro"); assert.equal(k("base", 92), "oro");
  assert.equal(k("base", 69), null); assert.equal(k("base", 93), null); assert.equal(k("base", Number.NaN), null);
  assert.equal(k("masters-l", 95), "masters"); assert.equal(k("masters-sdc", 79), "masters");
  assert.equal(k("champions-s", 80), "champions");
  assert.equal(k("future-star", 95), "prime");
  assert.equal(k("record-breaker", 92), "icon"); assert.equal(k("moments", 95), "icon");
  for (const v of ["bronze", "gold", "prime", "icon-series", "hall-of-fame", "masters", "champions"]) assert.equal(k(v, 90), null, v);
});

test("CLASIFICACIÓN · no toca el catálogo: edición, OVR y rareza siguen siendo los de la carta", () => {
  for (const c of CARDS) {
    const before = JSON.stringify(c);
    packCardClass(c);
    assert.equal(JSON.stringify(c), before);
  }
  // Una Future Star sigue siendo Future Star: la clase es del sorteo, no de la carta.
  assert.ok(CARDS.filter((c) => packCardClass(c) === "prime").every((c) => c.variantId === "future-star"));
  assert.deepEqual([...new Set(CARDS.filter((c) => packCardClass(c) === "icon").map((c) => c.variantId))].sort(), ["moments", "record-breaker"]);
});

/* ───────────────────────────── 2 · TABLA ───────────────────────────── */

test("TABLA · PACK OPENING 3.0: cada tabla del plan suma 1000 ‰, la media por carta suma 100 y las cartas coinciden", () => {
  // El plan exacto lo congela economyFinal.test (A); aquí, sus invariantes.
  for (const id of MAIN_PACK_LINE) {
    const pl = MAIN_PACK_PLAN[id];
    assert.equal(PACK_CLASS_ORDER.reduce((s, k) => s + pl.regular[k], 0), 1000, `${id} normal`);
    assert.equal(PACK_CLASS_ORDER.reduce((s, k) => s + pl.featured[k], 0), 1000, `${id} destacada`);
    assert.equal(pl.cards, pack(id).cardCount, `${id} cartas`);
    assert.ok(pl.ovrTilt >= 0 && Number.isFinite(pl.ovrTilt), id);
    assert.ok(Math.abs(PACK_CLASS_ORDER.reduce((s, k) => s + mainPackDistribution(id)![k], 0) - 100) < 1e-9, id);
  }
  // La inclinación baja al subir de sobre (Champions e Icon, uniformes).
  const tilt = MAIN_PACK_LINE.map((id) => MAIN_PACK_PLAN[id].ovrTilt);
  for (let i = 1; i < tilt.length; i++) assert.ok(tilt[i] <= tilt[i - 1], tilt.join(" ≥ "));
  assert.deepEqual([...MAIN_PACK_LINE], ["estandar", "premium", "oro", "masters", "champions", "icon"]);
});

test("PROGRESIÓN CRÍTICA · P(Prime) y P(Icon) por carta estrictamente crecientes (Pack Opening 3.0: 0,3·0,83·3·5,2·14·64,7 y 0,1·0,25·1,6·3·5,6·35,3)", () => {
  const prime = MAIN_PACK_LINE.map((id) => mainPackDistribution(id)!.prime);
  const icon = MAIN_PACK_LINE.map((id) => mainPackDistribution(id)!.icon);
  assert.deepEqual(prime.map((x) => Math.round(x * 100) / 100), [0.3, 0.83, 3, 5.2, 14, 64.67]);
  assert.deepEqual(icon.map((x) => Math.round(x * 100) / 100), [0.1, 0.25, 1.6, 3, 5.6, 35.33]);
  for (let i = 1; i < MAIN_PACK_LINE.length; i++) {
    assert.ok(prime[i] > prime[i - 1], `Prime: ${MAIN_PACK_LINE[i]} > ${MAIN_PACK_LINE[i - 1]}`);
    assert.ok(icon[i] > icon[i - 1], `Icon: ${MAIN_PACK_LINE[i]} > ${MAIN_PACK_LINE[i - 1]}`);
  }
});

test("TABLA · ids exactos: la línea son los seis; con plan, además los especiales (3.1); ids ajenos o heredados de Object no activan nada", () => {
  const withTable = PACKS.filter((p) => mainPackDistribution(p.id)).map((p) => p.id).sort();
  assert.deepEqual(withTable, ["champions", "estandar", "icon", "masters", "oro", "premium"]);
  for (const id of ["toString", "constructor", "__proto__", "hasOwnProperty", "estandar__x", "", "inicial", "prime"]) {
    assert.equal(packPlan(id), null, id);
    assert.equal(packDrawMode(id), "rarity-weights", id);
  }
  for (const id of ["ewc", "emea", "team-g2"]) { assert.equal(mainPackDistribution(id), null, `${id}: no es de la línea`); assert.ok(packPlan(id), `${id}: tiene plan`); }
  for (const id of MAIN_PACK_LINE) assert.equal(packDrawMode(id), "class-distribution");
});

test("SIN BUCKET VACÍO · toda clase con probabilidad > 0 tiene cartas en el pool real de su sobre", () => {
  for (const id of MAIN_PACK_LINE) {
    const cp = classPool(REG, pack(id), null);
    for (const k of PACK_CLASS_ORDER) if (mainPackDistribution(id)![k] > 0) assert.ok(cp[k].length > 0, `${id}/${k} vacío`);
    assert.deepEqual(validatePack(REG, pack(id)), [], id);
  }
});

/* ───────────────────────────── 3 · power.ts / F57.2 ───────────────────────────── */

test("F57.2 · ningún sobre de la línea tiene techo de OVR: un solo filtro, la tabla", () => {
  for (const id of MAIN_PACK_LINE) assert.equal(powerRuleFor(id), null, id);
  for (const id of Object.keys(PACK_POWER_RULES)) assert.equal(mainPackDistribution(id), null, `${id}: dos filtros a la vez`);
  // El pool elegible de los seis es el catálogo entero: la clase y la tabla deciden, no un techo.
  for (const id of MAIN_PACK_LINE) assert.equal(buildPool(REG, pack(id)).size, 331, id);
});

/* ───────────────────────────── 4 · MOTOR ───────────────────────────── */

test("MOTOR · cada carta de cada sobre pertenece a una clase con probabilidad > 0, y el sobre llega completo", () => {
  for (const id of MAIN_PACK_LINE) {
    const p = pack(id), t = mainPackDistribution(id)!;
    for (let s = 0; s < 3000; s++) {
      const d = draw(p, (s * 2654435761) >>> 0);
      assert.equal(d.length, p.cardCount, `${id} seed ${s}`);
      for (const x of d) assert.ok(t[packCardClass(x.card)!] > 0, `${id}: ${x.card.id} (${packCardClass(x.card)}) no puede salir`);
    }
  }
});

test("MOTOR · reparto observado ≈ tabla (40.000 cartas por sobre, ±0,8 pp)", () => {
  for (const id of MAIN_PACK_LINE) {
    const p = pack(id), t = mainPackDistribution(id)!;
    const n = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, 0])) as Record<PackCardClass, number>;
    let total = 0;
    for (let s = 0; total < 40_000; s++) for (const x of draw(p, s + 1)) { n[packCardClass(x.card)!]++; total++; }
    for (const k of PACK_CLASS_ORDER) {
      const obs = (n[k] / total) * 100;
      assert.ok(Math.abs(obs - t[k]) <= 0.8, `${id}/${k}: esperado ${t[k]} observado ${obs.toFixed(2)}`);
      if (t[k] === 0) assert.equal(n[k], 0, `${id}/${k} imposible`);
    }
  }
});

test("MOTOR · determinista: misma semilla, mismas cartas", () => {
  for (const id of MAIN_PACK_LINE) assert.deepEqual(draw(pack(id), 777).map((d) => d.card.id), draw(pack(id), 777).map((d) => d.card.id));
});

test("FAIL CLOSED · una clase > 0 sin cartas aborta la apertura: nunca cae a otra clase ni al catálogo", () => {
  // El mismo Icon, pero con un pool explícito sin ninguna carta Icon: la clase Icon (30 %) queda vacía.
  // (Registro propio: el pool se cachea por `pack.id` dentro de cada registro.)
  const reg = new CardRegistry();
  const noIcon: PackDef = { ...pack("icon"), pool: CARDS.filter((c) => c.variantId === "future-star").map((c) => c.id) };
  assert.throws(() => openPack(reg, noIcon, { seed: 1, owned: new Set(), pity: freshPity() }), EmptyPackClassError);
  assert.ok(validatePack(reg, noIcon).some((i) => /icon/.test(i.reason)));
  // Las clases SIN probabilidad pueden estar vacías: Icon no necesita Base, Masters ni Champions.
  const reg2 = new CardRegistry();
  const onlyTop: PackDef = { ...pack("icon"), pool: CARDS.filter((c) => ["future-star", "moments", "record-breaker"].includes(c.variantId)).map((c) => c.id) };
  assert.equal(openPack(reg2, onlyTop, { seed: 1, owned: new Set(), pity: freshPity() }).decisions.length, onlyTop.cardCount);
});

test("MOTOR · anti-duplicado y garantías por rareza no sacan la carta de su clase (colección llena)", () => {
  const all = new Set(CARDS.map((c) => c.id));
  for (const id of MAIN_PACK_LINE) {
    for (const policy of ["allow", "avoid", "replace", "upgrade", "compensate"] as const) {
      const p: PackDef = { ...pack(id), antiDuplicate: policy };
      const t = mainPackDistribution(id)!;
      for (let s = 0; s < 400; s++) for (const x of draw(p, s + 11, s % 2 ? all : new Set())) assert.ok(t[packCardClass(x.card)!] > 0, `${id}/${policy}`);
    }
  }
});

/* ───────────────────────────── 5 · ICON ───────────────────────────── */

test("ICON · exactamente 3 cartas (Fase 57.4), todas Prime (Future Star) o Icon (Record Breaker/Moments); precio 60.000 (F80)", () => {
  const icon = pack("icon");
  assert.equal(icon.cardCount, 3);
  assert.equal(icon.price, 60000);
  const engine = new PackEngine();
  const all = CARDS.map((c, i) => ({ uid: `o${i}`, cardId: c.id, variantId: c.variantId, obtainedAt: 0 }) as never);
  for (let s = 0; s < 5000; s++) {
    const r = engine.draw(icon, { seed: s, owned: s % 3 ? [] : all, mintCounts: {}, pity: freshPity(), now: 0 });
    assert.equal(r.instances.length, 3, `seed ${s}`);
    for (const ins of r.instances) {
      const v = REG.card(ins.cardId)!.variantId;
      assert.ok(["future-star", "record-breaker", "moments"].includes(v), `${v} en Icon`);
    }
  }
});

test("ICON · nunca base, masters-l, masters-sdc ni champions-s (propiedad sobre el pool por clase)", () => {
  const cp = classPool(REG, pack("icon"), null);
  const reachable = activeClasses(mainPackDistribution("icon")!).flatMap((k) => cp[k]);
  assert.equal(reachable.length, 23);
  for (const c of reachable) assert.ok(!["base", "masters-l", "masters-sdc", "champions-s"].includes(c.variantId), c.id);
});

/* ───────────────────────────── 6 · UI / GARANTÍA ───────────────────────────── */

test("UI · la ficha de los seis deriva de la tabla: sin filas de rareza, sin techo, cifras exactas", () => {
  for (const id of MAIN_PACK_LINE) {
    const o = packOddsFor(pack(id), null);
    assert.equal(o.rows.length, 0, `${id}: no enseña rarezas`);
    assert.equal(o.powerCap, null);
    assert.equal(o.guaranteedMin, null);
    const t = mainPackDistribution(id)!;
    assert.deepEqual(o.classOdds!.rows.map((r) => [r.cls, Math.round(r.perCard * 1e6)]), activeClasses(t).map((k) => [k, Math.round(t[k] * 1e4)]));
  }
  // Pack Opening 3.1 · los especiales con plan también tienen ficha por clase; los que no (Inicial, Prime) no.
  for (const p of PACKS.filter((x) => !MAIN_PACK_LINE.includes(x.id))) assert.equal(classOddsFor(p) === null, !packPlan(p.id), p.id);
});

test("GARANTÍA · solo Icon comunica garantía («Prime o Icon garantizada»); ningún otro de la línea", () => {
  assert.equal(classGuarantee(mainPackDistribution("icon")!)?.label, "Prime o Icon garantizada");
  for (const id of MAIN_PACK_LINE.filter((x) => x !== "icon")) assert.equal(classOddsFor(pack(id))!.guarantee, null, id);
});

/* ───────────────────────────── 7 · LOS DEMÁS NO CAMBIAN ───────────────────────────── */

test("ESPECIALES (Pack Opening 3.1) · regionales, equipos y EWC sortean por plan; Inicial y Prime siguen por rareza; ninguno entra en la línea", () => {
  const others = PACKS.filter((p) => !MAIN_PACK_LINE.includes(p.id));
  assert.ok(others.length >= 25);
  for (const p of others) {
    const mode = packPlan(p.id) ? "class-distribution" : "rarity-weights";
    assert.equal(packDrawMode(p.id), mode, p.id);
    assert.equal(new PackEngine().odds(p).drawMode, mode, p.id);
    assert.equal(mainPackDistribution(p.id), null, `${p.id} no es de la línea principal`);
  }
  for (const id of ["emea", "americas", "pacific", "china", "ewc", "team-heretics", "team-fnatic", "team-g2", "team-liquid", "team-karmine"]) assert.equal(packDrawMode(id), "class-distribution", id);
  for (const id of ["inicial", "prime"]) assert.equal(packDrawMode(id), "rarity-weights", id);
});
