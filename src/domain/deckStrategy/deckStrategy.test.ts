/**
 * FASE 43 · CAPA ESTRATÉGICA — dominio puro: estadística, percentiles del catálogo, calibración, orientación, balance,
 * roles, aportación, cambios, comparador, sugerencias (con fuerza bruta) y resumen de partida.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import { checkDraft, indexPool, type BuilderCard } from "@/domain/deckBuilder/builder";
import { builderCardOf, catalogCards, strategyContext, syntheticCollection } from "@/lib/deckStrategy/catalog";
import { makeRng } from "@/sim/rng";
import {
  AXES, METRICS, analyzeDeck, balanceText, buildCatalogProfile, buildDeckCalibration, canonicalOrder, compareDecks, deltaAria,
  diffText, fitSentences, groupPool, informativeImpact, levelOf, orientationOf, paretoOptions, percentileRank, quantile, rolePlayers,
  sampleLegalDeck, signedText, suggestDeck, summarize, summarizeMatch, swapAlternatives, swapImpact, totalsOf, axisKey,
  type StrategyCard, type TurnFact, type ResultFact, type Axis,
} from "./index";

const ctx = strategyContext();
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Un equipo legal real: los dos jugadores de mayor OVR por rol (mejor definición). */
function topDeck(offset = 0): BuilderCard[] {
  let n = 1000 + offset * 20;
  const out: BuilderCard[] = [];
  // Rol de la CARTA (catálogo diseñado) y jugador único en todo el equipo.
  const usados = new Set<string>();
  for (const role of DUEL_ROLES) {
    const best = new Map<string, (typeof CARDS)[number]>();
    for (const c of CARDS) { const p = getPlayer(c.playerId); if (!p || (c.role ?? p.role) !== role || !c.combat || usados.has(c.playerId)) continue; const b = best.get(c.playerId); if (!b || c.ovr > b.ovr) best.set(c.playerId, c); }
    const list = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(offset, offset + 2);
    for (const d of list) { usados.add(d.playerId); out.push(builderCardOf(d.id, n++)); }
  }
  return out;
}
const players = rolePlayers(catalogCards(), ctx.catalog.dataVersion);
const randomDeck = (seed: number): StrategyCard[] => { const r = makeRng(seed); return sampleLegalDeck(players, r.next).map((c, i) => ({ ...c, uid: `u-${seed}-${i}`, nick: c.playerId })); };
const withCombat = (c: StrategyCard, combat: Partial<StrategyCard["combat"]>, ovr = c.ovr): StrategyCard => ({ ...c, ovr, combat: { ...c.combat, ...combat } });

/* ───────── estadística ───────── */

test("summarize: media, mediana (par e impar), extremos, desviación poblacional y rango exactos", () => {
  const s = summarize([4, 1, 3, 2]);
  assert.deepEqual([s.mean, s.median, s.min, s.max, s.range], [2.5, 2.5, 1, 4, 3]);
  assert.equal(s.sd, Math.sqrt(1.25));
  assert.equal(summarize([5, 1, 9]).median, 5);
  assert.deepEqual(summarize([]), { n: 0, mean: 0, median: 0, min: 0, max: 0, sd: 0, range: 0 });
});
test("quantile tipo 7: extremos e interpolación", () => {
  assert.equal(quantile([1, 2, 3, 4], 0), 1);
  assert.equal(quantile([1, 2, 3, 4], 1), 4);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10, 20], 0.25), 12.5);
});
test("percentileRank: punto medio, por encima/debajo de todo, empates y entrada no finita", () => {
  assert.equal(percentileRank([1, 2, 3, 4], 5), 100);
  assert.equal(percentileRank([1, 2, 3, 4], 0), 0);
  assert.equal(percentileRank([2, 2, 2, 2], 2), 50);
  assert.equal(percentileRank([1, 2, 3, 4], 2), 37.5);
  assert.equal(percentileRank([1, 2], Number.NaN), 50);
});
test("levelOf: terciles de la distribución (ALTO ≥ P66,7 · BAJO ≤ P33,3)", () => {
  assert.equal(levelOf(70), "ALTO"); assert.equal(levelOf(66.6), "MEDIO"); assert.equal(levelOf(33.3), "BAJO"); assert.equal(levelOf(50), "MEDIO");
});

/* ───────── catálogo y calibración ───────── */

test("perfil del catálogo: 772 definiciones reales y percentiles derivados de ellas", () => {
  assert.equal(ctx.catalog.size, catalogCards().length);
  const sorted = ctx.catalog.sorted[ctx.catalog.dataVersion];
  for (const m of METRICS) { assert.equal(sorted[m].length, catalogCards().length); assert.ok(sorted[m].every((v, i) => i === 0 || v >= sorted[m][i - 1])); }
});
test("percentil de carta = rango percentil frente al catálogo (recalculado a mano)", () => {
  const deck = topDeck();
  const a = analyzeDeck(deck, ctx);
  const c = a.contributions[0];
  const vals = catalogCards().map((x) => x.combat.entryfrag);
  const below = vals.filter((v) => v < c.values.entryfrag).length; const eq = vals.filter((v) => v === c.values.entryfrag).length;
  assert.equal(c.catalogPercentile.entryfrag, (100 * (below + eq / 2)) / vals.length);
});
test("percentiles derivados dinámicamente: otro catálogo ⇒ otro perfil", () => {
  const half = catalogCards().slice(0, 300);
  const p = buildCatalogProfile(half);
  assert.equal(p.size, 300);
  assert.notEqual(p.signature, ctx.catalog.signature);
});
test("calibración determinista (misma semilla ⇒ mismas cifras) y de 20.000 equipos", () => {
  const a = buildDeckCalibration(catalogCards(), 2000, 5); const b = buildDeckCalibration(catalogCards(), 2000, 5);
  assert.deepEqual(a.mean, b.mean); assert.deepEqual(a.sorted.entryfrag.slice(0, 20), b.sorted.entryfrag.slice(0, 20));
  assert.equal(ctx.calibration.sample, 20_000);
});
test("equipos sintéticos de la calibración: legales por el validador canónico", () => {
  for (let s = 1; s <= 40; s++) {
    const deck = randomDeck(s).map((c, i) => builderCardOf(c.cardId, 90_000 + s * 20 + i));
    assert.ok(checkDraft(deck.map((c) => c.uid), indexPool(deck)).ready, `semilla ${s}`);
  }
});
test("calibración: medias y desviaciones finitas y positivas", () => {
  for (const m of METRICS) { assert.ok(Number.isFinite(ctx.calibration.mean[m]) && ctx.calibration.sd[m] > 0); }
  assert.equal(ctx.calibration.ovrDispersion.length, 20_000);
});

/* ───────── análisis ───────── */

test("análisis: medias exactas de OVR y del trío", () => {
  const deck = topDeck();
  const a = analyzeDeck(deck, ctx);
  assert.equal(a.metrics.ovr.mean, deck.reduce((s, c) => s + c.ovr, 0) / 10);
  for (const ax of AXES) assert.equal(a.metrics[ax].mean, deck.reduce((s, c) => s + c.combat[ax], 0) / 10);
});
test("análisis: mediana, mínimo, máximo y dispersión exactos", () => {
  const deck = topDeck(3);
  const a = analyzeDeck(deck, ctx);
  const s = summarize(deck.map((c) => c.combat.gamesense));
  assert.deepEqual([a.metrics.gamesense.median, a.metrics.gamesense.min, a.metrics.gamesense.max, a.metrics.gamesense.sd], [s.median, s.min, s.max, s.sd]);
});
test("análisis: distribución de roles 2/2/2/2/2", () => {
  assert.deepEqual(Object.values(analyzeDeck(topDeck(), ctx).roleDistribution), [2, 2, 2, 2, 2]);
});
test("análisis: percentil frente a equipos simulados = rango percentil frente a la calibración", () => {
  const a = analyzeDeck(topDeck(), ctx);
  assert.equal(a.deckPercentile!.stronghold, percentileRank(ctx.calibration.sorted.stronghold, a.metrics.stronghold.mean));
});
test("análisis: percentil mostrado y nivel = media frente a las CARTAS del catálogo", () => {
  const a = analyzeDeck(topDeck(3), ctx);
  const sorted = ctx.catalog.sorted[ctx.catalog.dataVersion];
  assert.equal(a.catalogPercentile!.gamesense, percentileRank(sorted.gamesense, a.metrics.gamesense.mean));
  assert.equal(a.level!.gamesense, levelOf(a.catalogPercentile!.gamesense));
});
test("QA real · percentiles discriminan: equipos legales aleatorios reparten niveles frente al catálogo", () => {
  const levels = new Set<string>();
  for (let s = 1; s <= 200; s++) { const a = analyzeDeck(randomDeck(s), ctx); for (const m of METRICS) levels.add(a.level![m]); }
  assert.deepEqual([...levels].sort(), ["ALTO", "BAJO", "MEDIO"]);
});
test("análisis incompleto (8/10): medias parciales, sin orientación ni percentil de equipo", () => {
  const a = analyzeDeck(topDeck().slice(0, 8), ctx);
  assert.equal(a.count, 8); assert.equal(a.complete, false);
  assert.equal(a.orientation, null); assert.equal(a.deckPercentile, null); assert.equal(a.catalogPercentile, null);
  assert.deepEqual([a.strengths, a.weaknesses], [[], []]);
});
test("análisis vacío: sin NaN", () => {
  const a = analyzeDeck([], ctx);
  assert.equal(a.count, 0);
  assert.ok(!JSON.stringify(a).includes("NaN") && !JSON.stringify(a).includes("Infinity"));
});
test("orden de las cartas irrelevante", () => {
  const deck = topDeck(1);
  const shuffled = [...deck].reverse();
  assert.deepEqual(analyzeDeck(shuffled, ctx), analyzeDeck(deck, ctx));
});
test("serial irrelevante (mismo cardId #1 y sin serial ⇒ mismo análisis)", () => {
  const deck = topDeck(2);
  const a = analyzeDeck(deck.map((c) => ({ ...c, serial: 1 })) as BuilderCard[], ctx);
  const b = analyzeDeck(deck.map((c) => ({ ...c, serial: null })) as BuilderCard[], ctx);
  assert.deepEqual(a, b);
});
for (const [label, patch] of [
  ["rareza/variante", { variantId: "icon-series" }], ["equipo", { team: "Equipo Inventado" }], ["región", { region: "China" }], ["edición/statBoost", { statBoost: 12 }], ["país", { country: "XX" }],
] as const) {
  test(`${label}: metadatos que no dan poder (análisis idéntico)`, () => {
    const deck = topDeck(4);
    assert.deepEqual(analyzeDeck(deck.map((c) => ({ ...c, ...patch })) as BuilderCard[], ctx), analyzeDeck(deck, ctx));
  });
}
test("el análisis solo lee OVR, trío, rol y jugador (sin serial, rareza, equipo, región, favoritos ni mercado)", () => {
  for (const f of ["analysis.ts", "catalog.ts", "swap.ts", "suggestion.ts", "comparison.ts", "match.ts"]) {
    const src = code(read(`src/domain/deckStrategy/${f}`));
    assert.ok(!/\.serial\b|rarity|\.team\b|\.region\b|favorite|market|price|Math\.random|Date\.now|fetch\(|supabase/i.test(src), f);
  }
});

/* ───────── orientación y balance ───────── */

test("orientación: eje que destaca ≥ 1σ ⇒ ORIENTADO", () => {
  const o = orientationOf({ stronghold: 1.6, gamesense: 0.2, entryfrag: 0.1 });
  assert.deepEqual([o.kind, o.axes, o.weakest, o.label], ["ORIENTED", ["stronghold"], "entryfrag", "Orientado a Stronghold"]);
});
for (const ax of AXES) {
  test(`orientación hacia ${ax} desde un equipo real forzado`, () => {
    const deck = topDeck().map((c) => withCombat(c, { [ax]: 99 }));
    const a = analyzeDeck(deck, ctx);
    assert.equal(a.orientation!.kind, "ORIENTED"); assert.deepEqual(a.orientation!.axes, [ax]);
  });
}
test("orientación: ejes a < 0,5σ ⇒ EQUILIBRADO", () => {
  assert.equal(orientationOf({ stronghold: 0.3, gamesense: 0.1, entryfrag: -0.1 }).kind, "BALANCED");
});
test("orientación: ni 1σ de ventaja ni < 0,5σ ⇒ MIXTO con los dos ejes altos", () => {
  const o = orientationOf({ stronghold: 1.0, gamesense: 0.4, entryfrag: -0.5 });
  assert.deepEqual([o.kind, o.axes, o.weakest], ["MIXED", ["stronghold", "gamesense"], "entryfrag"]);
});
test("orientación: umbrales exactos (1σ incluido, 0,5σ excluido)", () => {
  assert.equal(orientationOf({ stronghold: 1, gamesense: 0, entryfrag: 0 }).kind, "ORIENTED");
  assert.equal(orientationOf({ stronghold: 0.5, gamesense: 0.25, entryfrag: 0 }).kind, "MIXED");
});
test("orientación determinista con empates (orden canónico SH, GS, EF)", () => {
  assert.deepEqual(orientationOf({ stronghold: 0, gamesense: 2, entryfrag: 2 }).axes, ["gamesense", "entryfrag"]);
});
test("balanceText: frases sin porcentajes de «sinergia»", () => {
  const t = [balanceText(orientationOf({ stronghold: 2, gamesense: 0, entryfrag: -1 })), balanceText(orientationOf({ stronghold: 0, gamesense: 0, entryfrag: 0 })), balanceText(orientationOf({ stronghold: 1, gamesense: 0.6, entryfrag: -1 }))];
  assert.equal(t[0], "Stronghold destaca; Entryfrag es el eje más débil.");
  assert.match(t[1], /^Perfil equilibrado/);
  assert.ok(t.every((x) => !/%|sinergia|synergy|química/i.test(x)));
});
test("forma: POLARIZADO con mucha dispersión de OVR, CONSISTENTE con ninguna", () => {
  const deck = topDeck();
  const flat = analyzeDeck(deck.map((c) => ({ ...c, ovr: 80 })), ctx);
  assert.equal(flat.shape, "CONSISTENT");
  const polar = analyzeDeck(deck.map((c, i) => ({ ...c, ovr: i % 2 ? 93 : 58 })), ctx);
  assert.equal(polar.shape, "POLARIZED");
  assert.ok(polar.weaknesses.some((w) => w.id === "polarized") || polar.weaknesses.length === 3);
});

/* ───────── fortalezas, debilidades, atípicos ───────── */

test("fortalezas y debilidades: máximo 3 cada una y solo con equipo completo", () => {
  for (let s = 1; s <= 300; s++) { const a = analyzeDeck(randomDeck(s), ctx); assert.ok(a.strengths.length <= 3 && a.weaknesses.length <= 3); }
});
test("«X es tu eje más bajo» solo si es de verdad el z más bajo", () => {
  for (let s = 1; s <= 300; s++) {
    const a = analyzeDeck(randomDeck(s), ctx);
    const w = a.weaknesses.find((x) => x.id.startsWith("weakest-"));
    if (w) { const ax = w.metric as Axis; assert.ok(AXES.every((o) => a.z![ax] <= a.z![o])); }
  }
});
test("«alto» solo con percentil ≥ P66,7 y «bajo» solo con ≤ P33,3", () => {
  for (let s = 1; s <= 300; s++) {
    const a = analyzeDeck(randomDeck(s), ctx);
    for (const i of a.strengths.filter((x) => x.id.startsWith("high-"))) assert.ok(a.catalogPercentile![i.metric!] >= 200 / 3);
    for (const i of a.weaknesses.filter((x) => x.id.startsWith("low-"))) assert.ok(a.catalogPercentile![i.metric!] <= 100 / 3);
  }
});
test("«los dos X por debajo de la media en Y» solo si ambos lo están", () => {
  for (let s = 1; s <= 400; s++) {
    const d = randomDeck(s); const a = analyzeDeck(d, ctx);
    const w = a.weaknesses.find((x) => x.id.startsWith("role-"));
    if (w) for (const u of w.uids!) assert.ok(d.find((c) => c.uid === u)!.combat[w.metric as Axis] < a.metrics[w.metric!].mean);
  }
});
test("valores atípicos por vallas de Tukey (carta muy débil)", () => {
  const deck = topDeck().map((c, i) => (i === 3 ? { ...c, ovr: 40 } : c));
  const a = analyzeDeck(deck, ctx);
  assert.ok(a.outliers.some((o) => o.uid === deck[3].uid && o.metric === "ovr" && o.direction === "LOW"));
});
test("carta excepcional: valor atípico ALTO", () => {
  const deck = topDeck(6).map((c, i) => (i === 0 ? withCombat(c, { entryfrag: 99 }) : withCombat(c, { entryfrag: 60 })));
  assert.ok(analyzeDeck(deck, ctx).outliers.some((o) => o.metric === "entryfrag" && o.direction === "HIGH"));
});
test("sin frases de ganador ni de poder oculto en fortalezas/debilidades", () => {
  for (let s = 1; s <= 200; s++) {
    const a = analyzeDeck(randomDeck(s), ctx);
    for (const t of [...a.strengths, ...a.weaknesses].map((x) => x.text)) assert.ok(!/mejor equipo|ganar[aá]s|victoria|bonus|sinergia|química|\d+\/100/i.test(t), t);
  }
});

/* ───────── roles y aportación ───────── */

for (const role of DUEL_ROLES) {
  test(`rol ${role}: media, eje principal, diferencia y comparación con el equipo`, () => {
    const deck = topDeck(2);
    const a = analyzeDeck(deck, ctx);
    const r = a.roles.find((x) => x.role === role)!;
    const two = deck.filter((c) => c.role === role);
    assert.equal(r.count, 2);
    assert.equal(r.mean.ovr, (two[0].ovr + two[1].ovr) / 2);
    assert.equal(r.ovrGap, Math.abs(two[0].ovr - two[1].ovr));
    assert.equal(r.vsDeck.gamesense, r.mean.gamesense! - a.metrics.gamesense.mean);
    const expected = [...AXES].sort((x, y) => (r.mean[y]! - r.mean[x]!) || AXES.indexOf(x) - AXES.indexOf(y))[0];
    assert.equal(r.mainAxis, expected);
  });
}
test("aportación: valores, frente a la media, frente al compañero de rol", () => {
  const deck = topDeck(5);
  const a = analyzeDeck(deck, ctx);
  for (const c of a.contributions) {
    const card = deck.find((x) => x.uid === c.uid)!;
    const partner = deck.find((x) => x.role === card.role && x.uid !== card.uid)!;
    assert.equal(c.values.ovr, card.ovr);
    assert.equal(c.vsDeck.stronghold, card.combat.stronghold - a.metrics.stronghold.mean);
    assert.equal(c.vsPartner!.entryfrag, card.combat.entryfrag - partner.combat.entryfrag);
    assert.equal(c.partnerUid, partner.uid);
  }
});
test("«Mayor X del equipo» solo para el máximo estricto", () => {
  const deck = topDeck(7);
  const a = analyzeDeck(deck, ctx);
  for (const c of a.contributions) for (const f of c.facts.filter((x) => x.startsWith("Mayor Entryfrag"))) {
    assert.ok(f && deck.every((o) => o.uid === c.uid || o.combat.entryfrag < c.values.entryfrag));
  }
  assert.ok(!a.contributions.some((c) => c.facts.some((f) => /MVP/i.test(f))));
});

/* ───────── cambios ───────── */

const lab = () => {
  const coll = syntheticCollection(400, 21, 400);
  const pool = indexPool(coll);
  const s = suggestDeck(pool, "gamesense", ctx);
  return { pool, uids: s.uids };
};

test("alternativas: todas legales por el validador canónico, del mismo rol, poseídas y sin la propia definición", () => {
  const { pool, uids } = lab();
  for (const slot of uids.slice(0, 4)) {
    const cur = pool.get(slot)!;
    for (const alt of swapAlternatives(uids, slot, pool, ctx)) {
      assert.ok(pool.has(alt.card.uid));
      assert.equal(alt.card.role, cur.role);
      assert.notEqual(alt.card.cardId, cur.cardId);
      assert.ok(checkDraft(alt.nextUids, pool).ready);
      assert.equal(alt.nextUids.length, 10);
    }
  }
});
test("alternativas: una opción por definición aunque haya varias copias", () => {
  const base = syntheticCollection(200, 5, 200);
  const extra = base.slice(0, 40).map((c, i) => builderCardOf(c.cardId, 700_000 + i, 7));
  const pool = indexPool([...base, ...extra]);
  const s = suggestDeck(pool, "BALANCED", ctx);
  for (const slot of s.uids) {
    const alts = swapAlternatives(s.uids, slot, pool, ctx);
    assert.equal(new Set(alts.map((a) => a.card.cardId)).size, alts.length);
  }
});
test("alternativas: excluyen jugadores ya presentes (jugador único)", () => {
  const { pool, uids } = lab();
  const inDeck = new Set(uids.map((u) => pool.get(u)!.playerId));
  const slot = uids[2];
  for (const a of swapAlternatives(uids, slot, pool, ctx)) assert.ok(!inDeck.has(a.card.playerId) || a.card.playerId === pool.get(slot)!.playerId);
});
test("alternativas: una carta que no está en la colección nunca es accionable", () => {
  const { pool, uids } = lab();
  const owned = new Set(pool.keys());
  for (const a of swapAlternatives(uids, uids[0], pool, ctx)) for (const u of a.nextUids) assert.ok(owned.has(u));
});
test("delta exacto: (carta nueva − sustituida) / 10 en cada métrica", () => {
  const { pool, uids } = lab();
  const cur = pool.get(uids[1])!;
  for (const a of swapAlternatives(uids, uids[1], pool, ctx).slice(0, 10)) {
    for (const m of METRICS) {
      const v = (x: StrategyCard) => (m === "ovr" ? x.ovr : x.combat[m]);
      assert.ok(Math.abs(a.impact.delta[m] - (v(a.card) - v(cur)) / 10) < 1e-9, m);
      assert.equal(a.impact.cardDelta[m], v(a.card) - v(cur));
    }
  }
});
test("impacto en identidad y balance: antes/después coherentes con el análisis", () => {
  const { pool, uids } = lab();
  const a = swapAlternatives(uids, uids[3], pool, ctx)[0];
  const after = analyzeDeck(a.nextUids.map((u) => pool.get(u)!), ctx);
  assert.equal(a.impact.orientationAfter!.label, after.orientation!.label);
  assert.equal(a.impact.spreadAfter, after.orientation!.spreadSd);
  assert.equal(a.impact.identityChanged, a.impact.orientationBefore!.label !== a.impact.orientationAfter!.label);
});
test("orden explícito por eje elegido (no «la mejor»)", () => {
  const { pool, uids } = lab();
  const alts = swapAlternatives(uids, uids[4], pool, ctx, { sort: "entryfrag" });
  for (let i = 1; i < alts.length; i++) assert.ok(alts[i - 1].impact.delta.entryfrag >= alts[i].impact.delta.entryfrag);
});
test("sin cambios: misma estadística ⇒ «Mismos valores» y noChange", () => {
  const deck = topDeck();
  const clone = { ...deck[0], uid: "clone", cardId: "otra-def" };
  const imp = swapImpact(deck, deck[0].uid, clone, ctx);
  assert.equal(imp.noChange, true);
  assert.equal(imp.fit[0], "Mismos valores en los tres ejes.");
  assert.ok(METRICS.every((m) => imp.delta[m] === 0));
});
test("frases de encaje: sube/reduce y eje más débil, factuales", () => {
  const deck = topDeck();
  const a0 = analyzeDeck(deck, ctx);
  const cur = deck[0];
  const cand = withCombat(cur, { gamesense: cur.combat.gamesense + 3, entryfrag: cur.combat.entryfrag - 2 });
  const f = fitSentences(cur, cand, a0);
  assert.equal(f[0], "Sube Gamesense, pero reduce Entryfrag.");
  if (a0.orientation?.weakest === "gamesense") assert.ok(f.includes("Mejora el eje más débil del equipo (Gamesense)."));
});
test("signedText y deltaAria: signo en texto (+3, −2, =)", () => {
  assert.deepEqual([signedText(3), signedText(-2), signedText(0), signedText(0.04), signedText(0.35)], ["+3", "−2", "=", "=", "+0,4"]);
  assert.equal(deltaAria("gamesense", 0.3), "Gamesense sube 0,3");
  assert.equal(deltaAria("entryfrag", 0), "Entryfrag sin cambios");
});
test("comparación informativa con una carta NO poseída: deltas sí, acción nunca", () => {
  const deck = topDeck();
  const def = catalogCards().find((c) => c.role === deck[0].role && !deck.some((d) => d.playerId === c.playerId))!;
  const imp = informativeImpact(deck, deck[0].uid, { ...def, uid: "x", nick: "x" }, ctx);
  assert.equal(imp.actionable, false);
  assert.ok(!("nextUids" in imp));
});

/* ───────── comparador ───────── */

test("comparador: diferencias exactas y frases sin ganador", () => {
  const A = topDeck(0); const B = topDeck(8);
  const c = compareDecks("A", A, "B", B, ctx);
  for (const r of c.rows) assert.equal(r.diff, r.a - r.b);
  assert.ok(c.summary.every((t) => !/mejor|gana|superior|peor/i.test(t)));
  assert.equal(diffText("A", "B", "entryfrag", 4), "A tiene +4 de Entryfrag medio.");
  assert.equal(diffText("A", "B", "gamesense", -3), "B tiene +3 de Gamesense medio.");
  assert.equal(diffText("A", "B", "ovr", 0), "Mismo OVR medio.");
});
test("comparador: desglose por rol y orientación de cada equipo", () => {
  const c = compareDecks("A", topDeck(0), "B", topDeck(8), ctx);
  assert.equal(c.roles.length, 5);
  assert.ok(c.orientation.a && c.orientation.b);
  assert.ok(!("winner" in c));
});

/* ───────── sugerencias ───────── */

function bruteAxis(pool: ReturnType<typeof indexPool>, axis: Axis): number[] {
  const g = [...groupPool(pool).values()][0];
  let best: number[] | null = null;
  const rec = (ri: number, acc: StrategyCard[]) => {
    if (ri === DUEL_ROLES.length) {
      const t = totalsOf(acc); const v = [t[axis], t.ovr, AXES.filter((a) => a !== axis).reduce((s, a) => s + t[a], 0)];
      if (!best || v.some((x, i) => x !== best![i]) && v.findIndex((x, i) => x !== best![i]) >= 0 && v[v.findIndex((x, i) => x !== best![i])] > best[v.findIndex((x, i) => x !== best![i])]) best = v;
      return;
    }
    const ps = g[DUEL_ROLES[ri]];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) for (const a of ps[i]) for (const b of ps[j]) rec(ri + 1, [...acc, a, b]);
  };
  rec(0, []);
  return best!;
}
for (const axis of AXES) {
  test(`sugerencia ${axis}: óptimo EXACTO frente a fuerza bruta (colecciones pequeñas)`, () => {
    for (const seed of [3, 9, 27]) {
      const pool = indexPool(syntheticCollection(34, seed, 34).concat(topDeck(seed % 5)));
      const s = suggestDeck(pool, axis, ctx);
      if (!s.ok) continue;
      const t = s.totals!;
      assert.deepEqual([t[axis], t.ovr, AXES.filter((a) => a !== axis).reduce((x, a) => x + t[a], 0)], bruteAxis(pool, axis));
    }
  });
}
test("sugerencias: legales, poseídas, deterministas, una por objetivo", () => {
  const pool = indexPool(syntheticCollection(600, 8, 500));
  for (const o of ["BALANCED", ...AXES] as const) {
    const a = suggestDeck(pool, o, ctx); const b = suggestDeck(pool, o, ctx);
    assert.ok(a.ok && checkDraft(a.uids, pool).ready);
    assert.deepEqual(a.uids, b.uids);
    assert.ok(a.uids.every((u) => pool.has(u)));
  }
});
test("sugerencia EQUILIBRADA: cumple el suelo de OVR (media ≥ máx − 1σ) y no es más dispersa que el equipo de máxima OVR", () => {
  for (const seed of [1, 2, 3, 4]) {
    const pool = indexPool(syntheticCollection(500, seed, 450));
    const s = suggestDeck(pool, "BALANCED", ctx);
    const g = [...groupPool(pool).values()][0];
    const maxOvr = DUEL_ROLES.flatMap((r) => g[r].map((defs) => defs.reduce((x, y) => (y.ovr > x.ovr ? y : x))).sort((a, b) => b.ovr - a.ovr).slice(0, 2));
    const floor = totalsOf(maxOvr).ovr / 10 - ctx.calibration.sd.ovr;
    assert.ok(s.totals!.ovr / 10 >= floor - 1e-9);
    assert.ok(analyzeDeck(s.cards, ctx).orientation!.spreadSd <= analyzeDeck(maxOvr, ctx).orientation!.spreadSd + 1e-9);
  }
});
test("sugerencias: serial, rareza, equipo, región y edición no cambian el resultado", () => {
  const coll = syntheticCollection(300, 12, 300);
  const pool = indexPool(coll);
  const noisy = indexPool(coll.map((c, i) => ({ ...c, serial: i % 3 ? 1 : null, team: `T${i % 7}`, region: "China" as BuilderCard["region"], variantId: "icon-series" as BuilderCard["variantId"], statBoost: 12, country: "ZZ" })));
  for (const o of ["BALANCED", ...AXES] as const) assert.deepEqual(suggestDeck(noisy, o, ctx).uids, suggestDeck(pool, o, ctx).uids);
});
test("sugerencia sin cartas suficientes: no inventa, dice por qué", () => {
  const s = suggestDeck(indexPool(topDeck().slice(0, 7)), "gamesense", ctx);
  assert.equal(s.ok, false); assert.match(s.reason!, /suficientes/);
});
test("sugerencia: el eje pedido es el máximo posible (≥ al de cualquier otra sugerencia)", () => {
  const pool = indexPool(syntheticCollection(500, 33, 500));
  const all = (["BALANCED", ...AXES] as const).map((o) => suggestDeck(pool, o, ctx));
  for (const ax of AXES) { const mine = all.find((s) => s.objective === ax)!.totals![ax]; for (const s of all) assert.ok(mine >= s.totals![ax]); }
});
test("opciones Pareto: no dominadas entre sí, etiquetadas por lo que maximizan, sin «mejor»", () => {
  const pool = indexPool(syntheticCollection(500, 44, 500));
  const opts = paretoOptions(pool, ctx);
  assert.ok(opts.length >= 2);
  for (const a of opts) for (const b of opts) if (a !== b) {
    const dom = a.totals.ovr >= b.totals.ovr && a.totals.stronghold >= b.totals.stronghold && a.totals.gamesense >= b.totals.gamesense && a.totals.entryfrag >= b.totals.entryfrag;
    assert.ok(!dom || JSON.stringify(a.totals) === JSON.stringify(b.totals));
  }
  assert.ok(opts.every((o) => o.labels.every((l) => /^Más /.test(l) && !/mejor/i.test(l))));
});
test("axisKey: clave lexicográfica (eje, OVR, otros)", () => {
  const c = topDeck()[0];
  assert.deepEqual(axisKey("gamesense")(c), [c.combat.gamesense, c.ovr, c.combat.stronghold + c.combat.entryfrag]);
});
test("groupPool: una definición por copia (uid menor) y jugadores por rol", () => {
  const base = topDeck();
  const pool = indexPool([...base, builderCardOf(base[0].cardId, 1, 5)]);
  const g = [...groupPool(pool).values()][0];
  const defs = g[base[0].role].flat().filter((d) => d.cardId === base[0].cardId);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].uid, [base[0].uid, builderCardOf(base[0].cardId, 1).uid].sort()[0]);
});

/* ───────── partida ───────── */

const R = (o: Partial<ResultFact> = {}): ResultFact => ({ winner: "YOU", isDraw: false, scoreYou: 0, scoreRival: 0, tiedEncounters: 0, decidedBy: "SCORE", sumOvrYou: 800, sumOvrRival: 790, statTotalYou: 700, statTotalRival: 690, ...o });
function turns(spec: [Axis, "A" | "B" | "TIE"][]): TurnFact[] {
  let y = 0; let r = 0;
  return spec.map(([stat, outcome], i) => {
    if (outcome === "A") y++; else if (outcome === "B") r++;
    const rivalStat: Axis = stat === "gamesense" ? "gamesense" : stat === "stronghold" ? "entryfrag" : "stronghold";
    return { number: i + 1, attacker: i % 2 ? "B" : "A", outcome, scoreAfterYou: y, scoreAfterRival: r, you: { uid: `y${i}`, nick: `Y${i}`, stat, value: 70 }, rival: { uid: `r${i}`, nick: `R${i}`, stat: rivalStat, value: 70 } };
  });
}
const T10: [Axis, "A" | "B" | "TIE"][] = [["stronghold", "A"], ["stronghold", "B"], ["stronghold", "TIE"], ["gamesense", "B"], ["gamesense", "B"], ["gamesense", "A"], ["gamesense", "B"], ["entryfrag", "A"], ["entryfrag", "A"], ["entryfrag", "A"]];

test("partida: victorias/derrotas/empates por eje exactos y suman las comparaciones", () => {
  const s = summarizeMatch(turns(T10), R({ scoreYou: 5, scoreRival: 4, tiedEncounters: 1 }));
  const by = Object.fromEntries(s.axes.map((a) => [a.axis, a]));
  assert.deepEqual([by.stronghold.wins, by.stronghold.losses, by.stronghold.ties], [1, 1, 1]);
  assert.deepEqual([by.gamesense.wins, by.gamesense.losses, by.gamesense.timesCompared, by.gamesense.pointDelta], [1, 3, 4, -2]);
  assert.deepEqual([by.entryfrag.wins, by.entryfrag.losses], [3, 0]);
  for (const a of s.axes) assert.equal(a.wins + a.losses + a.ties, a.timesCompared);
  assert.ok(s.consistent);
});
test("partida: rendimiento por carta (1 turno por carta, estadística usada)", () => {
  const s = summarizeMatch(turns(T10), R({ scoreYou: 5, scoreRival: 4, tiedEncounters: 1 }));
  assert.equal(s.cards.length, 10);
  assert.deepEqual(s.cards[3], { uid: "y3", nick: "Y3", turns: 1, wins: 0, losses: 1, ties: 0, stats: ["gamesense"], values: [70] });
});
test("partida: insights factuales («Perdiste 3 de 4 comparaciones de Gamesense»), ≤ 3, sin causas", () => {
  const s = summarizeMatch(turns(T10), R({ scoreYou: 5, scoreRival: 4, tiedEncounters: 1 }));
  assert.ok(s.insights.includes("Perdiste 3 de 4 comparaciones de Gamesense."));
  assert.ok(s.insights.includes("Ganaste 3 de 3 comparaciones de Entryfrag."));
  assert.ok(s.insights.length <= 3);
  assert.ok(s.insights.every((t) => !/porque|por culpa|debido a|por eso/i.test(t)));
  assert.equal(s.contextAxis, "gamesense");
});
test("partida: turno empatado = 0 puntos (explicado)", () => {
  const s = summarizeMatch(turns(T10), R({ scoreYou: 5, scoreRival: 4, tiedEncounters: 1 }));
  assert.match(s.resolution!.lines[0], /empate de turno no da punto/);
});
test("partida: desempate por suma de OVR da +1 al ganador y cuadra con el marcador", () => {
  const spec: [Axis, "A" | "B" | "TIE"][] = [["stronghold", "A"], ["stronghold", "B"], ["gamesense", "A"], ["gamesense", "B"], ["entryfrag", "A"], ["entryfrag", "B"], ["gamesense", "A"], ["gamesense", "B"], ["stronghold", "A"], ["entryfrag", "B"]];
  const s = summarizeMatch(turns(spec), R({ decidedBy: "OVR_TIEBREAK", scoreYou: 6, scoreRival: 5, sumOvrYou: 812, sumOvrRival: 805 }));
  assert.ok(s.consistent);
  assert.equal(s.resolution!.tiebreakPointYou, 1);
  assert.match(s.resolution!.lines[1], /812 contra 805\. Da 1 punto a tu equipo: final 6–5/);
});
test("partida: desempate por estadística total NO suma punto", () => {
  const spec: [Axis, "A" | "B" | "TIE"][] = [["stronghold", "A"], ["stronghold", "B"], ["gamesense", "A"], ["gamesense", "B"], ["entryfrag", "A"], ["entryfrag", "B"], ["gamesense", "TIE"], ["gamesense", "TIE"], ["stronghold", "A"], ["entryfrag", "B"]];
  const s = summarizeMatch(turns(spec), R({ decidedBy: "STAT_MARGIN", winner: "RIVAL", scoreYou: 4, scoreRival: 4, tiedEncounters: 2, sumOvrYou: 800, sumOvrRival: 800, statTotalYou: 690, statTotalRival: 701 }));
  assert.ok(s.consistent);
  assert.deepEqual([s.resolution!.tiebreakPointYou, s.resolution!.tiebreakPointRival], [0, 0]);
  assert.match(s.resolution!.lines[1], /690 contra 701\. Este desempate no suma punto/);
});
test("partida: empate total explicado con las tres igualdades", () => {
  const spec: [Axis, "A" | "B" | "TIE"][] = Array.from({ length: 10 }, (_, i) => [AXES[i % 3], i < 4 ? "A" : i < 8 ? "B" : "TIE"]);
  const s = summarizeMatch(turns(spec), R({ decidedBy: "NONE", winner: null, isDraw: true, scoreYou: 4, scoreRival: 4, tiedEncounters: 2, sumOvrYou: 800, sumOvrRival: 800, statTotalYou: 700, statTotalRival: 700 }));
  assert.ok(s.consistent);
  assert.match(s.resolution!.lines[0], /^Empate: turnos 4–4, suma de OVR 800–800 y estadística total 700–700/);
});
test("partida: marcador incoherente con los turnos ⇒ consistent=false (no se afirma)", () => {
  assert.equal(summarizeMatch(turns(T10), R({ scoreYou: 9, scoreRival: 0 })).consistent, false);
});
test("partida parcial (<10 turnos): complete=false", () => {
  const s = summarizeMatch(turns(T10.slice(0, 6)), null);
  assert.deepEqual([s.turns, s.complete, s.resolution], [6, false, null]);
});
test("partida: el resumen no depende del orden en que llegan los turnos", () => {
  const t = turns(T10);
  assert.deepEqual(summarizeMatch([...t].reverse(), R({ scoreYou: 5, scoreRival: 4, tiedEncounters: 1 })), summarizeMatch(t, R({ scoreYou: 5, scoreRival: 4, tiedEncounters: 1 })));
});
test("partida: no ejecuta el motor (match.ts no importa resolver ni orquestador)", () => {
  const src = code(read("src/domain/deckStrategy/match.ts"));
  assert.ok(!/resolveCombat|resolveEncounter|confirmTurn|startDuelMatch|cardgame\/combat|cardgame\/match/.test(src));
});

test("canonicalOrder: estable por rol, definición y uid", () => {
  const deck = topDeck();
  assert.deepEqual(canonicalOrder([...deck].reverse()).map((c) => c.uid), canonicalOrder(deck).map((c) => c.uid));
});
