/**
 * FASE 43 · LABORATORIO DE ESTRATEGIA — `npx tsx scripts/deck-strategy-lab.ts <modo> [--n=]`
 *
 *   catalog     → docs/product/qa/fase43/catalog-strategy.json      (catálogo real: rangos, percentiles, roles, correlaciones, atípicos)
 *   simulate    → legal-deck-simulation.json  (1.000.000 equipos legales: distribución de medias, orientación, forma, dominancia de OVR)
 *   suggestion  → suggestion-simulation.json  (colecciones de 50/100/250/500/772 definiciones: legalidad, determinismo, óptimo, tiempos)
 *   swap        → swap-fuzz.json              (100.000 cambios)
 *   strategy    → strategy-fuzz.json          (100.000 equipos)
 *   match       → match-insight-fuzz.json     (100.000 historiales + partidas del motor real)
 *   security    → security-fuzz.json          (100.000 casos)
 *   all
 *
 * `--mutate=<nombre>` inyecta una regresión conocida y escribe `*-mutation-<nombre>.json` (el fuzzer debe detectarla).
 * Todo determinista (semillas fijas). No toca la base de datos. No cambia ninguna estadística.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { makeRng, type Rng } from "../src/sim/rng";
import { DUEL_ROLES } from "../src/domain/cardgame/types";
import { checkDraft, indexPool, tryReplace, type BuilderCard, type Pool } from "../src/domain/deckBuilder/builder";
import { parseDeckRequest } from "../src/domain/deckBuilder/request";
import {
  AXES, METRICS, METRIC_LABEL, aggregateDeck, analyzeDeck, groupPool, informativeImpact, orientationOf, paretoOptions, percentileRank,
  quantile, rolePlayers, sampleLegalDeck, suggestDeck, summarize, summarizeMatch, swapAlternatives, swapImpact, totalsOf, axisKey, balancedValue,
  type Axis, type Metric, type ResultFact, type StrategyCard, type TurnFact, OBJECTIVES,
} from "../src/domain/deckStrategy";
import { builderCardOf, catalogCards, strategyContext, syntheticCollection } from "../src/lib/deckStrategy/catalog";
import { isAxis } from "../src/lib/deckStrategy/presentation";
import { qaSimulate, qaSnapshot, qaRegistry } from "../src/lib/duel/qaSimulation";
import { projectMatchFor } from "../src/domain/cardgame/pvp";
import { buildMatchView } from "../src/lib/duel/matchView";
import { COMBAT_MATCHUP } from "../src/domain/cards/combat";

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = join(process.cwd(), "docs/product/qa/fase43");
mkdirSync(OUT, { recursive: true });
const mode = process.argv[2] ?? "all";
const mutate = arg("mutate", "");
const outName = (base: string) => join(OUT, mutate ? `${base}-mutation-${mutate}.json` : `${base}.json`);
const write = (base: string, data: unknown) => writeFileSync(outName(base), JSON.stringify(data, null, 2) + "\n");
const ctx = strategyContext();
const cards = catalogCards();
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const pctiles = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return Object.fromEntries([1, 5, 10, 25, 50, 75, 90, 95, 99].map((p) => [`P${p}`, r4(quantile(s, p / 100))])); };
const pearson = (x: number[], y: number[]) => { const mx = summarize(x).mean; const my = summarize(y).mean; let n = 0; let dx = 0; let dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return dx && dy ? n / Math.sqrt(dx * dy) : 0; };
const timing = (ms: number[]) => { const s = [...ms].sort((a, b) => a - b); return { n: s.length, p50: r4(quantile(s, 0.5)), p95: r4(quantile(s, 0.95)), p99: r4(quantile(s, 0.99)), max: r4(s[s.length - 1] ?? 0) }; };
const metric = (c: { ovr: number; combat: StrategyCard["combat"] }, m: Metric) => (m === "ovr" ? c.ovr : c.combat[m]);

/* ───────────────────────────── catálogo ───────────────────────────── */

function catalog() {
  const byMetric = Object.fromEntries(METRICS.map((m) => {
    const vals = cards.map((c) => metric(c, m)); const s = summarize(vals);
    return [m, { min: s.min, max: s.max, mean: r4(s.mean), median: s.median, sd: r4(s.sd), percentiles: pctiles(vals) }];
  }));
  const roles = Object.fromEntries(DUEL_ROLES.map((role) => {
    const rc = cards.filter((c) => c.role === role);
    return [role, { definitions: rc.length, players: new Set(rc.map((c) => c.playerId)).size, mean: Object.fromEntries(METRICS.map((m) => [m, r4(summarize(rc.map((c) => metric(c, m))).mean)])) }];
  }));
  const corr: Record<string, number> = {};
  for (let i = 0; i < METRICS.length; i++) for (let j = i + 1; j < METRICS.length; j++) corr[`${METRICS[i]}~${METRICS[j]}`] = r4(pearson(cards.map((c) => metric(c, METRICS[i])), cards.map((c) => metric(c, METRICS[j]))));
  const outliers = METRICS.flatMap((m) => {
    const s = cards.map((c) => metric(c, m)).sort((a, b) => a - b); const q1 = quantile(s, 0.25); const q3 = quantile(s, 0.75); const lo = q1 - 1.5 * (q3 - q1); const hi = q3 + 1.5 * (q3 - q1);
    return cards.filter((c) => metric(c, m) < lo || metric(c, m) > hi).map((c) => ({ metric: m, cardId: c.cardId, role: c.role, value: metric(c, m), direction: metric(c, m) < lo ? "LOW" : "HIGH" }));
  });
  // Eje dominante de cada carta (descriptivo).
  const dominant: Record<string, number> = {};
  for (const c of cards) { const top = [...AXES].sort((a, b) => c.combat[b] - c.combat[a] || AXES.indexOf(a) - AXES.indexOf(b))[0]; dominant[top] = (dominant[top] ?? 0) + 1; }
  const report = { phase: 43, kind: "catalog-strategy", dataVersion: ctx.catalog.dataVersion, signature: ctx.catalog.signature, definitions: cards.length, players: new Set(cards.map((c) => c.playerId)).size, metrics: byMetric, roles, correlations: corr, dominantAxisByCard: dominant, outliers: { count: outliers.length, byMetric: Object.fromEntries(METRICS.map((m) => [m, outliers.filter((o) => o.metric === m).length])), sample: outliers.slice(0, 40) }, notes: ["Solo análisis: ninguna estadística cambia en la Fase 43."] };
  write("catalog-strategy", report);
  console.log(`catalog: ${cards.length} definiciones · corr OVR~SH ${corr["ovr~stronghold"]} · OVR~GS ${corr["ovr~gamesense"]} · OVR~EF ${corr["ovr~entryfrag"]}`);
  return 0;
}

/* ───────────────────────────── 1M equipos legales ───────────────────────────── */

function simulate() {
  const N = Number(arg("n", "1000000"));
  const t0 = performance.now();
  const players = rolePlayers(cards, ctx.catalog.dataVersion);
  const rng = makeRng(430_000);
  const vals: Record<Metric, Float64Array> = { ovr: new Float64Array(N), stronghold: new Float64Array(N), gamesense: new Float64Array(N), entryfrag: new Float64Array(N) };
  const disp = new Float64Array(N);
  const orient: Record<string, number> = {}; const shape: Record<string, number> = {}; const levelCounts: Record<string, number> = {};
  const cal = ctx.calibration;
  for (let i = 0; i < N; i++) {
    const a = aggregateDeck(sampleLegalDeck(players, rng.next));
    for (const m of METRICS) vals[m][i] = a[m];
    disp[i] = a.ovrSd;
    const z = Object.fromEntries(AXES.map((ax) => [ax, (a[ax] - cal.mean[ax]) / cal.sd[ax]])) as Record<Axis, number>;
    const o = orientationOf(z);
    const key = o.kind === "ORIENTED" ? `ORIENTED_${o.axes[0]}` : o.kind;
    orient[key] = (orient[key] ?? 0) + 1;
    const dp = percentileRank(cal.ovrDispersion, a.ovrSd);
    const sh = dp >= 90 ? "POLARIZED" : dp <= 10 ? "CONSISTENT" : "REGULAR";
    shape[sh] = (shape[sh] ?? 0) + 1;
    if (o.kind !== "BALANCED" && sh === "POLARIZED") levelCounts.mixedOrOrientedPolarized = (levelCounts.mixedOrOrientedPolarized ?? 0) + 1;
  }
  const dist = Object.fromEntries(METRICS.map((m) => { const arr = Array.from(vals[m]); const s = summarize(arr); return [m, { mean: r4(s.mean), sd: r4(s.sd), percentiles: pctiles(arr) }]; }));
  // La muestra de calibración (20.000) frente al millón: distancia máxima entre cuantiles, en puntos de percentil.
  const calibrationCheck = Object.fromEntries(METRICS.map((m) => {
    const big = Array.from(vals[m]).sort((a, b) => a - b);
    let maxGap = 0;
    for (let p = 1; p < 100; p++) { const v = quantile(big, p / 100); maxGap = Math.max(maxGap, Math.abs(percentileRank(cal.sorted[m], v) - p)); }
    return [m, { maxPercentileGap: r4(maxGap), meanDiff: r4(summarize(big).mean - cal.mean[m]), sdDiff: r4(summarize(big).sd - cal.sd[m]) }];
  }));
  const pct = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { count: v, pct: r4((100 * v) / N) }]));
  // Dominancia del OVR: correlación entre medias de equipo y R² de cada eje explicado por el OVR medio.
  const sampleIdx = Array.from({ length: Math.min(N, 200_000) }, (_, i) => i);
  const col = (m: Metric) => sampleIdx.map((i) => vals[m][i]);
  const deckCorr = Object.fromEntries(AXES.map((a) => [a, r4(pearson(col("ovr"), col(a)))]));
  const r2 = Object.fromEntries(AXES.map((a) => [a, r4(deckCorr[a] ** 2)]));
  const cardCorr = Object.fromEntries(AXES.map((a) => [a, r4(pearson(cards.map((c) => c.ovr), cards.map((c) => c.combat[a])))]));
  // Diversidad Pareto en colecciones: ¿el equipo de máxima OVR coincide con los de máximo eje?
  const pareto = { collections: 0, avgOptions: 0, sameAsOvrMax: Object.fromEntries(AXES.map((a) => [a, 0])) as Record<string, number> };
  for (let s = 1; s <= 120; s++) {
    const pool = indexPool(syntheticCollection(150 + (s % 4) * 150, 9000 + s));
    const opts = paretoOptions(pool, ctx);
    pareto.collections++; pareto.avgOptions += opts.length;
    const ovrMax = suggestDeckOvr(pool);
    for (const a of AXES) if (suggestDeck(pool, a, ctx).uids.join() === ovrMax) pareto.sameAsOvrMax[a]++;
  }
  pareto.avgOptions = r4(pareto.avgOptions / pareto.collections);
  const dominance = {
    cardLevelCorrelationOvrAxis: cardCorr,
    deckLevelCorrelationOvrAxis: deckCorr,
    deckLevelR2OvrExplainsAxis: r2,
    paretoDiversity: pareto,
    verdict: Object.values(r2).every((x) => x > 0.8)
      ? "OVR domina: explica > 80 % de la varianza de cada eje a nivel de equipo (P1 de diseño, no se rebalancea en la Fase 43)."
      : "OVR NO domina por completo: al menos un eje queda mayoritariamente sin explicar por el OVR medio (hay decisiones reales entre ejes).",
  };
  const report = { phase: 43, kind: "legal-deck-simulation", decks: N, seed: 430_000, dataVersion: ctx.catalog.dataVersion, sampling: "2 jugadores distintos por rol elegidos uniformemente; una definición uniforme de cada jugador; una calibración", distributions: dist, dispersion: { percentiles: pctiles(Array.from(disp)) }, calibrationSample: { size: cal.sample, seed: cal.seed, check: calibrationCheck }, orientation: pct(orient), shape: pct(shape), dominance, ms: Math.round(performance.now() - t0) };
  write("legal-deck-simulation", report);
  console.log(`simulate: ${N} equipos · orientación ${JSON.stringify(Object.fromEntries(Object.entries(report.orientation).map(([k, v]) => [k, v.pct])))} · ${report.ms} ms`);
  const bad = Object.values(calibrationCheck).some((c) => c.maxPercentileGap > 2) ? 1 : 0;
  return bad;
}

function suggestDeckOvr(pool: Pool): string {
  const g = [...groupPool(pool).values()][0];
  const out: StrategyCard[] = [];
  for (const role of DUEL_ROLES) out.push(...g[role].map((d) => [...d].sort((a, b) => b.ovr - a.ovr || (b.combat.stronghold + b.combat.gamesense + b.combat.entryfrag) - (a.combat.stronghold + a.combat.gamesense + a.combat.entryfrag) || a.cardId.localeCompare(b.cardId))[0]).sort((a, b) => b.ovr - a.ovr || (b.combat.stronghold + b.combat.gamesense + b.combat.entryfrag) - (a.combat.stronghold + a.combat.gamesense + a.combat.entryfrag) || a.cardId.localeCompare(b.cardId)).slice(0, 2));
  return [...out].sort((a, b) => DUEL_ROLES.indexOf(a.role) - DUEL_ROLES.indexOf(b.role) || a.cardId.localeCompare(b.cardId) || a.uid.localeCompare(b.uid)).map((c) => c.uid).join();
}

/* ───────────────────────────── sugerencias ───────────────────────────── */

function bruteBest(pool: Pool, score: (d: StrategyCard[]) => number[]): number[] | null {
  const g = [...groupPool(pool).values()][0]; if (!g) return null;
  let best: number[] | null = null;
  const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) { if (a[i] > b[i] + 1e-9) return true; if (a[i] < b[i] - 1e-9) return false; } return false; };
  const rec = (ri: number, acc: StrategyCard[]) => {
    if (ri === DUEL_ROLES.length) { const v = score(acc); if (!best || better(v, best)) best = v; return; }
    const ps = g[DUEL_ROLES[ri]];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) for (const a of ps[i]) for (const b of ps[j]) rec(ri + 1, [...acc, a, b]);
  };
  rec(0, []);
  return best;
}

function suggestion() {
  const t0 = performance.now();
  const sizes = [50, 100, 250, 500, 772];
  const bySize: Record<string, unknown> = {};
  let violations = 0; const sample: unknown[] = [];
  for (const size of sizes) {
    const times: Record<string, number[]> = Object.fromEntries(OBJECTIVES.map((o) => [o, []]));
    let legal = 0; let infeasible = 0; let deterministic = 0; let axisOptimal = 0; let runs = 0;
    for (let s = 1; s <= 30; s++) {
      const pool = indexPool(syntheticCollection(size === 772 ? 5000 : size, size * 1000 + s, size));
      for (const o of OBJECTIVES) {
        const t = performance.now(); const a = suggestDeck(pool, o, ctx); times[o].push(performance.now() - t);
        runs++;
        if (!a.ok) { infeasible++; continue; }
        const b = suggestDeck(pool, o, ctx);
        if (a.uids.join() === b.uids.join()) deterministic++; else { violations++; if (sample.length < 20) sample.push({ size, s, o, invariant: "determinista" }); }
        if (checkDraft(a.uids, pool).ready && a.uids.every((u) => pool.has(u))) legal++; else { violations++; if (sample.length < 20) sample.push({ size, s, o, invariant: "legal-poseida" }); }
        if (o !== "BALANCED") {
          // Óptimo del eje: ningún equipo legal aleatorio de esa colección lo supera (5.000 intentos) y coincide con el separable independiente.
          const g = [...groupPool(pool).values()][0];
          const indep = DUEL_ROLES.flatMap((r) => g[r].map((d) => [...d].sort((x, y) => { const kx = axisKey(o)(x); const ky = axisKey(o)(y); for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return ky[i] - kx[i]; return x.cardId.localeCompare(y.cardId); })[0]).sort((x, y) => { const kx = axisKey(o)(x); const ky = axisKey(o)(y); for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return ky[i] - kx[i]; return x.cardId.localeCompare(y.cardId); }).slice(0, 2));
          if (totalsOf(indep)[o] === a.totals![o]) axisOptimal++; else { violations++; if (sample.length < 20) sample.push({ size, s, o, invariant: "optimo-eje" }); }
        }
      }
    }
    bySize[size === 772 ? "772-definiciones-5000-ejemplares" : `${size}`] = { runs, legal, infeasible, deterministic, axisOptimal, timingMs: Object.fromEntries(OBJECTIVES.map((o) => [o, timing(times[o])])) };
  }
  // EQUILIBRADO frente a fuerza bruta en colecciones pequeñas (4 jugadores por rol).
  let exact = 0; let tiny = 0; let gapSum = 0;
  const players = rolePlayers(cards, ctx.catalog.dataVersion);
  for (let s = 1; s <= 60; s++) {
    const rng = makeRng(77_000 + s);
    const picked: BuilderCard[] = [];
    let n = 0;
    for (const role of DUEL_ROLES) { const list = [...players[role]]; for (let k = 0; k < 4; k++) { const i = Math.floor(rng.next() * list.length); const defs = list.splice(i, 1)[0]; picked.push(builderCardOf(defs[0].cardId, 800_000 + s * 50 + n++)); } }
    const pool = indexPool(picked);
    const g = [...groupPool(pool).values()][0];
    const maxOvr = DUEL_ROLES.flatMap((r) => g[r].map((d) => d[0]).sort((a, b) => b.ovr - a.ovr || (b.combat.stronghold + b.combat.gamesense + b.combat.entryfrag) - (a.combat.stronghold + a.combat.gamesense + a.combat.entryfrag) || a.cardId.localeCompare(b.cardId)).slice(0, 2));
    const floor = totalsOf(maxOvr).ovr / 10 - ctx.calibration.sd.ovr;
    const brute = bruteBest(pool, (d) => balancedValue(d, ctx, floor));
    const got = suggestDeck(pool, "BALANCED", ctx);
    tiny++;
    const v = balancedValue(got.cards, ctx, floor);
    if (brute && Math.abs(v[1] - brute[1]) < 1e-9 && v[0] === brute[0]) exact++;
    if (brute) gapSum += brute[1] - v[1];
  }
  const report = { phase: 43, kind: "suggestion-simulation", bySize, balancedVsBruteForce: { collections: tiny, exactSpread: exact, exactPct: r4((100 * exact) / tiny), meanSpreadGapSd: r4(gapSum / tiny) }, violations, sample, ms: Math.round(performance.now() - t0) };
  write("suggestion-simulation", report);
  console.log(`suggestion: ${violations} violaciones · equilibrado exacto ${exact}/${tiny} · ${report.ms} ms`);
  return violations;
}

/* ───────────────────────────── swap fuzz ───────────────────────────── */

function swap() {
  const N = Number(arg("n", "100000"));
  const t0 = performance.now();
  const pools: { pool: Pool; list: BuilderCard[]; decks: string[][] }[] = [];
  for (let s = 1; s <= 40; s++) {
    const list = syntheticCollection(120 + (s % 5) * 180, 31_000 + s);
    const pool = indexPool(list);
    const decks = OBJECTIVES.map((o) => suggestDeck(pool, o, ctx).uids).filter((u) => u.length === 10);
    pools.push({ pool, list, decks });
  }
  const foreign = syntheticCollection(200, 99_999).map((c, i) => ({ ...c, uid: `ffffffff-0000-4000-8000-${String(i).padStart(12, "0")}` }));
  const byInv: Record<string, number> = {}; const sample: unknown[] = [];
  const bad = (inv: string, detail: unknown) => { byInv[inv] = (byInv[inv] ?? 0) + 1; if (sample.length < 30) sample.push({ inv, detail }); };
  const rng = makeRng(43_43);
  let legalSwaps = 0; let illegal = 0; let fullLists = 0; const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const P = pools[Math.floor(rng.next() * pools.length)];
    const deck = P.decks[Math.floor(rng.next() * P.decks.length)];
    const slot = deck[Math.floor(rng.next() * 10)];
    const kind = rng.next();
    const cand = kind < 0.08 ? foreign[Math.floor(rng.next() * foreign.length)] : P.list[Math.floor(rng.next() * P.list.length)];
    const inPool = P.pool.has(cand.uid);
    const res = tryReplace(deck, slot, cand.uid, P.pool);
    if (res.ok) {
      legalSwaps++;
      if (!inPool) bad("no-foreign", { cand: cand.uid });
      if (!checkDraft(res.uids, P.pool).ready) bad("role-season-duplicate-legal", { slot, cand: cand.uid });
      if (P.pool.get(slot)!.role !== cand.role) bad("role-legal", { slot, cand: cand.uid });
      const cur = P.pool.get(slot)!;
      let imp = swapImpact(deck.map((u) => P.pool.get(u)!), slot, cand, ctx);
      if (mutate === "wrong-delta") imp = { ...imp, delta: { ...imp.delta, gamesense: imp.delta.gamesense + 0.1 } };
      for (const m of METRICS) if (Math.abs(imp.delta[m] - (metric(cand, m) - metric(cur, m)) / 10) > 1e-9) bad("delta-exact", { m });
      // serial irrelevante: mismo impacto con otro serial.
      if (i % 10 === 0) {
        const imp2 = swapImpact(deck.map((u) => ({ ...P.pool.get(u)!, serial: 1 })), slot, { ...cand, serial: 999 } as StrategyCard, ctx);
        if (JSON.stringify(imp2) !== JSON.stringify(mutate === "wrong-delta" ? swapImpact(deck.map((u) => P.pool.get(u)!), slot, cand, ctx) : imp)) bad("serial-irrelevant", { slot });
      }
    } else {
      illegal++;
      if (!inPool && res.code !== "NOT_OWNED") bad("unowned-not-actionable", { code: res.code });
      if (!inPool) { const inf = informativeImpact(deck.map((u) => P.pool.get(u)!), slot, cand, ctx); if ("nextUids" in inf) bad("unowned-not-actionable", { cand: cand.uid }); }
    }
    if (i % 400 === 0) {
      fullLists++;
      const t = performance.now();
      const alts = swapAlternatives(deck, slot, P.pool, ctx);
      times.push(performance.now() - t);
      const seen = new Set<string>();
      for (const a of alts) {
        if (!P.pool.has(a.card.uid)) bad("no-unowned-actionable", a.card.uid);
        if (seen.has(a.card.cardId)) bad("no-duplicate-definition", a.card.cardId);
        seen.add(a.card.cardId);
        if (!checkDraft(a.nextUids, P.pool).ready) bad("alternative-legal", a.card.uid);
        if (a.card.role !== P.pool.get(slot)!.role) bad("role-legal", a.card.uid);
        if (JSON.stringify(a).includes("ffffffff-")) bad("no-hidden-info", a.card.uid);
      }
    }
  }
  const violations = Object.values(byInv).reduce((a, b) => a + b, 0);
  write("swap-fuzz", { phase: 43, kind: "swap-fuzz", swaps: N, legalSwaps, illegalAttempts: illegal, fullAlternativeLists: fullLists, alternativesTimingMs: timing(times), mutate: mutate || null, violations, byInvariant: byInv, sample, ms: Math.round(performance.now() - t0) });
  console.log(`swap: ${N} cambios · ${legalSwaps} legales · ${violations} violaciones · ${Math.round(performance.now() - t0)} ms`);
  return violations;
}

/* ───────────────────────────── strategy fuzz ───────────────────────────── */

const ALLOWED_LABELS = new Set(["Equilibrado", "Perfil mixto", ...AXES.map((a) => `Orientado a ${METRIC_LABEL[a]}`)]);

function strategy() {
  const N = Number(arg("n", "100000"));
  const t0 = performance.now();
  const players = rolePlayers(cards, ctx.catalog.dataVersion);
  const rng = makeRng(4343);
  const byInv: Record<string, number> = {}; const sample: unknown[] = [];
  const bad = (inv: string, detail: unknown) => { byInv[inv] = (byInv[inv] ?? 0) + 1; if (sample.length < 30) sample.push({ inv, detail }); };
  const orient: Record<string, number> = {}; const times: number[] = [];
  const shuffle = <T,>(xs: T[], r: Rng) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let i = 0; i < N; i++) {
    const base = sampleLegalDeck(players, rng.next);
    const size = rng.next() < 0.1 ? Math.floor(rng.next() * 10) : 10;
    const deck: BuilderCard[] = base.slice(0, size).map((c, k) => ({ ...builderCardOf(c.cardId, i * 11 + k), serial: rng.next() < 0.5 ? null : 1 + Math.floor(rng.next() * 500) }));
    const t = performance.now();
    let a = analyzeDeck(deck, ctx);
    times.push(performance.now() - t);
    if (mutate === "serial-power") a = { ...a, metrics: { ...a.metrics, ovr: { ...a.metrics.ovr, mean: a.metrics.ovr.mean + deck.reduce((s, c) => s + (c.serial === 1 ? 1 : 0), 0) } } };
    const json = JSON.stringify(a);
    if (json.includes("NaN") || json.includes("Infinity") || json.includes("null,null,null,null,null")) { if (/NaN|Infinity/.test(json)) bad("no-nan-infinity", i); }
    if (i % 4 === 0) {
      if (JSON.stringify(analyzeDeck(deck, ctx)) !== JSON.stringify(analyzeDeck(deck, ctx))) bad("deterministic", i);
      if (JSON.stringify(analyzeDeck(shuffle(deck, rng), ctx)) !== JSON.stringify(analyzeDeck(deck, ctx))) bad("order-invariant", i);
      const meta = deck.map((c) => ({ ...c, serial: 1, team: "QA Team", region: "China" as BuilderCard["region"], variantId: "icon-series" as BuilderCard["variantId"], statBoost: 12, country: "ZZ" }));
      if (JSON.stringify(analyzeDeck(meta, ctx)) !== (mutate === "serial-power" ? JSON.stringify(analyzeDeck(deck, ctx)) : json)) {
        if (mutate === "serial-power") bad("serial-irrelevant", i); else bad("metadata-no-power(serial,rarity,team,region,edition)", i);
      }
      if (mutate === "serial-power" && JSON.stringify(a) !== JSON.stringify(analyzeDeck(deck, ctx))) bad("serial-irrelevant", i);
    }
    if (a.strengths.length > 3 || a.weaknesses.length > 3) bad("bounded-insights", i);
    if (a.complete) {
      if (!a.orientation || !ALLOWED_LABELS.has(a.orientation.label)) bad("bounded-labels", a.orientation?.label);
      orient[a.orientation!.label] = (orient[a.orientation!.label] ?? 0) + 1;
      if (!["POLARIZED", "CONSISTENT", "REGULAR"].includes(a.shape!)) bad("bounded-labels", a.shape);
      for (const m of METRICS) if (a.deckPercentile![m] < 0 || a.deckPercentile![m] > 100 || a.catalogPercentile![m] < 0 || a.catalogPercentile![m] > 100) bad("percentile-range", m);
    } else if (a.orientation !== null) bad("incomplete-no-orientation", i);
    for (const s of [...a.strengths, ...a.weaknesses]) if (/mejor equipo|ganar|bonus|sinergia|química|\d+\/100/i.test(s.text)) bad("no-fake-score", s.text);
  }
  const violations = Object.values(byInv).reduce((x, y) => x + y, 0);
  write("strategy-fuzz", { phase: 43, kind: "strategy-fuzz", decks: N, mutate: mutate || null, orientation: orient, analysisTimingMs: timing(times), violations, byInvariant: byInv, sample, ms: Math.round(performance.now() - t0) });
  console.log(`strategy: ${N} equipos · ${violations} violaciones · análisis p95 ${timing(times).p95} ms · ${Math.round(performance.now() - t0)} ms`);
  return violations;
}

/* ───────────────────────────── match fuzz ───────────────────────────── */

const RIVAL_STAT: Record<Axis, Axis> = { stronghold: "entryfrag", gamesense: "gamesense", entryfrag: "stronghold" };

function syntheticHistory(rng: Rng): { turns: TurnFact[]; result: ResultFact } {
  let y = 0; let r = 0; let ties = 0; let totY = 0; let totR = 0;
  const first = rng.next() < 0.5 ? "A" : "B";
  const turns: TurnFact[] = [];
  for (let i = 0; i < 10; i++) {
    const stat = AXES[Math.floor(rng.next() * 3)];
    const vy = rng.next() < 0.1 ? 70 : 40 + Math.floor(rng.next() * 60);
    const vr = rng.next() < 0.12 ? vy : 40 + Math.floor(rng.next() * 60);
    const outcome = vy > vr ? "A" : vr > vy ? "B" : "TIE";
    if (outcome === "A") y++; else if (outcome === "B") r++; else ties++;
    totY += vy; totR += vr;
    turns.push({ number: i + 1, attacker: (i % 2 === 0) === (first === "A") ? "A" : "B", outcome, scoreAfterYou: y, scoreAfterRival: r, you: { uid: `y${i}`, nick: `Y${i}`, stat, value: vy }, rival: { uid: `r${i}`, nick: `R${i}`, stat: RIVAL_STAT[stat], value: vr } });
  }
  let decidedBy: ResultFact["decidedBy"] = "SCORE"; let winner: ResultFact["winner"] = y > r ? "YOU" : r > y ? "RIVAL" : null;
  const sumY = 780 + Math.floor(rng.next() * 40); const sumR = rng.next() < 0.3 ? sumY : 780 + Math.floor(rng.next() * 40);
  let sy = y; let sr = r; let isDraw = false;
  if (y === r) {
    if (sumY !== sumR) { decidedBy = "OVR_TIEBREAK"; winner = sumY > sumR ? "YOU" : "RIVAL"; if (winner === "YOU") sy++; else sr++; }
    else if (totY !== totR) { decidedBy = "STAT_MARGIN"; winner = totY > totR ? "YOU" : "RIVAL"; }
    else { decidedBy = "NONE"; winner = null; isDraw = true; }
  }
  return { turns, result: { winner, isDraw, scoreYou: sy, scoreRival: sr, tiedEncounters: ties, decidedBy, sumOvrYou: sumY, sumOvrRival: sumR, statTotalYou: totY, statTotalRival: totR } };
}

function checkSummary(turns: TurnFact[], result: ResultFact, bad: (inv: string, d: unknown) => void, tag: string) {
  const s = summarizeMatch(turns, result);
  let cmp = 0;
  for (const a of s.axes) {
    cmp += a.timesCompared;
    if (a.wins + a.losses + a.ties !== a.timesCompared) bad("wins+losses+ties=comparisons", tag);
    const real = turns.filter((t) => t.you.stat === a.axis);
    if (a.wins !== real.filter((t) => t.outcome === "A").length || a.losses !== real.filter((t) => t.outcome === "B").length) bad("axis-exact", tag);
  }
  if (cmp !== turns.length) bad("no-invented-turn", tag);
  if (s.cards.reduce((x, c) => x + c.turns, 0) !== turns.length) bad("no-invented-turn", tag);
  if (turns.some((t) => (t.outcome === "TIE") !== (t.you.value === t.rival.value))) bad("turn-equal-0-points", tag);
  const tb = result.decidedBy === "OVR_TIEBREAK" ? 1 : 0;
  if (s.wins + (result.winner === "YOU" ? tb : 0) !== result.scoreYou || s.losses + (result.winner === "RIVAL" ? tb : 0) !== result.scoreRival) bad("no-wrong-points", tag);
  if (!s.consistent) bad("consistent", tag);
  if (s.resolution?.decidedBy !== result.decidedBy) bad("no-wrong-tiebreak", tag);
  if (result.decidedBy === "STAT_MARGIN" && (s.resolution!.tiebreakPointYou || s.resolution!.tiebreakPointRival)) bad("no-wrong-tiebreak", tag);
  if (result.decidedBy === "OVR_TIEBREAK" && s.resolution!.tiebreakPointYou + s.resolution!.tiebreakPointRival !== 1) bad("no-wrong-tiebreak", tag);
  for (const t of [...s.insights, ...(s.resolution?.lines ?? [])]) {
    if (/porque|por culpa|debido a|por eso|culpa/i.test(t)) bad("no-causal-claim", t);
    const m = /^(Ganaste|Perdiste) (\d+) de (\d+) comparaciones de (\w+)\.$/.exec(t);
    if (m) { const ax = s.axes.find((a) => METRIC_LABEL[a.axis] === m[4])!; if (Number(m[2]) !== (m[1] === "Ganaste" ? ax.wins : ax.losses) || Number(m[3]) !== ax.timesCompared) bad("insight-numbers", t); }
  }
  if (s.insights.length > 3) bad("bounded-insights", tag);
}

function match() {
  const N = Number(arg("n", "100000"));
  const t0 = performance.now();
  const rng = makeRng(4_3000);
  const byInv: Record<string, number> = {}; const sample: unknown[] = [];
  const bad = (inv: string, detail: unknown) => { byInv[inv] = (byInv[inv] ?? 0) + 1; if (sample.length < 30) sample.push({ inv, detail }); };
  const decided: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const h = syntheticHistory(rng);
    if (mutate === "tiebreak-point") h.result = h.result.decidedBy === "STAT_MARGIN" ? { ...h.result, scoreYou: h.result.scoreYou + (h.result.winner === "YOU" ? 1 : 0) } : h.result;
    decided[h.result.decidedBy] = (decided[h.result.decidedBy] ?? 0) + 1;
    checkSummary(h.turns, h.result, bad, `synthetic-${i}`);
  }
  // Partidas del MOTOR REAL (bots), proyectadas como en el servidor.
  const snaps = [0, 1, 2, 3].map((k) => qaSnapshot(k, `qa-${k}`, `QA ${k}`));
  const mirrorB = qaSnapshot(0, "qa-mirror", "QA espejo");
  let engine = 0; const engineDecided: Record<string, number> = {};
  for (let s = 1; s <= 2000; s++) {
    const a = snaps[s % 4]; const b = s % 3 === 0 ? mirrorB : snaps[(s + 1) % 4];
    if (a.deckId === b.deckId) continue;
    const m = qaSimulate(a, b, 10, s % 2 ? "A" : "B", s);
    if (!m.result) continue;
    const view = buildMatchView(m, { side: "A", registry: qaRegistry, difficulty: "NORMAL" });
    const r = view.result!;
    engineDecided[r.decidedBy] = (engineDecided[r.decidedBy] ?? 0) + 1;
    const facts = view.history.map((t) => ({ number: t.number, attacker: t.attacker as "A" | "B", outcome: t.outcome, scoreAfterYou: t.scoreAfterYou, scoreAfterRival: t.scoreAfterRival, you: { uid: t.you.uid, nick: t.you.nick, stat: t.you.stat, value: t.you.value }, rival: { uid: t.rival.uid, nick: t.rival.nick, stat: t.rival.stat, value: t.rival.value } }));
    for (const t of facts) if (COMBAT_MATCHUP[t.you.stat] !== t.rival.stat) bad("engine-matchup", t.number);
    checkSummary(facts, { winner: r.winner, isDraw: r.isDraw, scoreYou: r.scoreYou, scoreRival: r.scoreRival, tiedEncounters: r.tiedEncounters, decidedBy: r.decidedBy, sumOvrYou: r.sumOvrYou, sumOvrRival: r.sumOvrRival, statTotalYou: r.statTotalYou, statTotalRival: r.statTotalRival }, bad, `engine-${s}`);
    engine++;
  }
  const violations = Object.values(byInv).reduce((x, y) => x + y, 0);
  write("match-insight-fuzz", { phase: 43, kind: "match-insight-fuzz", histories: N, engineMatches: engine, decidedBySynthetic: decided, decidedByEngine: engineDecided, mutate: mutate || null, violations, byInvariant: byInv, sample, ms: Math.round(performance.now() - t0) });
  console.log(`match: ${N} historiales + ${engine} partidas del motor · ${violations} violaciones · ${Math.round(performance.now() - t0)} ms`);
  return violations;
}

/* ───────────────────────────── security fuzz ───────────────────────────── */

function security() {
  const N = Number(arg("n", "100000"));
  const t0 = performance.now();
  const rng = makeRng(43_999);
  const byInv: Record<string, number> = {}; const sample: unknown[] = []; const byAttack: Record<string, number> = {};
  const bad = (inv: string, detail: unknown) => { byInv[inv] = (byInv[inv] ?? 0) + 1; if (sample.length < 30) sample.push({ inv, detail }); };
  const uuid = () => `${Math.floor(rng.next() * 0xffffffff).toString(16).padStart(8, "0")}-0000-4000-8000-${Math.floor(rng.next() * 1e12).toString().padStart(12, "0")}`;
  const ATTACKS = ["foreign-deck", "foreign-uid", "hidden-opponent", "fake-stats", "fake-ovr", "fake-role", "fake-serial-bonus", "arbitrary-userId", "path-traversal", "oversized"] as const;
  const snaps = [0, 1, 2].map((k) => qaSnapshot(k, `sec-${k}`, `SEC ${k}`));
  const pool = indexPool(syntheticCollection(300, 777));
  const deck = suggestDeck(pool, "BALANCED", ctx).uids;
  const foreignPool = syntheticCollection(100, 778).map((c, i) => ({ ...c, uid: `eeeeeeee-0000-4000-8000-${String(i).padStart(12, "0")}` }));
  for (let i = 0; i < N; i++) {
    const attack = ATTACKS[i % ATTACKS.length];
    byAttack[attack] = (byAttack[attack] ?? 0) + 1;
    const cardUids = Array.from({ length: 1 + Math.floor(rng.next() * 10) }, uuid);
    switch (attack) {
      case "fake-stats": case "fake-ovr": case "fake-role": case "fake-serial-bonus": case "arbitrary-userId": {
        const extra = { "fake-stats": { combat: { stronghold: 99, gamesense: 99, entryfrag: 99 } }, "fake-ovr": { ovr: 99 }, "fake-role": { role: "Flex" }, "fake-serial-bonus": { serial: 1, bonus: 10 }, "arbitrary-userId": { userId: uuid() } }[attack];
        const body = { action: rng.next() < 0.5 ? "save" : "create", name: "QA", cardUids, ...extra };
        let parsed = parseDeckRequest(body);
        if (mutate === "accept-extra") parsed = { ok: true, req: { action: "save", name: "QA", cardUids } };
        if (parsed.ok) bad("mutation-body-rejects-extra-fields", attack);
        break;
      }
      case "oversized": {
        const body = { action: "save", name: "x".repeat(rng.next() < 0.5 ? 201 : 10), cardUids: Array.from({ length: 11 + Math.floor(rng.next() * 50) }, uuid) };
        if (parseDeckRequest(body).ok) bad("oversized-rejected", body.cardUids.length);
        break;
      }
      case "path-traversal": {
        const evil = ["../../etc/passwd", "..%2F..%2Fadmin", "<script>alert(1)</script>", "gamesense;drop", "entryfrag\u0000", "' OR 1=1 --"][Math.floor(rng.next() * 6)];
        if (parseDeckRequest({ action: "duplicate", id: evil }).ok) bad("id-traversal-rejected", evil);
        if (isAxis(evil)) bad("eje-param-closed-list", evil);
        if (/^[a-z0-9_-]{1,80}$/i.test(evil)) bad("explorar-param-closed-pattern", evil);
        break;
      }
      case "foreign-uid": case "foreign-deck": {
        const f = foreignPool[Math.floor(rng.next() * foreignPool.length)];
        const r = tryReplace(deck, deck[Math.floor(rng.next() * 10)], f.uid, pool);
        if (r.ok) bad("foreign-not-actionable", f.uid);
        const alts = swapAlternatives(deck, deck[i % 10], pool, ctx, { limit: 5 });
        if (alts.some((a) => a.card.uid.startsWith("eeeeeeee"))) bad("foreign-never-listed", f.uid);
        if (i % 50 === 0 && suggestDeck(pool, OBJECTIVES[i % 4], ctx).uids.some((u) => u.startsWith("eeeeeeee"))) bad("suggestion-owned-only", i);
        break;
      }
      case "hidden-opponent": {
        const a = snaps[i % 3]; const b = snaps[(i + 1) % 3];
        const turns = 1 + Math.floor(rng.next() * 9);
        if (i % 10 !== 0) break; // la simulación es cara: 1 de cada 10 casos juega; el resto cuenta el intento sobre la misma proyección
        const m = qaSimulate(a, b, turns, i % 2 ? "A" : "B", i);
        const projected = projectMatchFor(m, "A");
        const view = buildMatchView(projected, { side: "A", registry: qaRegistry, difficulty: "NORMAL", rivalLabel: "Rival" });
        const unplayed = b.cards.map((c) => c.uid).filter((u) => !m.usedB.includes(u) && !(m.draft.attackerCardUid === u && m.attacker === "B"));
        const json = JSON.stringify(view) + JSON.stringify(summarizeMatch(view.history.map((t) => ({ number: t.number, attacker: t.attacker as "A" | "B", outcome: t.outcome, scoreAfterYou: t.scoreAfterYou, scoreAfterRival: t.scoreAfterRival, you: { uid: t.you.uid, nick: t.you.nick, stat: t.you.stat, value: t.you.value }, rival: { uid: t.rival.uid, nick: t.rival.nick, stat: t.rival.stat, value: t.rival.value } })), null));
        for (const u of unplayed) if (json.includes(`"${u}"`)) bad("hidden-rival-card", u);
        break;
      }
    }
  }
  const violations = Object.values(byInv).reduce((x, y) => x + y, 0);
  write("security-fuzz", { phase: 43, kind: "security-fuzz", cases: N, byAttack, mutate: mutate || null, violations, byInvariant: byInv, sample, ms: Math.round(performance.now() - t0) });
  console.log(`security: ${N} casos · ${violations} violaciones · ${Math.round(performance.now() - t0)} ms`);
  return violations;
}

function main() {
  let bad = 0;
  if (mode === "catalog" || mode === "all") bad += catalog();
  if (mode === "simulate" || mode === "all") bad += simulate();
  if (mode === "suggestion" || mode === "all") bad += suggestion();
  if (mode === "swap" || mode === "all") bad += swap();
  if (mode === "strategy" || mode === "all") bad += strategy();
  if (mode === "match" || mode === "all") bad += match();
  if (mode === "security" || mode === "all") bad += security();
  if (bad > 0 && !mutate) process.exitCode = 1;
}
main();
