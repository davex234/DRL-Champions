/**
 * ICON POR SOBRE (2026-10-09) — el contrato de la probabilidad de Icon de la línea principal.
 *
 *   1. CONFIGURACIÓN · 1 · 5 · 10 · 15 · 20 % por SOBRE (`ICON_CHANCE_BP`) + dos sobres ICON: `icon-single` (30.000, 1/1
 *      Icon) e `icon` (60.000, id histórico, 3/3 Icon independientes), con la tabla APROBADA 65 / 17,5 / 17,5 por carta.
 *   2. EXACTITUD MATEMÁTICA · `rollBasisPoints` devuelve `true` con probabilidad bp/10.000 exacta (demostración por conteo
 *      de residuos, sin simular) y el cálculo exacto del sobre da P(≥ 1 Icon) = la probabilidad configurada.
 *   3. POR SOBRE, NO POR CARTA · como mucho UNA Icon por sobre (no Icon pack), siempre en la destacada; la probabilidad no
 *      depende del nº de cartas; el sorteo es el PRIMERO del sobre y un negativo = ninguna Icon (sin otra ruta).
 *   4. SOBRES ICON · 1/1 y 3/3 Icon, pesos exactos, repetidas permitidas, P(≥ 1 de 95) del Premium = 72,5375 %.
 *   5. LO DEMÁS NO CAMBIA · huecos normales idénticos a Pack Opening 3.0; la destacada sin Icon conserva sus proporciones;
 *      los especiales siguen con su tabla.
 *   6. SIMULACIÓN · 100.000 aperturas deterministas por sobre con el motor real: frecuencia compatible (±4 σ).
 *   7. CALIDAD · aprobada la alternativa A; la propuesta de 4 niveles no es aplicable al catálogo real (fallo cerrado).
 *   8. WALKOUT 0.9 · una Icon obtenida (en el Sobre Icon o en cualquier otro) se presenta como MEGA_WALKOUT.
 */
import { randomInt } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { PackEngine } from "@/pack/engine";
import { makeRng, type Rng } from "@/sim/rng";
import { marketValue } from "@/domain/economy/pricing";
import { buildRevealPlan, toOpenedInstances } from "./reveal";
import { packWalkoutQueue, walkoutFlow } from "@/domain/walkout/packWalkout";
import { freshPity } from "./pity";
import { openPack, rollBasisPoints, BP_LIMIT } from "./openPack";
import {
  ICON_CHANCE_BP, MAIN_PACK_LINE, MAIN_PACK_PLAN, SPECIAL_PACK_PLAN, PACK_CLASS_ORDER, effectiveFeatured, iconChanceOf, guaranteedIcons, packCardClass, packPlan,
  type ClassTable,
} from "./packClass";
import { slotTables, slotCardProbabilities } from "./tierIdentity";
import { iconOddsFor, ICON_COPY } from "./odds";
import { packClassPools } from "./packPools";
import {
  ICON_QUALITY_STATUS, ICON_QUALITY_PROPOSAL, ICON_QUALITY_ALTERNATIVES, activeIconQuality, iconValueLevels, iconQualityWeights,
  iconQualityWeightOf, qualityTableApplies,
} from "./iconQuality";
import { pickWeighted } from "./weighted";

const REG = new CardRegistry();
const WANT: Record<string, number> = { estandar: 0.01, premium: 0.05, oro: 0.1, masters: 0.15, champions: 0.2, "icon-single": 1, icon: 1 };
const ICON_PACKS = ["icon-single", "icon"] as const;
const FIVE = MAIN_PACK_LINE.filter((x) => !(ICON_PACKS as readonly string[]).includes(x));
/** Probabilidad aprobada de cada Icon POR CARTA en los sobres ICON. */
const PER_CARD: Record<string, number> = { "patmen__record-breaker": 0.65, "marteen__record-breaker": 0.175, "mada__moments": 0.175 };
const isIcon = (cardId: string) => packCardClass(REG.card(cardId)!) === "icon";
const draw = (id: string, seed: number) => openPack(REG, getPack(id)!, { seed, owned: new Set(), pity: freshPity() }).decisions;
const seedOf = (i: number) => (i * 2654435761 + 4242) >>> 0;

/* ───────────────────────────── 1 · CONFIGURACIÓN ───────────────────────────── */

test("CONFIG · cinco sobres con Icon por sobre (puntos básicos, una sola fuente) y dos sobres ICON (1/1 a 30.000, 3/3 a 80.000)", () => {
  assert.deepEqual({ ...ICON_CHANCE_BP }, { estandar: 100, premium: 500, oro: 1000, masters: 1500, champions: 2000 });
  assert.deepEqual([...MAIN_PACK_LINE], ["estandar", "premium", "oro", "masters", "champions", "icon-single", "icon"]);
  for (const id of FIVE) {
    assert.equal(MAIN_PACK_PLAN[id].iconChanceBp, ICON_CHANCE_BP[id], id);
    assert.equal(packPlan(id)!.iconChanceBp, ICON_CHANCE_BP[id], `${id}: el plan del motor`);
    assert.equal(guaranteedIcons(id), 0, id);
  }
  for (const id of MAIN_PACK_LINE) assert.equal(iconChanceOf(id), WANT[id], id);
  assert.deepEqual(ICON_PACKS.map((id) => [getPack(id)!.name, getPack(id)!.price, getPack(id)!.cardCount, guaranteedIcons(id)]), [["Sobre ICON", 30000, 1, 1], ["Sobre ICON Premium", 80000, 3, 3]]);
  // Precios y cartas de Bronce…Champions, intactos.
  assert.deepEqual(FIVE.map((id) => [getPack(id)!.price, getPack(id)!.cardCount]), [[2500, 5], [6000, 6], [12000, 5], [20000, 5], [35000, 5]]);
});

/* ───────────────────────────── 2 · EXACTITUD MATEMÁTICA ───────────────────────────── */

/** Un RNG que devuelve exactamente los enteros de 32 bits dados (como hace mulberry32: k / 2^32). */
const fixed = (xs: number[]): Rng & { used: number } => {
  let i = 0;
  const r = { used: 0, next: () => { r.used++; return xs[i++] / 4294967296; }, int: () => 0, chance: () => false, pick: <T>(a: readonly T[]) => a[0] };
  return r;
};

test("EXACTO · rollBasisPoints: P = bp/10.000 exacta (conteo de residuos sobre el rango aceptado, sin simular)", () => {
  // BP_LIMIT es el mayor múltiplo de 10.000 ≤ 2^32: el rango aceptado [0, BP_LIMIT) contiene cada residuo mod 10.000
  // EXACTAMENTE BP_LIMIT / 10.000 veces. Por tanto #{x : x mod 10.000 < bp} / BP_LIMIT = bp · (BP_LIMIT/10.000) / BP_LIMIT.
  assert.equal(BP_LIMIT % 10000, 0);
  assert.ok(BP_LIMIT <= 4294967296 && 4294967296 - BP_LIMIT < 10000);
  const per = BP_LIMIT / 10000;
  for (const bp of Object.values(ICON_CHANCE_BP)) assert.equal((bp * per) / BP_LIMIT, bp / 10000, `bp ${bp}`);
  // Y la función hace exactamente eso: para TODO residuo r (y varios cocientes, incluido el último aceptado), true ⟺ r < bp.
  for (const bp of [100, 500, 1000, 1500, 2000]) {
    for (const q of [0, 1, 7, per - 1]) {
      for (let r = 0; r < 10000; r++) assert.equal(rollBasisPoints(fixed([q * 10000 + r]), bp), r < bp, `bp ${bp} q ${q} r ${r}`);
    }
  }
});

test("EXACTO · rollBasisPoints: rechaza la cola [BP_LIMIT, 2^32) y vuelve a tirar; 0 y 10.000 no consumen azar; bp inválido falla", () => {
  const rng = fixed([BP_LIMIT, 4294967295, 99]);
  assert.equal(rollBasisPoints(rng, 100), true);
  assert.equal(rng.used, 3, "dos rechazos y una tirada aceptada (99 < 100)");
  const none = fixed([]);
  assert.equal(rollBasisPoints(none, 0), false); assert.equal(rollBasisPoints(none, 10000), true); assert.equal(none.used, 0);
  for (const bad of [-1, 10001, 1.5, Number.NaN]) assert.throws(() => rollBasisPoints(fixed([0]), bad), RangeError);
});

test("EXACTO · el cálculo exacto del sobre (mismas tablas que el motor) da P(≥ 1 Icon) = la configurada, y no depende del nº de cartas", () => {
  const pIconSlot = (t: ClassTable) => t.icon / PACK_CLASS_ORDER.reduce((a, k) => a + t[k], 0);
  for (const id of MAIN_PACK_LINE) {
    const plan = MAIN_PACK_PLAN[id];
    const slots = slotTables(plan).map((t) => (PACK_CLASS_ORDER.reduce((a, k) => a + t[k], 0) > 0 ? pIconSlot(t) : 0));
    const atLeastOne = 1 - slots.reduce((a, p) => a * (1 - p), 1);
    assert.ok(Math.abs(atLeastOne - WANT[id]) < 1e-12, `${id}: ${atLeastOne}`);
    if ((ICON_PACKS as readonly string[]).includes(id)) { assert.ok(slots.every((p) => p === 1), `${id}: todas Icon`); continue; }
    // Solo la destacada puede tener Icon: el porcentaje no se aplica por carta.
    assert.ok(slots.slice(0, -1).every((p) => p === 0), `${id}: Icon en un hueco normal`);
    // Mismo plan con otro número de cartas → la misma probabilidad por sobre.
    if (plan.cards > 1) for (const cards of [2, 9]) {
      const other = slotTables({ ...plan, cards }).map((t) => (PACK_CLASS_ORDER.reduce((a, k) => a + t[k], 0) > 0 ? pIconSlot(t) : 0));
      assert.ok(Math.abs(1 - other.reduce((a, p) => a * (1 - p), 1) - WANT[id]) < 1e-12, `${id} con ${cards} cartas`);
    }
  }
});

/* ───────────────────────────── 3 · POR SOBRE, NO POR CARTA ───────────────────────────── */

test("UNA VEZ POR SOBRE · el primer sorteo del sobre decide la Icon: positivo ⟺ hay Icon (en la destacada); negativo ⟺ ninguna", () => {
  for (const id of FIVE) {
    const bp = ICON_CHANCE_BP[id];
    let positives = 0;
    for (let i = 0; i < 20_000; i++) {
      const seed = seedOf(i);
      // El motor consume primero, y solo una vez, el sorteo de Icon: se reproduce con la misma semilla.
      const expected = rollBasisPoints(makeRng(seed), bp);
      const d = draw(id, seed);
      const icons = d.map((x, k) => (isIcon(x.card.id) ? k : -1)).filter((k) => k >= 0);
      if (expected) { positives++; assert.deepEqual(icons, [d.length - 1], `${id} seed ${seed}: una Icon, en la destacada`); }
      else assert.deepEqual(icons, [], `${id} seed ${seed}: sorteo negativo y salió una Icon`);
    }
    assert.ok(positives > 0, `${id}: hubo positivos`);
  }
});

test("SIN OTRA RUTA · con colección llena y cualquier política anti-duplicado, nunca más de una Icon ni Icon fuera de la destacada", () => {
  const all = new Set(CARDS.map((c) => c.id));
  for (const id of FIVE) {
    for (const policy of ["allow", "avoid", "replace", "upgrade", "compensate"] as const) {
      const p = { ...getPack(id)!, antiDuplicate: policy };
      for (let i = 0; i < 600; i++) {
        const d = openPack(REG, p, { seed: seedOf(i), owned: i % 2 ? all : new Set(), pity: freshPity() }).decisions;
        const at = d.map((x, k) => (isIcon(x.card.id) ? k : -1)).filter((k) => k >= 0);
        assert.ok(at.length === 0 || (at.length === 1 && at[0] === d.length - 1), `${id}/${policy}: ${at}`);
      }
    }
  }
});

/* ───────────────────────────── 4 · SOBRE ICON ───────────────────────────── */

test("SOBRES ICON · 1/1 (icon-single) y 3/3 (icon) cartas Icon, con o sin colección; las 3 Icon pueden salir; repetidas permitidas", () => {
  const engine = new PackEngine(REG);
  const owned = CARDS.map((c, i) => ({ uid: `o${i}`, cardId: c.id, variantId: c.variantId, obtainedAt: 0 }) as never);
  for (const [id, n] of [["icon-single", 1], ["icon", 3]] as const) {
    const seen = new Set<string>();
    let repeated = 0;
    for (let i = 0; i < 6000; i++) {
      const r = engine.draw(getPack(id)!, { seed: seedOf(i), owned: i % 3 ? [] : owned, mintCounts: {}, pity: freshPity(), now: 0 });
      assert.equal(r.instances.length, n, id);
      for (const ins of r.instances) { assert.ok(["record-breaker", "moments"].includes(ins.variantId), `${id}: ${ins.cardId}`); seen.add(ins.cardId); }
      if (new Set(r.instances.map((x) => x.cardId)).size < r.instances.length) repeated++;
    }
    assert.deepEqual([...seen].sort(), Object.keys(PER_CARD).sort(), `${id}: las 3 Icon pueden salir`);
    if (n === 3) assert.ok(repeated > 0, "el Premium admite repetidas (la misma Icon dos o tres veces)");
  }
});

test("PESOS EXACTOS · cada carta de un sobre ICON: PatMen 65 %, marteen 17,5 %, mada 17,5 % (cálculo exacto del motor, sin simular)", () => {
  for (const id of ICON_PACKS) {
    const pp = packClassPools(getPack(id)!);
    const w = pp.pools.icon.map((c) => pp.weightOf(c)), tw = w.reduce((a, b) => a + b, 0);
    pp.pools.icon.forEach((c, i) => assert.ok(Math.abs(w[i] / tw - PER_CARD[c.id]) < 1e-12, `${id}/${c.id}: ${w[i] / tw}`));
    // Y por hueco, con la misma función que la ficha (tierIdentity): cada hueco del sobre es esa misma distribución.
    for (const t of slotTables(MAIN_PACK_PLAN[id])) {
      const pr = slotCardProbabilities(t, pp.pools, MAIN_PACK_PLAN[id], pp.weightOf);
      for (const [cardId, p] of Object.entries(PER_CARD)) assert.ok(Math.abs(pr.get(cardId)!.p - p) < 1e-12, `${id}/${cardId}`);
    }
  }
  // Premium: P(≥ 1 Icon de 95) = 1 − 0,65³ = 0,725375 (exacto) — y la ficha lo dice.
  assert.ok(Math.abs(iconOddsFor({ id: "icon" })!.top!.atLeastOne - (1 - 0.65 ** 3)) < 1e-12);
  assert.equal(iconOddsFor({ id: "icon" })!.top!.ovr, 95);
  assert.equal(iconOddsFor({ id: "icon-single" })!.top, null);
});

test("PESOS · simulación del motor real, 100.000 cartas por sobre ICON: frecuencia de cada Icon compatible (±4 σ)", () => {
  for (const id of ICON_PACKS) {
    const n: Record<string, number> = {};
    let total = 0;
    for (let i = 0; total < 100_000; i++) for (const x of draw(id, seedOf(i))) { n[x.card.id] = (n[x.card.id] ?? 0) + 1; total++; }
    for (const [cardId, p] of Object.entries(PER_CARD)) assert.ok(Math.abs(n[cardId] / total - p) <= 4 * Math.sqrt(p * (1 - p) / total), `${id}/${cardId}: ${n[cardId] / total}`);
  }
});

test("RNG REAL DEL SERVIDOR · semillas de node:crypto (randomInt, como openPackForUser) → PackEngine: 65/17,5/17,5 por carta y 72,54 % (±5 σ)", () => {
  // Misma ruta que producción: `randomInt(0, 2 ** 31 - 1)` por apertura → motor (`PackEngine.draw` → `openPack`). No es
  // reproducible a propósito (es el azar real); la reproducible es la simulación de arriba y el cálculo exacto.
  const engine = new PackEngine(REG);
  for (const id of ICON_PACKS) {
    const N = 30_000, n: Record<string, number> = {};
    let cards = 0, top = 0;
    for (let i = 0; i < N; i++) {
      const r = engine.draw(getPack(id)!, { seed: randomInt(0, 2 ** 31 - 1), owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
      for (const x of r.instances) { n[x.cardId] = (n[x.cardId] ?? 0) + 1; cards++; }
      if (r.instances.some((x) => REG.card(x.cardId)!.ovr >= 95)) top++;
    }
    for (const [cardId, p] of Object.entries(PER_CARD)) assert.ok(Math.abs(n[cardId] / cards - p) <= 5 * Math.sqrt(p * (1 - p) / cards), `${id}/${cardId}: ${n[cardId] / cards}`);
    const pTop = id === "icon" ? 1 - 0.65 ** 3 : 0.35;
    assert.ok(Math.abs(top / N - pTop) <= 5 * Math.sqrt(pTop * (1 - pTop) / N), `${id}: ≥ 1 de 95 ${top / N} vs ${pTop}`);
  }
});

/* ───────────────────────────── 5 · LO DEMÁS NO CAMBIA ───────────────────────────── */

test("COMPATIBILIDAD · huecos normales = Pack Opening 3.0; la destacada sin Icon conserva EXACTAMENTE sus proporciones de 3.0", () => {
  const z = { base: 0, plata: 0, oro: 0, masters: 0, champions: 0, prime: 0, icon: 0 };
  // Tablas de Pack Opening 3.0 (2026-10-07), antes de la Icon por sobre.
  const v3: Record<string, { regular: ClassTable; featured: ClassTable }> = {
    estandar: { regular: { ...z, base: 720, plata: 250, oro: 30 }, featured: { ...z, base: 250, plata: 400, oro: 200, masters: 100, champions: 30, prime: 15, icon: 5 } },
    premium: { regular: { ...z, plata: 820, oro: 150, masters: 30 }, featured: { ...z, plata: 150, oro: 395, masters: 290, champions: 100, prime: 50, icon: 15 } },
    oro: { regular: { ...z, oro: 700, masters: 270, champions: 30 }, featured: { ...z, oro: 200, masters: 350, champions: 220, prime: 150, icon: 80 } },
    masters: { regular: { ...z, oro: 350, masters: 520, champions: 130 }, featured: { ...z, masters: 300, champions: 290, prime: 260, icon: 150 } },
    champions: { regular: { ...z, oro: 200, masters: 330, champions: 400, prime: 70 }, featured: { ...z, champions: 300, prime: 420, icon: 280 } },
  };
  for (const [id, old] of Object.entries(v3)) {
    const plan = MAIN_PACK_PLAN[id];
    assert.deepEqual(plan.regular, old.regular, `${id}: huecos normales intactos`);
    const eff = effectiveFeatured(plan), oldRest = 1000 - old.featured.icon;
    for (const k of PACK_CLASS_ORDER.filter((x) => x !== "icon")) {
      // P(clase | no Icon) idéntica a la de 3.0: el único ajuste es el reescalado a 1 − P(Icon).
      assert.ok(Math.abs(eff[k] / (1000 - eff.icon) - old.featured[k] / oldRest) < 1e-12, `${id}/${k}`);
    }
  }
  // Masters ya daba un 15 %: su destacada efectiva es EXACTAMENTE la de 3.0.
  for (const k of PACK_CLASS_ORDER) assert.ok(Math.abs(effectiveFeatured(MAIN_PACK_PLAN.masters)[k] - v3.masters.featured[k]) < 1e-9, k);
});

test("COMPATIBILIDAD · los especiales (regionales, equipos, EWC, China) no tienen Icon por sobre: su tabla, intacta", () => {
  for (const [id, plan] of Object.entries(SPECIAL_PACK_PLAN)) {
    assert.equal(plan.iconChanceBp, undefined, id);
    assert.equal(effectiveFeatured(plan), plan.featured, id);
    assert.equal(iconOddsFor({ id }), null, id);
  }
  assert.equal(SPECIAL_PACK_PLAN.ewc.featured.icon, 10, "EWC: su 1 % de Icon en la destacada de siempre");
});

/* ───────────────────────────── 6 · SIMULACIÓN 100.000 POR SOBRE ───────────────────────────── */

test("SIMULACIÓN · 100.000 aperturas deterministas por sobre con el motor real: P(≥ 1 Icon) observada compatible (±4 σ)", () => {
  const N = 100_000;
  for (const id of MAIN_PACK_LINE) {
    let hit = 0, cards = 0;
    for (let i = 0; i < N; i++) {
      const d = draw(id, seedOf(i));
      const n = d.filter((x) => isIcon(x.card.id)).length;
      assert.ok(n === guaranteedIcons(id) || (guaranteedIcons(id) === 0 && n <= 1), `${id}: ${n} Icon en un sobre`);
      if (n) hit++;
      cards += d.length;
    }
    const p = WANT[id], obs = hit / N, sigma = Math.sqrt((p * (1 - p)) / N);
    assert.ok(Math.abs(obs - p) <= 4 * sigma + 1e-12, `${id}: observado ${obs} esperado ${p} (σ ${sigma})`);
    assert.equal(cards, N * getPack(id)!.cardCount, `${id}: sobres completos`);
  }
});

/* ───────────────────────────── 7 · CALIDAD DEL SOBRE ICON ───────────────────────────── */

test("CALIDAD · clasificación determinista por valor real: 2 niveles (18.400: Patmen · 26.500: Marteen y Mada)", () => {
  const icons = CARDS.filter((c) => packCardClass(c) === "icon");
  const levels = iconValueLevels(icons, marketValue);
  assert.deepEqual(levels, [
    { value: 18400, cardIds: ["patmen__record-breaker"] },
    { value: 26500, cardIds: ["mada__moments", "marteen__record-breaker"] },
  ]);
  assert.deepEqual(iconValueLevels([...icons].reverse(), marketValue), levels, "no depende del orden de entrada");
});

test("CALIDAD · APROBADA la alternativa A (65/35 por nivel); la propuesta 65/25/9/1 no es aplicable al catálogo real", () => {
  assert.equal(ICON_QUALITY_STATUS.status, "APPROVED");
  assert.equal(activeIconQuality()?.id, "two-level-65-35");
  const levels = iconValueLevels(CARDS.filter((c) => packCardClass(c) === "icon"), marketValue);
  assert.equal(qualityTableApplies(ICON_QUALITY_PROPOSAL, levels), false, "4 niveles pedidos, 2 existentes");
  assert.throws(() => iconQualityWeights(ICON_QUALITY_PROPOSAL, levels));
  for (const alt of ICON_QUALITY_ALTERNATIVES) assert.equal(qualityTableApplies(alt, levels), true, alt.id);
  // Aprobada ⇒ la ficha SÍ afirma «las de menor valor son más probables» (es verdad) y explica la metodología.
  const one = iconOddsFor({ id: "icon-single" })!, three = iconOddsFor({ id: "icon" })!;
  assert.equal(one.text, `${ICON_COPY.guaranteed(1)} ${ICON_COPY.favorsLow}`);
  assert.equal(three.text, `${ICON_COPY.guaranteed(3)} ${ICON_COPY.independent} ${ICON_COPY.favorsLow}`);
  for (const o of [one, three]) {
    assert.equal(o.favorsLowValue, true);
    assert.deepEqual(o.quality!.levels.map((l) => [l.value, l.p, l.cards]), [[18400, 0.65, 1], [26500, 0.35, 2]]);
    assert.deepEqual(o.cards.map((c) => [c.cardId, Math.round(c.p * 1000) / 1000]), [["patmen__record-breaker", 0.65], ["mada__moments", 0.175], ["marteen__record-breaker", 0.175]]);
  }
  // Los otros sobres no usan la tabla de calidad (su Icon sigue con la inclinación de su plan).
  assert.equal(iconQualityWeightOf("champions", CARDS.filter((c) => packCardClass(c) === "icon"), () => 1)(CARDS.find((c) => c.id === "mada__moments")!), 1);
});

test("CALIDAD · con una tabla APROBADA (p. ej. la alternativa A), el motor elige nivel y luego carta justa, exacto en una tirada", () => {
  const icons = CARDS.filter((c) => packCardClass(c) === "icon");
  const A = ICON_QUALITY_ALTERNATIVES.find((t) => t.id === "two-level-65-35")!;
  const approved = { status: "APPROVED" as const, table: A };
  const w = iconQualityWeightOf("icon", icons, () => 1, approved);
  const total = icons.reduce((a, c) => a + w(c), 0);
  const p = Object.fromEntries(icons.map((c) => [c.id, w(c) / total]));
  assert.ok(Math.abs(p["patmen__record-breaker"] - 0.65) < 1e-12 && Math.abs(p["marteen__record-breaker"] - 0.175) < 1e-12 && Math.abs(p["mada__moments"] - 0.175) < 1e-12);
  // Solo los sobres ICON: otro sobre (o sin aprobar) conserva el peso de siempre.
  assert.equal(iconQualityWeightOf("champions", icons, () => 1, approved)(icons[0]), 1);
  assert.equal(iconQualityWeightOf("icon", icons, () => 1, { status: "PENDING_APPROVAL" })(icons[0]), 1);
  // Con la tirada real (pickWeighted, una sola) la frecuencia converge a la tabla.
  const rng = makeRng(2026);
  const n: Record<string, number> = {};
  for (let i = 0; i < 100_000; i++) { const c = pickWeighted(icons, w, rng); n[c.id] = (n[c.id] ?? 0) + 1; }
  assert.ok(Math.abs(n["patmen__record-breaker"] / 100_000 - 0.65) < 4 * Math.sqrt(0.65 * 0.35 / 100_000));
});

/* ───────────────────────────── 8 · WALKOUT 0.9 ───────────────────────────── */

const CAT = { cards: CARDS, getCard, getPlayer };
const ceremony = (cardIds: string[]) => {
  const plan = buildRevealPlan(toOpenedInstances(cardIds.map((id, i) => ({ uid: `u${i}`, card: getCard(id)! }))), null, CAT);
  const queue = packWalkoutQueue(plan.order);
  return { plan, queue, flow: walkoutFlow(cardIds.length, plan.hero.ok ? plan.hero.hero.uid : null, queue) };
};

test("WALKOUT 0.9 · Sobre ICON (motor): su única carta es la hero y se presenta como MEGA_WALKOUT, sin resto", () => {
  for (let i = 0; i < 300; i++) {
    const ids = draw("icon-single", seedOf(i)).map((x) => x.card.id);
    const { queue, flow } = ceremony(ids);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].intensity, "MEGA_WALKOUT");
    assert.deepEqual(flow, { walkouts: 1, heroWalked: true, rest: 0 });
  }
});

test("WALKOUT 0.9 · Sobre ICON Premium (motor): TRES MEGA_WALKOUT seguidos, la hero abre la cola, sin resto; repetidas, cada una la suya", () => {
  let sawRepeat = false;
  for (let i = 0; i < 300; i++) {
    const ids = draw("icon", seedOf(i)).map((x) => x.card.id);
    const { plan, queue, flow } = ceremony(ids);
    assert.equal(queue.length, 3);
    assert.ok(queue.every((q) => q.intensity === "MEGA_WALKOUT"));
    assert.equal(new Set(queue.map((q) => q.uid)).size, 3, "una escena por instancia, también con repetidas");
    assert.equal(queue[0].uid, plan.hero.ok ? plan.hero.hero.uid : "", "la hero abre la cola");
    assert.deepEqual(flow, { walkouts: 3, heroWalked: true, rest: 0 });
    if (new Set(ids).size < 3) sawRepeat = true;
  }
  assert.ok(sawRepeat, "hubo aperturas con Icon repetida");
});

test("WALKOUT 0.9 · una Icon de cualquier otro sobre (sorteo positivo) también es MEGA_WALKOUT; sin Icon, ninguna MEGA", () => {
  let checked = 0;
  for (let i = 0; i < 4000 && checked < 50; i++) {
    const ids = draw("champions", seedOf(i)).map((x) => x.card.id);
    const { queue } = ceremony(ids);
    const megas = queue.filter((q) => q.intensity === "MEGA_WALKOUT").map((q) => q.cardId);
    assert.deepEqual(megas, ids.filter(isIcon));
    if (megas.length) checked++;
  }
  assert.ok(checked >= 50, "hubo Champions con Icon");
});
