/**
 * PACK OPENING 3.0 · IDENTIDAD ESTADÍSTICA DE LA LÍNEA PRINCIPAL — fijada para que nadie vuelva a solapar los sobres.
 *
 * 1. EXACTO (`tierIdentity`, sin azar): mejor carta P50/P90/P99, P(≥ 90), P(≥ 95), varios golpes, jackpot y valor por
 *    crédito de cada sobre, y la ESCALERA estricta Bronce < Plata < Oro < Masters < Champions < Icon en todos los ejes.
 * 2. MOTOR REAL (simulación determinista, semillas fijas): lo que entrega `PackEngine` coincide con el cálculo exacto.
 * 3. REGRESIÓN DEL SOBRE PLATA de 2026-10-07 (Xross 95 Future Star + Base 90/88/87 + Munchkin SDC 86 + Base 84): un
 *    jackpot SOLO puede venir de la ranura destacada y el «sobre absurdo» (jackpot + otras ≥ 3 cartas ≥ 86) es rarísimo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { CARDS } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { PackEngine } from "@/pack/engine";
import { freshPity } from "./pity";
import { classPool } from "./openPack";
import { effectiveFeatured, MAIN_PACK_LINE, MAIN_PACK_PLAN, mainPackPlan, packCardClass, PACK_CLASS_ORDER, type MainPackPlan } from "./packClass";
import { tierIdentity, slotCardProbabilities, type TierIdentity } from "./tierIdentity";
import { mainLinePools } from "./odds";
import { packClassPools } from "./packPools";
import { marketValue } from "../economy/pricing";

const REG = new CardRegistry();
const pools = mainLinePools();
// ICON (2026-10-09): con los pesos REALES del servidor (`packClassPools`: pool × tabla de calidad de los sobres ICON).
const ID: Record<string, TierIdentity> = Object.fromEntries(MAIN_PACK_LINE.map((id) => { const pp = packClassPools(getPack(id)!); return [id, tierIdentity(mainPackPlan(id)!, pp.pools, marketValue, pp.weightOf)]; }));
const FIVE = MAIN_PACK_LINE.filter((id) => id !== "icon-single" && id !== "icon");
const price = (id: string) => getPack(id)!.price;

test("POOLS · el pool por clase de la ficha es EXACTAMENTE el del motor para los seis sobres", () => {
  for (const id of MAIN_PACK_LINE) {
    const cp = classPool(REG, getPack(id)!, null);
    for (const k of PACK_CLASS_ORDER) assert.deepEqual(cp[k].map((c) => c.id).sort(), pools[k].map((c) => c.id).sort(), `${id}/${k}`);
  }
});

test("IDENTIDAD EXACTA · cada sobre, sus cifras (mejor carta, ≥ 90, ≥ 95, varios golpes, jackpot, valor/crédito)", () => {
  // [p50, p90, p99] de la mejor carta; P(mejor ≥ 90), P(mejor ≥ 95), P(≥ 2 cartas ≥ 90), jackpot, valor por crédito.
  const want: Record<string, { best: number[]; ge90: number; ge95: number; two90: number; jackpot: number; perCredit: number }> = {
    // ICON POR SOBRE (2026-10-09): Icon 1 · 5 · 10 · 15 · 20 · 100 % por sobre (Masters, idéntico a 3.0) y Sobre Icon de 1 carta.
    estandar: { best: [84, 88, 92], ge90: 0.0465, ge95: 0.0054, two90: 0.0004, jackpot: 0.0249, perCredit: 0.544 },
    premium: { best: [88, 91, 95], ge90: 0.215, ge95: 0.0307, two90: 0.0141, jackpot: 0.0982, perCredit: 0.680 },
    oro: { best: [90, 94, 95], ge90: 0.6281, ge95: 0.0932, two90: 0.2111, jackpot: 0.2467, perCredit: 0.740 },
    masters: { best: [92, 95, 95], ge90: 0.841, ge95: 0.2171, two90: 0.4683, jackpot: 0.41, perCredit: 0.790 },
    champions: { best: [94, 95, 95], ge90: 0.9352, ge95: 0.3939, two90: 0.6744, jackpot: 0.7506, perCredit: 0.791 },
    // DOS SOBRES ICON (2026-10-09): 1 Icon a 30.000 y 3 Icon a 60.000, cada carta PatMen 65 % · marteen 17,5 % · mada 17,5 %.
    "icon-single": { best: [92, 95, 95], ge90: 1, ge95: 0.35, two90: 0, jackpot: 1, perCredit: 0.708 },
    icon: { best: [95, 95, 95], ge90: 1, ge95: 0.7254, two90: 1, jackpot: 1, perCredit: 0.796 }, // 80.000 (a 60.000: 1,062)
  };
  for (const id of MAIN_PACK_LINE) {
    const r = ID[id], w = want[id];
    assert.deepEqual([r.best.p50, r.best.p90, r.best.p99], w.best, `${id} mejor carta`);
    assert.ok(Math.abs(r.bestAtLeast[90] - w.ge90) < 0.0006, `${id} ≥90 ${r.bestAtLeast[90]}`);
    assert.ok(Math.abs(r.bestAtLeast[95] - w.ge95) < 0.0006, `${id} ≥95 ${r.bestAtLeast[95]}`);
    assert.ok(Math.abs(r.ge90Count.atLeast2 - w.two90) < 0.0006, `${id} 2×≥90 ${r.ge90Count.atLeast2}`);
    assert.ok(Math.abs(r.jackpot - w.jackpot) < 0.0006, `${id} jackpot ${r.jackpot}`);
    assert.ok(Math.abs(r.expectedValue / price(id) - w.perCredit) < 0.0015, `${id} valor/crédito ${r.expectedValue / price(id)}`);
  }
});

test("ESCALERA ESTRICTA · Bronce < Plata < Oro < Masters < Champions en todos los ejes; los dos sobres ICON, por encima en calidad", () => {
  const axes: [string, (r: TierIdentity, id: string) => number][] = [
    ["mejor carta media", (r) => r.best.mean], ["P(≥90)", (r) => r.bestAtLeast[90]], ["P(≥95)", (r) => r.bestAtLeast[95]],
    ["P(2×≥90)", (r) => r.ge90Count.atLeast2], ["P(3×≥90)", (r) => r.ge90Count.atLeast3], ["valor/crédito", (r, id) => r.expectedValue / price(id)],
    ["OVR medio", (r) => r.meanOvr],
  ];
  for (const [name, f] of axes) {
    const v = FIVE.map((id) => f(ID[id], id));
    for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], `${name}: ${FIVE[i]} (${v[i]}) > ${FIVE[i - 1]} (${v[i - 1]})`);
  }
  // DOS SOBRES ICON (2026-10-09): ambos por encima de Champions en P(≥ 90) y OVR medio; el Premium (3 Icon) además en
  // mejor carta media, P(≥ 95) y varios golpes. VALOR POR CRÉDITO (PENDIENTE DE DECISIÓN, precios fijados por el
  // propietario): el Sobre ICON (0,71) queda por debajo de Champions y el Premium a 80.000 (0,796) apenas por encima (+0,6 %).
  for (const id of ["icon-single", "icon"]) for (const [name, f] of axes.filter(([n]) => ["P(≥90)", "OVR medio"].includes(n))) assert.ok(f(ID[id], id) > f(ID.champions, "champions"), `${name}: ${id} > Champions`);
  for (const [name, f] of axes.filter(([n]) => ["mejor carta media", "P(≥95)", "P(2×≥90)", "P(3×≥90)"].includes(n))) assert.ok(f(ID.icon, "icon") > f(ID.champions, "champions"), `${name}: Premium > Champions`);
  const perCredit = (id: string) => ID[id].expectedValue / price(id);
  assert.ok(perCredit("icon-single") < perCredit("champions") && perCredit("icon") > Math.max(...FIVE.map(perCredit)), "valor por crédito de los sobres ICON (fijado: riesgo pendiente)");
  // El jackpot de clase crece estrictamente hasta Champions; los dos sobres ICON lo garantizan (100 %).
  const j = FIVE.map((id) => ID[id].jackpot);
  for (let i = 1; i < j.length; i++) assert.ok(j[i] > j[i - 1]);
  assert.deepEqual([ID["icon-single"].jackpot, ID.icon.jackpot], [1, 1]);
});

test("SIN GARANTÍA DE LO MEJOR · ni Champions ni Icon garantizan un 95 (la colección no se resuelve sola)", () => {
  assert.ok(ID.champions.bestAtLeast[95] < 0.5);
  assert.ok(ID.icon.bestAtLeast[95] < 0.75); // Premium: 1 − 0,65³ = 72,54 %
  assert.ok(Math.abs(ID["icon-single"].bestAtLeast[95] - 0.35) < 1e-12);
});

test("JACKPOT POSIBLE · Bronce y Plata pueden dar una Prime/Icon y un 95, pero solo como golpe raro (≤ 0,6 % y ≤ 3,1 % de sobres)", () => {
  // ICON POR SOBRE (2026-10-09) · PENDIENTE DE DECISIÓN: 2 de las 3 Icon son de OVR 95, así que subir la Icon de Plata del
  // 1,5 % al 5 % sube su P(≥ 95) del 1,3 % al 3,1 % (Bronce, del 0,31 % al 0,54 %). Se fijan los nuevos topes, medidos.
  assert.ok(ID.estandar.bestAtLeast[95] > 0 && ID.estandar.bestAtLeast[95] <= 0.006);
  assert.ok(ID.premium.bestAtLeast[95] > 0 && ID.premium.bestAtLeast[95] <= 0.031);
});

test("UNA SOLA RANURA DE JACKPOT · en Bronce y Plata Champions/Prime/Icon solo existen en la destacada (presupuesto de calidad)", () => {
  for (const id of ["estandar", "premium"]) {
    const pl = MAIN_PACK_PLAN[id];
    for (const k of ["champions", "prime", "icon"] as const) {
      assert.equal(pl.regular[k], 0, `${id}: ${k} en un hueco normal`);
      assert.ok(effectiveFeatured(pl)[k] > 0, `${id}: ${k} debe seguir siendo posible (jackpot)`);
    }
  }
});

test("INCLINACIÓN · en Plata, dentro de la clase Masters, un 95 es ~ 7 veces menos probable que un 86; en Champions, igual de probable", () => {
  const ratio = (plan: MainPackPlan, a: string, b: string) => {
    const pr = slotCardProbabilities(plan.featured, pools, plan);
    return pr.get(a)!.p / pr.get(b)!.p;
  };
  const m95 = CARDS.find((c) => packCardClass(c) === "masters" && c.ovr === 95)!, m86 = CARDS.find((c) => packCardClass(c) === "masters" && c.ovr === 86)!;
  assert.ok(Math.abs(ratio(MAIN_PACK_PLAN.premium, m95.id, m86.id) - Math.exp(-0.22 * 9)) < 1e-9);
  const c95 = CARDS.find((c) => packCardClass(c) === "champions" && c.ovr === 95)!, c87 = CARDS.find((c) => packCardClass(c) === "champions" && c.ovr === 87)!;
  assert.ok(Math.abs(ratio(MAIN_PACK_PLAN.champions, c95.id, c87.id) - 1) < 1e-9);
});

/** Simulación determinista del motor real (las mismas semillas siempre). */
function simulate(id: string, n: number) {
  const engine = new PackEngine(REG);
  const pack = getPack(id)!;
  let ge90 = 0, ge95 = 0, two90 = 0, absurd = 0, jack = 0, value = 0;
  for (let i = 0; i < n; i++) {
    const cards = engine.draw(pack, { seed: (i * 2654435761 + 777) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 }).instances.map((x) => REG.card(x.cardId)!);
    const best = Math.max(...cards.map((c) => c.ovr));
    const n90 = cards.filter((c) => c.ovr >= 90).length, n86 = cards.filter((c) => c.ovr >= 86).length;
    const top = cards.filter((c) => { const k = packCardClass(c); return k === "prime" || k === "icon"; }).length;
    if (best >= 90) ge90++; if (best >= 95) ge95++; if (n90 >= 2) two90++; if (top >= 1) jack++;
    if (top >= 1 && n86 - 1 >= 3) absurd++;
    value += cards.reduce((a, c) => a + marketValue(c), 0);
  }
  return { ge90: ge90 / n, ge95: ge95 / n, two90: two90 / n, jackpot: jack / n, absurd: absurd / n, ev: value / n };
}

test("MOTOR REAL = CÁLCULO EXACTO · 20.000 aperturas deterministas por sobre (±4 σ)", () => {
  const N = 20_000;
  for (const id of MAIN_PACK_LINE) {
    const s = simulate(id, N), r = ID[id];
    const tol = (p: number) => 4 * Math.sqrt(Math.max(p * (1 - p), 1e-6) / N) + 1e-4;
    assert.ok(Math.abs(s.ge90 - r.bestAtLeast[90]) < tol(r.bestAtLeast[90]), `${id} ≥90 motor ${s.ge90} vs ${r.bestAtLeast[90]}`);
    assert.ok(Math.abs(s.ge95 - r.bestAtLeast[95]) < tol(r.bestAtLeast[95]), `${id} ≥95 motor ${s.ge95} vs ${r.bestAtLeast[95]}`);
    assert.ok(Math.abs(s.two90 - r.ge90Count.atLeast2) < tol(r.ge90Count.atLeast2), `${id} 2×≥90 motor ${s.two90} vs ${r.ge90Count.atLeast2}`);
    assert.ok(Math.abs(s.jackpot - r.jackpot) < tol(r.jackpot), `${id} jackpot motor ${s.jackpot} vs ${r.jackpot}`);
    assert.ok(Math.abs(s.ev / r.expectedValue - 1) < 0.05, `${id} valor motor ${s.ev} vs ${r.expectedValue}`);
  }
});

test("REGRESIÓN · SOBRE PLATA 2026-10-07: el «sobre absurdo» (Prime/Icon + otras ≥ 3 cartas ≥ 86) baja del 14,4 % a < 0,5 %", () => {
  // Medido con la distribución anterior (F57.3, mismo motor): 14,4 % de los Plata eran «absurdos», 19,8 % traían un 95 y
  // 26,9 % traían dos cartas ≥ 90. Con Pack Opening 3.0, determinista:
  const s = simulate("premium", 50_000);
  assert.ok(s.absurd < 0.005, `absurdos ${s.absurd}`);
  // ICON POR SOBRE (2026-10-09, PENDIENTE DE DECISIÓN): Icon del 5 % → ≥ 95 sube a ≈ 3,1 % (antes < 1,6 %).
  assert.ok(s.ge95 < 0.033, `≥95 ${s.ge95}`);
  assert.ok(s.two90 < 0.016, `2×≥90 ${s.two90}`);
  // La composición EXACTA de aquel sobre (1 Prime + 3 Oro + 1 Masters + 1 Plata): antes 0,47 % de los Plata; ahora el
  // Prime solo cabe en la destacada y los 5 normales deberían dar 3 Oro + 1 Masters + 1 Plata.
  const pl = MAIN_PACK_PLAN.premium;
  const reg = (k: "plata" | "oro" | "masters") => pl.regular[k] / 1000;
  const multinomial = 20; // 5! / (3! · 1! · 1!)
  const now = (effectiveFeatured(pl).prime / 1000) * multinomial * reg("oro") ** 3 * reg("masters") * reg("plata");
  const before = 120 * 0.05 * 0.25 ** 3 * 0.10 * 0.50; // 6! / (1! 3! 1! 1!) con la tabla F57.3 (Prime 5 · Oro 25 · Masters 10 · Plata 50)
  assert.ok(Math.abs(before - 0.0046875) < 1e-12);
  // ≈ 56 veces menos probable SOLO por las clases (0,47 % → 0,0083 %); además, dentro de cada clase, la inclinación por
  // OVR de Plata hace a Xross 95 y a la Base 90 mucho menos probables que las cartas bajas de su clase.
  assert.ok(now < before / 50, `composición de referencia: ahora ${now}, antes ${before}`);
});
