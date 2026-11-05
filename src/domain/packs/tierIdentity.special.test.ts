/**
 * PACK OPENING 3.1 · CONTRATO DE IDENTIDAD DE LOS SOBRES ESPECIALES (regionales, de equipo, EWC) — hermano de
 * `tierIdentity.test.ts` (línea principal). Fija lo que 3.1 arregló para que nadie lo vuelva a romper:
 *
 *   · todos sortean con el MISMO motor por ranuras + inclinación (cada equipo con el plan de su región);
 *   · ninguno comprable rinde por crédito más que el Sobre Plata, ni da ≥ 95 más que él, ni deja desguazar > 10 %;
 *   · la compuerta económica deja pasar a los vendibles y bloquea los outliers (fallo cerrado);
 *   · el sesgo de equipo del código es el de la BD; el motor con los pools de PRODUCCIÓN = el cálculo exacto;
 *   · pool respetado, clase imposible nunca elegida, carta destacada de EWC siempre Champions/Icon, odds públicas = motor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "@/collection/registry";
import { PACKS, getPack } from "@/data/packs";
import { PackEngine } from "@/pack/engine";
import { freshPity } from "./pity";
import { isPurchasable } from "./lifecycle";
import { MAIN_PACK_LINE, SPECIAL_PACK_PLAN, packPlan, packCardClass, PACK_CLASS_ORDER } from "./packClass";
import { tierIdentity } from "./tierIdentity";
import { packClassPools } from "./packPools";
import { packEconomyReport, economyLimits, economySellable } from "./economyGate";
import { composeDistribution, type PackDistribution, type PoolDef } from "./distribution";
import { classOddsFor } from "./odds";
import { marketValue } from "../economy/pricing";
import { salvageValue } from "../economy/salvage";
import type { PackDef } from "./types";

const REG = new CardRegistry();
const SPECIALS = PACKS.filter((p) => !MAIN_PACK_LINE.includes(p.id) && (p.restrictRegion || p.team || p.eventId === "ewc-2026"));
const BUYABLE_SPECIALS = PACKS.filter((p) => !MAIN_PACK_LINE.includes(p.id) && p.price > 0 && isPurchasable(p));
const REGION_PACK: Record<string, string> = { EMEA: "emea", Americas: "americas", Pacific: "pacific", China: "china" };
const exact = (p: PackDef) => {
  const pp = packClassPools(p); const plan = packPlan(p.id)!;
  return { v: tierIdentity(plan, pp.pools, marketValue, pp.weightOf), s: tierIdentity(plan, pp.pools, salvageValue, pp.weightOf) };
};
const ratio = (id: string) => exact(getPack(id)!).v.expectedValue / getPack(id)!.price;

/** La distribución de producción (foto de `app_content_distribution_snapshot`, 2026-10-07) tal como la compone el servidor. */
type Snap = { pools: { id: string; mode: PoolDef["mode"]; rules: PoolDef["rules"] }[]; entries: { pool_id: string; card_id: string; weight: number | string; mode: "INCLUDE" | "EXCLUDE" }[]; packPools: { pack_id: string; pool_id: string; priority: number }[] };
const SNAP = JSON.parse(readFileSync(join(process.cwd(), "docs/product/qa/pack31/prod-distribution-snapshot.json"), "utf8")) as Snap;
function prodDist(packId: string): PackDistribution | null {
  const pools = new Map<string, PoolDef>();
  for (const p of SNAP.pools) pools.set(p.id, { id: p.id, mode: p.mode, rules: p.rules ?? {}, entries: [], availableFrom: null, availableTo: null });
  for (const e of SNAP.entries) pools.get(e.pool_id)?.entries.push({ cardId: e.card_id, weight: Number(e.weight), mode: e.mode });
  const list = SNAP.packPools.filter((x) => x.pack_id === packId).map((x) => ({ pool: pools.get(x.pool_id)!, priority: x.priority }));
  return list.length ? composeDistribution(list, Date.now()) : null;
}

test("3.1 PLANES · todo regional, de equipo y EWC sortea por plan; cada equipo con el plan de SU región; Inicial y Prime no", () => {
  assert.ok(SPECIALS.length >= 24);
  for (const p of SPECIALS) assert.ok(packPlan(p.id), `${p.id} sin plan`);
  for (const p of PACKS.filter((x) => x.team)) assert.equal(SPECIAL_PACK_PLAN[p.id], SPECIAL_PACK_PLAN[REGION_PACK[p.restrictRegion!]], `${p.id} ≠ plan de ${p.restrictRegion}`);
  for (const id of ["inicial", "prime"]) assert.equal(packPlan(id), null, id);
  for (const p of SPECIALS) assert.equal(packPlan(p.id)!.cards, p.cardCount, p.id);
});

test("3.1 IDENTIDAD EXACTA · regionales, China y EWC (precio, valor/crédito, mejor ≥ 90 y ≥ 95)", () => {
  const want: Record<string, { price: number; perCredit: number; ge90: number; ge95: number }> = {
    emea: { price: 3500, perCredit: 0.442, ge90: 0.1005, ge95: 0.0033 },
    americas: { price: 3500, perCredit: 0.452, ge90: 0.0724, ge95: 0.0032 },
    pacific: { price: 3500, perCredit: 0.459, ge90: 0.038, ge95: 0.0022 },
    china: { price: 9500, perCredit: 0.488, ge90: 0.1329, ge95: 0.0009 },
    ewc: { price: 8500, perCredit: 0.535, ge90: 0.1377, ge95: 0.0119 },
  };
  for (const [id, w] of Object.entries(want)) {
    const p = getPack(id)!; const { v } = exact(p);
    assert.equal(p.price, w.price, id);
    assert.ok(Math.abs(v.expectedValue / p.price - w.perCredit) < 0.0015, `${id} ${v.expectedValue / p.price}`);
    assert.ok(Math.abs(v.bestAtLeast[90] - w.ge90) < 0.0015, `${id} ≥90 ${v.bestAtLeast[90]}`);
    assert.ok(Math.abs(v.bestAtLeast[95] - w.ge95) < 0.0005, `${id} ≥95 ${v.bestAtLeast[95]}`);
  }
});

test("3.1 NINGÚN EXPLOIT · cada especial comprable rinde por crédito MENOS que el Plata, da ≥ 95 menos que él y el desguace no pasa del 10 %", () => {
  const lim = economyLimits();
  assert.ok(Math.abs(lim.maxPerCredit - ratio("premium")) < 1e-9, "el ancla es el Plata");
  assert.ok(BUYABLE_SPECIALS.length >= 10);
  for (const p of BUYABLE_SPECIALS) {
    const { v, s } = exact(p);
    assert.ok(v.expectedValue / p.price < lim.maxPerCredit, `${p.id} ${v.expectedValue / p.price}`);
    assert.ok(v.bestAtLeast[95] <= lim.maxP95, `${p.id} ≥95 ${v.bestAtLeast[95]}`);
    assert.ok(s.expectedValue / p.price <= 0.1, `${p.id} desguace ${s.expectedValue / p.price}`);
    // Con targeting (región o equipo) y al precio de 3.500, por debajo incluso del Bronce.
    if (p.restrictRegion && p.restrictRegion !== "China") assert.ok(v.expectedValue / p.price < ratio("estandar"), `${p.id} ≥ Bronce`);
  }
});

test("3.1 EQUIPOS · el sesgo de cada equipo mueve su valor como mucho ±10 % del de su región; ningún equipo es «el sobre para farmear»", () => {
  for (const p of PACKS.filter((x) => x.team && x.restrictRegion !== "China")) {
    const team = exact(p).v.expectedValue, region = exact(getPack(REGION_PACK[p.restrictRegion!])!).v.expectedValue;
    assert.ok(Math.abs(team / region - 1) <= 0.1, `${p.id}: ${(team / region).toFixed(3)} × su región`);
  }
  const vals = BUYABLE_SPECIALS.filter((p) => p.team).map((p) => exact(p).v.expectedValue / p.price).sort((a, b) => a - b);
  assert.ok(vals.at(-1)! / vals[0] < 1.15, `dispersión ${vals.map((x) => x.toFixed(3))}`);
});

test("3.1 COMPUERTA · los especiales a la venta pasan; un outlier, un sobre sin plan y un equipo sin cartas se bloquean (fallo cerrado)", () => {
  for (const p of BUYABLE_SPECIALS) assert.deepEqual(packEconomyReport(p).issues, [], p.id);
  for (const p of BUYABLE_SPECIALS) assert.equal(economySellable(p).ok, true, p.id);
  const codes = (p: PackDef) => packEconomyReport(p).issues.map((i) => i.code);
  assert.ok(codes({ ...getPack("pacific")!, price: 1000 }).includes("VALUE_PER_CREDIT_OUTLIER"));
  assert.ok(codes({ ...getPack("pacific")!, id: "qa-sin-plan", price: 3500 }).includes("PLAN_REQUIRED"));
  assert.ok(codes(getPack("team-blg")!).includes("TEAM_POOL_TOO_SMALL"));
  assert.equal(economySellable({ ...getPack("pacific")!, price: 1000 }).ok, false);
  assert.equal(economySellable(getPack("estandar")!).ok, true, "la línea principal tiene su propio contrato");
});

test("3.1 SESGO = BD · el peso de equipo del código (isTeamPackCard × 5) es EXACTAMENTE el de los pools boost-team-* de producción", () => {
  let checked = 0;
  for (const p of PACKS.filter((x) => x.team)) {
    const d = prodDist(p.id); if (!d) continue;
    const pp = packClassPools(p);
    for (const k of PACK_CLASS_ORDER) for (const c of pp.pools[k]) { assert.equal(d.weightOf(c.id), pp.weightOf(c), `${p.id}/${c.id}`); checked++; }
  }
  assert.ok(checked > 1000, String(checked));
});

test("3.1 MOTOR REAL (pools de PRODUCCIÓN) = CÁLCULO EXACTO · 8.000 aperturas deterministas; pool, clases y carta destacada respetados", () => {
  const N = 8000;
  for (const id of ["emea", "pacific", "china", "ewc", "team-g2", "team-ns"]) {
    const pack = getPack(id)!; const d = prodDist(id);
    const engine = new PackEngine(REG, (x) => (x === id ? d : null));
    const r = exact(pack).v;
    const pp = packClassPools(pack);
    const eligible = new Set(PACK_CLASS_ORDER.flatMap((k) => pp.pools[k].map((c) => c.id)));
    let ge90 = 0, val = 0;
    for (let i = 0; i < N; i++) {
      const cards = engine.draw(pack, { seed: (i * 2654435761 + 31) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 }).instances.map((x) => REG.card(x.cardId)!);
      assert.equal(cards.length, pack.cardCount);
      for (const c of cards) assert.ok(eligible.has(c.id), `${id}: ${c.id} fuera de su pool`);
      if (id === "china") for (const c of cards) assert.ok(["masters", "champions"].includes(packCardClass(c)!), `${id}: clase imposible ${c.id}`);
      if (id === "pacific") for (const c of cards) assert.ok(c.id && eligible.has(c.id));
      if (id === "ewc") assert.ok(["champions", "icon"].includes(packCardClass(cards[cards.length - 1])!), "EWC: la carta destacada es Champions o Icon");
      if (Math.max(...cards.map((c) => c.ovr)) >= 90) ge90++;
      val += cards.reduce((a, c) => a + marketValue(c), 0);
    }
    const tol = 4 * Math.sqrt(Math.max(r.bestAtLeast[90] * (1 - r.bestAtLeast[90]), 1e-6) / N) + 1e-3;
    assert.ok(Math.abs(ge90 / N - r.bestAtLeast[90]) < tol, `${id} ≥90 motor ${ge90 / N} vs ${r.bestAtLeast[90]}`);
    assert.ok(Math.abs(val / N / r.expectedValue - 1) < 0.06, `${id} valor motor ${val / N} vs ${r.expectedValue}`);
  }
});

test("3.1 ODDS PÚBLICAS = MOTOR · la ficha de cada especial comprable sale del plan y su pool (suma 1, ranuras y mejor carta exacta)", () => {
  for (const p of BUYABLE_SPECIALS) {
    const o = classOddsFor(p)!; assert.ok(o, p.id);
    const r = exact(p).v;
    assert.ok(Math.abs(o.slots.bestAtLeast.ovr95 - r.bestAtLeast[95]) < 1e-12 && Math.abs(o.slots.bestAtLeast.ovr90 - r.bestAtLeast[90]) < 1e-12, p.id);
    assert.ok(Math.abs(o.rows.reduce((a, x) => a + x.perCard, 0) - 1) < 1e-9, `${p.id}: las probabilidades suman 1`);
    assert.ok(Math.abs(o.slots.featured.rows.reduce((a, x) => a + x.p, 0) - 1) < 1e-9, p.id);
  }
  assert.equal(classOddsFor(getPack("ewc")!)!.guarantee, "Champions o Icon garantizada en la carta destacada");
});

test("3.1 REGRESIÓN · Pacific ya no es una moneda al aire para un 95, y ningún especial rinde 5× la línea", () => {
  // Medido antes (motor real + pools de producción, 200.000 aperturas): Pacific ≥ 95 en el 46,2 % de los sobres; EMEA,
  // Americas, Pacific, equipos y EWC entre 5,0 y 5,7 de valor por crédito; China 2,7.
  const pac = exact(getPack("pacific")!).v;
  assert.ok(pac.bestAtLeast[95] < 0.01 && pac.bestAtLeast[95] > 0, `Pacific ≥95 ${pac.bestAtLeast[95]} (posible, pero raro)`);
  for (const p of BUYABLE_SPECIALS) assert.ok(exact(p).v.expectedValue / p.price < 0.6, p.id);
});
