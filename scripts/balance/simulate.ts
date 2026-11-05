/**
 * FASE 65 · BALANCE & META 5.0 — SIMULATION LAB (fuera de línea, 0 escrituras en BD).
 *
 *   npm run balance:simulate                         # corrida completa (≈1,3 M partidas, ~3 min)
 *   npm run balance:simulate -- --scale=0.02         # humo rápido
 *   npm run balance:simulate -- --seed=65000 --out=<dir> --suites=field,paired
 *
 * Cada partida es el MOTOR REAL (`src/domain/balance/lab.ts` → startDuelMatch + advanceBots + resolveCombat) con mazos que
 * pasan el validador canónico. Todo sale de semillas explícitas: misma semilla + mismo catálogo ⇒ mismos números.
 * La agregación es en streaming (contadores sumables); no se guarda ninguna partida entera.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  LAB_VERSION, STATS, catalogCards, labSnapshot, randomDeck, scoredDeck, pveOpponentDeck, playMatch, shadowDecision,
  STRATEGIES, POLICIES, SHADOW_RULES, combatSum, peakStat, byRole, wilson, meanCi, shrink, pearson, add, hashStr, isLegalDeck,
  type LabMatch, type Policy, type Tally, type Pool,
} from "../../src/domain/balance/lab";
import { createRng, nextFloat, nextInt, type RngState } from "../../src/domain/cardgame/opponent";
import { DUEL_ROLES, type DuelDeckSnapshot, type RoleId } from "../../src/domain/cardgame";
import { ORCHESTRATOR_VERSION } from "../../src/domain/cardgame/match";
import { CURRENT_COMBAT_RULES, RESOLVER_VERSION } from "../../src/domain/cardgame/combat";
import { simulateStarter, dbDistribution } from "../../src/domain/onboarding/starterMath";
import { writeReports } from "./report";

/* eslint-disable @typescript-eslint/no-explicit-any */
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const SCALE = Number(arg("scale", "1"));
const SEED = Number(arg("seed", "65000"));
const OUT = arg("out", join(process.cwd(), "docs/product/qa/fase65-balance"));
const SUITES = arg("suites", "mirror,side,field,paired,edition,strategies,hillclimb,bots,pve,starter,autodeck,rng,integrity").split(",");
const N = (base: number) => Math.max(1, Math.round(base * SCALE));
mkdirSync(OUT, { recursive: true });

const pool: Pool = catalogCards();
const card = new Map(pool.map((c) => [c.cardId, c]));
const roles = byRole(pool);
let matchesPlayed = 0;
const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const round = (x: number, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const wr = (k: number, n: number) => { const w = wilson(k, n); return { n, rate: round(w.p), lo: round(w.lo), hi: round(w.hi) }; };
const write = (name: string, data: unknown) => writeFileSync(join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");

/** Semillas derivadas y estables por suite: cambiar una suite no mueve las otras. */
const suiteRng = (name: string) => createRng((SEED ^ hashStr(name)) >>> 0);
const seedOf = (name: string, i: number) => (hashStr(`${SEED}:${name}:${i}`) || 1) >>> 0;

function rngInt(r: { s: RngState }, lo: number, hi: number): number { const x = nextInt(r.s, lo, hi); r.s = x.rng; return x.value; }
function rngFloat(r: { s: RngState }): number { const x = nextFloat(r.s); r.s = x.rng; return x.value; }
function genRandom(r: { s: RngState }): string[] { const d = randomDeck(r.s, pool, roles); r.s = d.rng; return d.cardIds; }

let deckSeq = 0;
const snap = (ids: readonly string[], tag = "d"): DuelDeckSnapshot => labSnapshot(ids, `${tag}${deckSeq++}`);
const sumOvr = (ids: readonly string[]) => ids.reduce((s, id) => s + card.get(id)!.ovr, 0);
const sumCombat = (ids: readonly string[]) => ids.reduce((s, id) => s + combatSum(card.get(id)!), 0);

function play(a: DuelDeckSnapshot, b: DuelDeckSnapshot, pa: Policy, pb: Policy, first: "A" | "B", seed: number): LabMatch {
  matchesPlayed++;
  return playMatch(a, b, pa, pb, first, seed);
}
/** Resultado de A en {0, 0.5, 1}. */
const scoreA = (m: LabMatch) => (m.winner === "A" ? 1 : m.winner === "B" ? 0 : 0.5);

/* ───────────────────────── registro común de una partida ───────────────────────── */

function record(t: Tally, m: LabMatch): void {
  add(t, "n");
  if (m.draw) add(t, "draw"); else add(t, m.winner === "A" ? "winA" : "winB");
  if (m.winner === m.first) add(t, "firstWin");
  add(t, `decidedBy:${m.decidedBy}`);
  if (!m.integrityOk) add(t, "integrityBad");
  const margin = Math.abs(m.rawA - m.rawB);
  add(t, `margin:${margin}`);
  add(t, `ties:${m.ties}`);
  add(t, `score:${Math.max(m.scoreA, m.scoreB)}-${Math.min(m.scoreA, m.scoreB)}`);
  if (margin >= 6) add(t, "stomp");
  if (margin <= 1) add(t, "close");
  // Recorrido: líder, remontada, decidido antes de tiempo.
  let a = 0, b = 0, maxDefA = 0, maxDefB = 0, decidedAt = 10, halfLeader: "A" | "B" | null = null;
  m.encounters.forEach((e, i) => {
    if (e.outcome === "A") a++; else if (e.outcome === "B") b++;
    maxDefA = Math.max(maxDefA, b - a); maxDefB = Math.max(maxDefB, a - b);
    const remaining = 9 - i;
    if (decidedAt === 10 && Math.abs(a - b) > remaining) decidedAt = i + 1;
    if (i === 4) halfLeader = a > b ? "A" : b > a ? "B" : null;
    add(t, `turn:${i + 1}:n`);
    if (e.outcome === "TIE") add(t, `turn:${i + 1}:tie`); else if (e.outcome === e.attacker) add(t, `turn:${i + 1}:atkWin`);
    add(t, `stat:${e.stat}:n`);
    if (e.outcome === "TIE") add(t, `stat:${e.stat}:tie`); else if (e.outcome === e.attacker) add(t, `stat:${e.stat}:atkWin`);
    add(t, `stat:${e.stat}:atkSum`, e.atkValue); add(t, `stat:${e.stat}:defSum`, e.defValue);
    add(t, "enc:n"); if (e.outcome === "TIE") add(t, "enc:tie"); else if (e.outcome === e.attacker) add(t, "enc:atkWin");
    if (e.attacker === m.first) { add(t, "enc:firstAtk:n"); if (e.outcome === e.attacker) add(t, "enc:firstAtk:win"); }
    else { add(t, "enc:secondAtk:n"); if (e.outcome === e.attacker) add(t, "enc:secondAtk:win"); }
  });
  add(t, `decidedAt:${decidedAt}`);
  if (m.winner === "A" && maxDefA >= 2) add(t, "comeback2");
  if (m.winner === "B" && maxDefB >= 2) add(t, "comeback2");
  if (halfLeader && m.winner && halfLeader !== m.winner) add(t, "halfReversal");
  if (halfLeader) add(t, "halfLeaderExists");
  // Desempates en sombra.
  for (const r of SHADOW_RULES) {
    const s = shadowDecision(m, r);
    if (r === "CURRENT" && (s.winner !== m.winner || (s.by !== m.decidedBy && !(s.by === "DRAW" && m.decidedBy === "NONE")))) add(t, "shadow:CURRENT:mismatch");
    if (s.winner !== m.winner) add(t, `shadow:${r}:changed`);
    if (s.winner === null) add(t, `shadow:${r}:draw`);
    add(t, `shadow:${r}:by:${s.by}`);
    if (s.winner === m.first) add(t, `shadow:${r}:firstWin`);
    if (m.rawA === m.rawB && s.winner) {
      // ¿El desempate premia al mazo con más combate impreso (poder real) o al que declaró más en la partida?
      add(t, `shadow:${r}:tb:n`);
      const dC = s.winner === "A" ? m.combatSumA - m.combatSumB : m.combatSumB - m.combatSumA;
      const dS = s.winner === "A" ? m.statTotalA - m.statTotalB : m.statTotalB - m.statTotalA;
      if (dC > 0) add(t, `shadow:${r}:tb:higherCombat`);
      if (dS > 0) add(t, `shadow:${r}:tb:higherDeclared`);
    }
  }
  if (m.decidedBy === "OVR_TIEBREAK") {
    const ovrW = m.winner!;
    const cw = ovrW === "A" ? m.combatSumA - m.combatSumB : m.combatSumB - m.combatSumA;
    const sw = ovrW === "A" ? m.statTotalA - m.statTotalB : m.statTotalB - m.statTotalA;
    add(t, "ovrTb:n"); if (cw < 0) add(t, "ovrTb:lowerCombat"); if (sw < 0) add(t, "ovrTb:lowerStatTotal");
    add(t, "ovrTb:ovrGap", Math.abs(m.sumOvrA - m.sumOvrB));
  }
  // Poder del mazo contra resultado (cubos por diferencia de OVR y de combate impresos).
  const dO = m.sumOvrA - m.sumOvrB, dC = m.combatSumA - m.combatSumB;
  const bucket = (d: number, w: number) => Math.max(-6, Math.min(6, Math.round(d / w)));
  const hiO = dO >= 0 ? scoreA(m) : 1 - scoreA(m), hiC = dC >= 0 ? scoreA(m) : 1 - scoreA(m);
  const bo = Math.abs(bucket(dO, 5)), bc = Math.abs(bucket(dC, 20));
  add(t, `ovrGap:${bo}:n`); add(t, `ovrGap:${bo}:hiScore`, hiO);
  add(t, `combatGap:${bc}:n`); add(t, `combatGap:${bc}:hiScore`, hiC);
}

function summaryOf(t: Tally) {
  const n = t.n ?? 0;
  const turn = Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, attackerWin: wr(t[`turn:${i + 1}:atkWin`] ?? 0, t[`turn:${i + 1}:n`] ?? 0), tieRate: round((t[`turn:${i + 1}:tie`] ?? 0) / (t[`turn:${i + 1}:n`] || 1)) }));
  const stat = Object.fromEntries(STATS.map((s) => [s, {
    declared: round((t[`stat:${s}:n`] ?? 0) / (t["enc:n"] || 1)), attackerWin: wr(t[`stat:${s}:atkWin`] ?? 0, t[`stat:${s}:n`] ?? 0),
    tieRate: round((t[`stat:${s}:tie`] ?? 0) / (t[`stat:${s}:n`] || 1)),
    meanAttack: round((t[`stat:${s}:atkSum`] ?? 0) / (t[`stat:${s}:n`] || 1), 2), meanDefense: round((t[`stat:${s}:defSum`] ?? 0) / (t[`stat:${s}:n`] || 1), 2),
  }]));
  const keys = (p: string) => Object.keys(t).filter((k) => k.startsWith(p)).sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]) || a.localeCompare(b));
  const hist = (p: string) => Object.fromEntries(keys(p).map((k) => [k.slice(p.length), t[k]]));
  const gap = (p: string) => Object.fromEntries([...new Set(keys(p).map((k) => k.split(":")[1]))].map((b) => [b, { n: t[`${p}${b}:n`], higherScore: round((t[`${p}${b}:hiScore`] ?? 0) / (t[`${p}${b}:n`] || 1)) }]));
  return {
    matches: n,
    sideA: wr((t.winA ?? 0) + (t.draw ?? 0) / 2, n), drawRate: round((t.draw ?? 0) / (n || 1)),
    firstAttackerWin: wr(t.firstWin ?? 0, n - (t.draw ?? 0)),
    decidedBy: hist("decidedBy:"), margin: hist("margin:"), tiedEncounters: hist("ties:"), finalScores: hist("score:"),
    stompRate: round((t.stomp ?? 0) / (n || 1)), closeRate: round((t.close ?? 0) / (n || 1)),
    comebackFrom2Down: round((t.comeback2 ?? 0) / (n || 1)), halfTimeReversal: round((t.halfReversal ?? 0) / (t.halfLeaderExists || 1)),
    decidedAtTurn: hist("decidedAt:"), decidedBeforeLastTurn: round(1 - (t["decidedAt:10"] ?? 0) / (n || 1)),
    encounter: {
      attackerWin: wr(t["enc:atkWin"] ?? 0, t["enc:n"] ?? 0), tieRate: round((t["enc:tie"] ?? 0) / (t["enc:n"] || 1)),
      firstAttackerAttacks: wr(t["enc:firstAtk:win"] ?? 0, t["enc:firstAtk:n"] ?? 0), secondAttackerAttacks: wr(t["enc:secondAtk:win"] ?? 0, t["enc:secondAtk:n"] ?? 0),
    },
    perTurn: turn, perStat: stat,
    shadow: Object.fromEntries(SHADOW_RULES.map((r) => [r, {
      changedWinner: round((t[`shadow:${r}:changed`] ?? 0) / (n || 1), 5), draws: round((t[`shadow:${r}:draw`] ?? 0) / (n || 1), 5), by: hist(`shadow:${r}:by:`),
      firstAttackerWin: wr(t[`shadow:${r}:firstWin`] ?? 0, n - (t[`shadow:${r}:draw`] ?? 0)),
      tiedMatchesResolved: t[`shadow:${r}:tb:n`] ?? 0,
      tiebreakWinnerHadMoreCombat: round((t[`shadow:${r}:tb:higherCombat`] ?? 0) / (t[`shadow:${r}:tb:n`] || 1)),
      tiebreakWinnerDeclaredMore: round((t[`shadow:${r}:tb:higherDeclared`] ?? 0) / (t[`shadow:${r}:tb:n`] || 1)),
    }])),
    shadowCurrentMismatches: t["shadow:CURRENT:mismatch"] ?? 0,
    ovrTiebreak: { n: t["ovrTb:n"] ?? 0, shareOfMatches: round((t["ovrTb:n"] ?? 0) / (n || 1)), winnerHadLowerCombatSum: round((t["ovrTb:lowerCombat"] ?? 0) / (t["ovrTb:n"] || 1)), winnerHadLowerDeclaredStats: round((t["ovrTb:lowerStatTotal"] ?? 0) / (t["ovrTb:n"] || 1)), meanOvrGap: round((t["ovrTb:ovrGap"] ?? 0) / (t["ovrTb:n"] || 1), 2) },
    byOvrGap_per5: gap("ovrGap:"), byCombatGap_per20: gap("combatGap:"),
    integrityBad: t.integrityBad ?? 0,
  };
}

/* ───────────────────────── suites ───────────────────────── */

const results: Record<string, any> = {};

/** 1 · ESPEJO: mismo mazo en los dos lados. Sin diferencia de poder, todo lo que no sea 50 % es posición. */
function suiteMirror() {
  const out: Record<string, any> = {};
  const r = { s: suiteRng("mirror") };
  for (const p of ["HARD", "NORMAL", "SMART", "RANDOM"] as Policy[]) {
    const t: Tally = {};
    const n = N(25_000);
    for (let i = 0; i < n; i++) {
      const ids = genRandom(r);
      const m = play(snap(ids, "mA"), snap(ids, "mB"), p, p, i % 2 ? "A" : "B", seedOf(`mirror:${p}`, i));
      record(t, m);
    }
    out[p] = summaryOf(t);
    log(`mirror ${p}: primer atacante ${out[p].firstAttackerWin.rate} (n=${n}), empates ${out[p].drawRate}`);
  }
  results.mirror = out;
}

/** 2 · LADO EMPAREJADO: cada pareja de mazos se juega dos veces cambiando SOLO quién ataca primero (mismas semillas). */
function suiteSide() {
  const r = { s: suiteRng("side") };
  const t: Tally = {};
  let diffSum = 0, diffSq = 0, pairs = 0;
  const n = N(50_000);
  for (let i = 0; i < n; i++) {
    const a = snap(genRandom(r)), b = snap(genRandom(r));
    const seed = seedOf("side", i);
    const m1 = play(a, b, "HARD", "HARD", "A", seed), m2 = play(a, b, "HARD", "HARD", "B", seed);
    record(t, m1); record(t, m2);
    const d = scoreA(m1) - scoreA(m2); diffSum += d; diffSq += d * d; pairs++;
  }
  results.side = { ...summaryOf(t), pairedFirstAttackerEffect: { pairs, ...mapRound(meanCi(pairs, diffSum, diffSq)) } };
  log(`side: efecto emparejado de atacar primero = ${results.side.pairedFirstAttackerEffect.mean} [${results.side.pairedFirstAttackerEffect.lo}, ${results.side.pairedFirstAttackerEffect.hi}]`);
}
const mapRound = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, 5)]));

/** 3 · CAMPO: mazos aleatorios válidos, HARD contra HARD. Métricas por carta observadas (no causales). */
const cardObs: Record<string, { n: number; w: number; atkN: number; atkW: number; defN: number; defW: number }> = {};
for (const c of pool) cardObs[c.cardId] = { n: 0, w: 0, atkN: 0, atkW: 0, defN: 0, defW: 0 };
function observeCards(m: LabMatch, a: DuelDeckSnapshot, b: DuelDeckSnapshot) {
  const uidCard = new Map<string, string>();
  for (const c of a.cards) uidCard.set(c.uid, c.cardId);
  for (const c of b.cards) uidCard.set(c.uid, c.cardId);
  const sA = scoreA(m);
  for (const c of a.cards) { cardObs[c.cardId].n++; cardObs[c.cardId].w += sA; }
  for (const c of b.cards) { cardObs[c.cardId].n++; cardObs[c.cardId].w += 1 - sA; }
  for (const e of m.encounters) {
    const atk = uidCard.get(e.attacker === "A" ? e.aUid : e.bUid)!, def = uidCard.get(e.attacker === "A" ? e.bUid : e.aUid)!;
    cardObs[atk].atkN++; cardObs[def].defN++;
    if (e.outcome === e.attacker) cardObs[atk].atkW++; else if (e.outcome !== "TIE") cardObs[def].defW++;
    else { cardObs[atk].atkW += 0.5; cardObs[def].defW += 0.5; }
  }
}
function suiteField() {
  const r = { s: suiteRng("field") };
  const t: Tally = {};
  const tNormal: Tally = {};
  const n = N(300_000);
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < n; i++) {
    const ia = genRandom(r), ib = genRandom(r);
    const a = snap(ia), b = snap(ib);
    const m = play(a, b, "HARD", "HARD", i % 2 ? "A" : "B", seedOf("field", i));
    record(t, m); observeCards(m, a, b);
    if (i < 20_000 * SCALE + 1) { xs.push(m.sumOvrA - m.sumOvrB); ys.push(m.combatSumA - m.combatSumB); zs.push(scoreA(m)); }
  }
  const nn = N(60_000);
  for (let i = 0; i < nn; i++) {
    const a = snap(genRandom(r)), b = snap(genRandom(r));
    record(tNormal, play(a, b, "NORMAL", "NORMAL", i % 2 ? "A" : "B", seedOf("field-normal", i)));
  }
  results.field = { HARD: summaryOf(t), NORMAL: summaryOf(tNormal), corr: { ovrDiff_vs_result: round(pearson(xs, zs)), combatDiff_vs_result: round(pearson(ys, zs)), ovrDiff_vs_combatDiff: round(pearson(xs, ys)), sample: xs.length } };
  log(`field: n=${n}+${nn}, corr(OVR, resultado)=${results.field.corr.ovrDiff_vs_result}, corr(combate, resultado)=${results.field.corr.combatDiff_vs_result}`);
}

/**
 * 4 · SUSTITUCIÓN EMPAREJADA por carta: el MISMO mazo con la carta X frente a con una carta cualquiera de su rol, contra el
 * MISMO rival, con la MISMA semilla y el mismo primer atacante. Diferencia de resultado = impacto causal de X.
 */
const paired: Record<string, { n: number; sum: number; sq: number }> = {};
function substitute(r: { s: RngState }, x: string): { withX: string[]; without: string[] } {
  const cx = card.get(x)!;
  for (let tries = 0; tries < 50; tries++) {
    const ids = genRandom(r);
    const slots = ids.map((id, i) => ({ id, i })).filter((s) => card.get(s.id)!.role === cx.role);
    const slot = slots[rngInt(r, 0, slots.length - 1)];
    if (slot.id === x) continue;
    const others = ids.filter((_, i) => i !== slot.i);
    if (others.some((id) => card.get(id)!.playerId === cx.playerId)) continue;
    const withX = [...ids]; withX[slot.i] = x;
    return { withX, without: ids };
  }
  throw new Error(`sin sustitución para ${x}`);
}
function suitePaired() {
  const r = { s: suiteRng("paired") };
  const k = N(320);
  let i = 0;
  for (const c of pool) {
    const acc = (paired[c.cardId] = { n: 0, sum: 0, sq: 0 });
    for (let j = 0; j < k; j++, i++) {
      const { withX, without } = substitute(r, c.cardId);
      const opp = snap(genRandom(r));
      const first = rngInt(r, 0, 1) ? "A" : "B";
      const seed = seedOf("paired", i);
      const d = scoreA(play(snap(withX), opp, "HARD", "HARD", first, seed)) - scoreA(play(snap(without), opp, "HARD", "HARD", first, seed));
      acc.n++; acc.sum += d; acc.sq += d * d;
    }
  }
  log(`paired: ${pool.length} cartas × ${k} parejas`);
}

/** 5 · EDICIÓN: mismo jugador, otra edición (combate idéntico, OVR impreso distinto). Solo el desempate por OVR puede cambiar algo. */
function suiteEdition() {
  const r = { s: suiteRng("edition") };
  const byPlayer = new Map<string, typeof pool[number][]>();
  for (const c of pool) byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c]);
  const multi = [...byPlayer.values()].filter((cs) => cs.length > 1 && new Set(cs.map((c) => c.ovr)).size > 1);
  let sum = 0, sq = 0, n = 0, changed = 0, combatIdentical = 0, sameRole = 0;
  const k = N(400);
  const perPlayer: any[] = [];
  multi.forEach((cs, pi) => {
    const lo = cs.reduce((a, b) => (b.ovr < a.ovr ? b : a)), hi = cs.reduce((a, b) => (b.ovr > a.ovr ? b : a));
    if (lo.combat.stronghold === hi.combat.stronghold && lo.combat.gamesense === hi.combat.gamesense && lo.combat.entryfrag === hi.combat.entryfrag) combatIdentical++;
    if (lo.role !== hi.role) return; // rol distinto = otra carta de juego; no es la prueba de edición pura
    sameRole++;
    let ps = 0, pn = 0, pc = 0;
    for (let j = 0; j < k; j++) {
      const { withX } = substitute(r, hi.cardId);
      const withLo = withX.map((id) => (id === hi.cardId ? lo.cardId : id));
      const opp = snap(genRandom(r)); const first = rngInt(r, 0, 1) ? "A" : "B"; const seed = seedOf(`edition:${pi}`, j);
      const d = scoreA(play(snap(withX), opp, "HARD", "HARD", first, seed)) - scoreA(play(snap(withLo), opp, "HARD", "HARD", first, seed));
      sum += d; sq += d * d; n++; ps += d; pn++; if (d !== 0) { changed++; pc++; }
    }
    perPlayer.push({ player: hi.playerId, hi: hi.cardId, hiOvr: hi.ovr, lo: lo.cardId, loOvr: lo.ovr, gap: hi.ovr - lo.ovr, pairs: pn, meanDelta: round(ps / pn), changedRate: round(pc / pn) });
  });
  results.edition = {
    playersWithOvrSpreadAcrossEditions: multi.length, sameRoleTested: sameRole, combatIdenticalAcrossEditions: combatIdentical,
    effectOfHigherOvrEdition: { pairs: n, ...mapRound(meanCi(n, sum, sq)) }, outcomeChangedRate: round(changed / (n || 1)),
    note: "El combate es idéntico entre ediciones; la única vía de efecto es el desempate por suma de OVR impreso.",
    perPlayer: perPlayer.sort((a, b) => b.gap - a.gap),
  };
  log(`edition: +OVR de edición = ${results.edition.effectOfHigherOvrEdition.mean} (cambia el resultado en ${results.edition.outcomeChangedRate})`);
}

/** 6 · ESTRATEGIAS de construcción: matriz de enfrentamientos y contra el campo. */
const strategyDecks: Record<string, string[][]> = {};
function suiteStrategies() {
  const r = { s: suiteRng("strategies") };
  const names = [...Object.keys(STRATEGIES), "RANDOM"];
  for (const s of names) {
    strategyDecks[s] = [];
    for (let v = 0; v < 12; v++) {
      if (s === "RANDOM") { strategyDecks[s].push(genRandom(r)); continue; }
      const d = scoredDeck(pool, STRATEGIES[s], v === 0 ? {} : { rng: r.s, noise: s.startsWith("SPEC") || s === "BALANCED" || s === "PEAK_MAX" ? 6 : 4 });
      if (d.rng) r.s = d.rng;
      strategyDecks[s].push(d.cardIds);
    }
  }
  const cell = N(1_500);
  const matrix: any[] = [];
  let i = 0;
  for (const sa of names) for (const sb of names) {
    let w = 0;
    for (let j = 0; j < cell; j++, i++) {
      const a = snap(strategyDecks[sa][j % 12]), b = snap(strategyDecks[sb][(j * 5 + 1) % 12]);
      w += scoreA(play(a, b, "HARD", "HARD", j % 2 ? "A" : "B", seedOf("strat", i)));
    }
    matrix.push({ a: sa, b: sb, ...wr(w, cell) });
  }
  const vsField: any[] = [];
  const nf = N(10_000);
  for (const s of names) {
    let w = 0;
    for (let j = 0; j < nf; j++, i++) w += scoreA(play(snap(strategyDecks[s][j % 12]), snap(genRandom(r)), "HARD", "HARD", j % 2 ? "A" : "B", seedOf("strat-field", i)));
    const base = strategyDecks[s][0];
    vsField.push({ strategy: s, ...wr(w, nf), sumOvr: sumOvr(base), combatSum: sumCombat(base), meanPeak: round(base.reduce((x, id) => x + peakStat(card.get(id)!), 0) / 10, 1), deck: base });
  }
  results.strategies = { cellMatches: cell, matrix, vsField: vsField.sort((a, b) => b.rate - a.rate) };
  log(`strategies: mejor contra el campo = ${results.strategies.vsField[0].strategy} ${results.strategies.vsField[0].rate}`);
}

/** 7 · BÚSQUEDA DE MAZO DOMINANTE (ascenso de colina con números aleatorios comunes) y de su contrajuego. */
function gauntlet(r: { s: RngState }, size: number): DuelDeckSnapshot[] {
  const g: DuelDeckSnapshot[] = [];
  for (let i = 0; i < size; i++) g.push(snap(i % 4 === 3 && strategyDecks.PEAK_MAX ? strategyDecks[Object.keys(strategyDecks)[i % Object.keys(strategyDecks).length]][i % 12] : genRandom(r), "g"));
  return g;
}
function evalDeck(ids: string[], opps: DuelDeckSnapshot[], tag: string): number {
  const me = snap(ids, "hc");
  let w = 0;
  opps.forEach((o, j) => { w += scoreA(play(me, o, "HARD", "HARD", "A", seedOf(tag, j))); w += scoreA(play(me, o, "HARD", "HARD", "B", seedOf(tag, j))); });
  return w / (opps.length * 2);
}
function mutate(r: { s: RngState }, ids: string[]): string[] {
  for (let tries = 0; tries < 50; tries++) {
    const i = rngInt(r, 0, 9);
    const role = card.get(ids[i])!.role;
    const used = new Set(ids.filter((_, k) => k !== i).map((id) => card.get(id)!.playerId));
    const opts = roles[role].filter((c) => !used.has(c.playerId) && c.cardId !== ids[i]);
    if (!opts.length) continue;
    const next = [...ids]; next[i] = opts[rngInt(r, 0, opts.length - 1)].cardId;
    return next;
  }
  return ids;
}
function climb(r: { s: RngState }, start: string[], opps: DuelDeckSnapshot[], steps: number, tag: string) {
  let cur = start, curV = evalDeck(cur, opps, tag);
  for (let s = 0; s < steps; s++) {
    const cand = mutate(r, cur), v = evalDeck(cand, opps, tag);
    if (v >= curV) { cur = cand; curV = v; }
  }
  return { deck: cur, trainScore: curV };
}
function suiteHillclimb() {
  const r = { s: suiteRng("hillclimb") };
  const opps = gauntlet(r, N(60) < 10 ? 10 : N(60));
  const climbs = Math.max(2, N(10)), steps = Math.max(5, N(40));
  const found: any[] = [];
  for (let c = 0; c < climbs; c++) {
    const res = climb(r, c % 2 ? genRandom(r) : strategyDecks.OVR_MAX?.[c % 12] ?? genRandom(r), opps, steps, `hc:${c}`);
    // Validación fuera de muestra: campo nuevo.
    const fresh = gauntlet(r, N(150) < 10 ? 10 : N(150));
    const test = evalDeck(res.deck, fresh, `hc-test:${c}`);
    found.push({ climb: c, trainWin: round(res.trainScore), testWin: round(test), testMatches: fresh.length * 2, sumOvr: sumOvr(res.deck), combatSum: sumCombat(res.deck), deck: res.deck });
  }
  found.sort((a, b) => b.testWin - a.testWin);
  const freq: Record<string, number> = {};
  for (const f of found) for (const id of f.deck) freq[id] = (freq[id] ?? 0) + 1;
  const core = Object.entries(freq).filter(([, k]) => k >= Math.ceil(found.length / 2)).map(([id, k]) => ({ cardId: id, inDecks: k, ovr: card.get(id)!.ovr, combat: card.get(id)!.combat, role: card.get(id)!.role }));
  // Contrajuego: escalar un mazo SOLO contra el mejor encontrado.
  const best = found[0];
  const target = [snap(best.deck, "target")];
  const counterOpps = Array.from({ length: 30 }, () => target[0]);
  const counter = climb(r, genRandom(r), counterOpps, Math.max(5, N(60)), "counter");
  const counterCheck = evalDeck(counter.deck, Array.from({ length: Math.max(10, N(200)) }, () => target[0]), "counter-test");
  results.hillclimb = {
    climbs, steps, gauntletSize: opps.length, decks: found, distinctCardsAcrossClimbs: Object.keys(freq).length, core,
    counter: { deck: counter.deck, winVsBest: round(counterCheck), sumOvr: sumOvr(counter.deck), combatSum: sumCombat(counter.deck) },
  };
  log(`hillclimb: mejor fuera de muestra ${best.testWin}, contrajuego gana ${results.hillclimb.counter.winVsBest}, núcleo ${core.length} cartas`);
}

/** 8 · BOTS: escalera de políticas con mazos neutros (aleatorios), y la ventaja de ver el mazo rival. */
function suiteBots() {
  const r = { s: suiteRng("bots") };
  const cell = N(3_000);
  const matrix: any[] = [];
  let i = 0;
  for (const pa of POLICIES) for (const pb of POLICIES) {
    let w = 0;
    for (let j = 0; j < cell; j++, i++) {
      const ids = genRandom(r), jds = genRandom(r);
      // Mazos intercambiados en la mitad de las partidas: la política es lo único que no cambia de lado.
      const [x, y] = j % 2 ? [ids, jds] : [jds, ids];
      w += scoreA(play(snap(x), snap(y), pa, pb, (j >> 1) % 2 ? "A" : "B", seedOf("bots", i)));
    }
    matrix.push({ a: pa, b: pb, ...wr(w, cell) });
  }
  const vsAll = POLICIES.map((p) => { const rows = matrix.filter((m) => m.a === p && m.b !== p); return { policy: p, meanWinVsOthers: round(rows.reduce((s, m) => s + m.rate, 0) / rows.length) }; });
  results.bots = { cellMatches: cell, matrix, ladder: vsAll };
  log(`bots: ${vsAll.map((v) => `${v.policy} ${v.meanWinVsOthers}`).join(" · ")}`);
}

/** 9 · PvE REAL: mazo del jugador contra el rival que construye el servidor (`buildOpponentDeck`) por dificultad. */
function suitePve() {
  const r = { s: suiteRng("pve") };
  const n = N(8_000);
  const rows: any[] = [];
  let i = 0;
  const kinds: Record<string, () => string[]> = {
    RANDOM: () => genRandom(r),
    OVR_MAX: () => strategyDecks.OVR_MAX?.[rngInt(r, 0, 11)] ?? scoredDeck(pool, STRATEGIES.OVR_MAX).cardIds,
  };
  for (const [kind, gen] of Object.entries(kinds)) for (const player of ["NORMAL", "HARD", "RANDOM"] as Policy[]) for (const bot of ["EASY", "NORMAL", "HARD"] as Policy[]) {
    const t: Tally = {};
    let ovrGap = 0;
    for (let j = 0; j < n; j++, i++) {
      const ids = gen();
      const opp = pveOpponentDeck(sumOvr(ids), pool);
      ovrGap += sumOvr(opp) - sumOvr(ids);
      record(t, play(snap(ids, "p"), snap(opp, "bot"), player, bot, rngInt(r, 0, 1) ? "A" : "B", seedOf("pve", i)));
    }
    const s = summaryOf(t);
    rows.push({ deck: kind, playerPolicy: player, botDifficulty: bot, playerWin: s.sideA, drawRate: s.drawRate, meanBotOvrMinusPlayer: round(ovrGap / n, 2), decidedBy: s.decidedBy });
  }
  results.pve = rows;
  log(`pve: jugador HARD con mazo aleatorio vs bot HARD = ${rows.find((x) => x.deck === "RANDOM" && x.playerPolicy === "HARD" && x.botDifficulty === "HARD")?.playerWin.rate}`);
}

/** 10 · STARTER: el equipo que sale de la bienvenida real (sobres + autocompletar) frente a PvE, campo y meta. */
function suiteStarter() {
  const r = { s: suiteRng("starter") };
  const dist = dbDistribution();
  const decks: string[][] = [];
  const nDecks = Math.max(10, N(300));
  let notReady = 0;
  for (let k = 0; k < nDecks; k++) {
    const run = simulateStarter(SEED + k * 7919, "guide", dist);
    if (run.deckCardIds.length === 10 && isLegalDeck(run.deckCardIds).valid) decks.push(run.deckCardIds); else notReady++;
  }
  const meta = strategyDecks.OVR_MAX ?? [scoredDeck(pool, STRATEGIES.OVR_MAX).cardIds];
  const peak = strategyDecks.PEAK_MAX ?? [scoredDeck(pool, STRATEGIES.PEAK_MAX).cardIds];
  const per = Math.max(4, N(40));
  const vs: Record<string, { w: number; n: number }> = {};
  let i = 0;
  const opp: Record<string, (ids: string[]) => [string[], Policy]> = {
    "PvE EASY": (ids) => [pveOpponentDeck(sumOvr(ids), pool), "EASY"],
    "PvE NORMAL": (ids) => [pveOpponentDeck(sumOvr(ids), pool), "NORMAL"],
    "PvE HARD": (ids) => [pveOpponentDeck(sumOvr(ids), pool), "HARD"],
    "campo (aleatorio, HARD)": () => [genRandom(r), "HARD"],
    "meta OVR_MAX (HARD)": () => [meta[rngInt(r, 0, meta.length - 1)], "HARD"],
    "meta PEAK_MAX (HARD)": () => [peak[rngInt(r, 0, peak.length - 1)], "HARD"],
  };
  for (const ids of decks) for (const [name, f] of Object.entries(opp)) for (let j = 0; j < per; j++, i++) {
    const [o, pol] = f(ids);
    const acc = (vs[name] ??= { w: 0, n: 0 });
    acc.w += scoreA(play(snap(ids, "st"), snap(o, "o"), "NORMAL", pol, j % 2 ? "A" : "B", seedOf("starter", i))); acc.n++;
  }
  const so = decks.map(sumOvr), sc = decks.map(sumCombat);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  results.starter = {
    starterDecks: decks.length, notReady, playerPolicy: "NORMAL (jugador casual)", matchesPerOpponent: per * decks.length,
    starterSumOvr: { mean: round(avg(so), 1), p10: q(so, 0.1), p50: q(so, 0.5), p90: q(so, 0.9) },
    starterCombatSum: { mean: round(avg(sc), 1), p10: q(sc, 0.1), p50: q(sc, 0.5), p90: q(sc, 0.9) },
    metaSumOvr: sumOvr(meta[0]), metaCombatSum: sumCombat(meta[0]), fieldSumOvrMean: null,
    winRate: Object.fromEntries(Object.entries(vs).map(([k, v]) => [k, wr(v.w, v.n)])),
  };
  log(`starter: ${decks.length} equipos, OVR medio ${results.starter.starterSumOvr.mean} vs meta ${results.starter.metaSumOvr}`);
}

/** 11 · AUTOCOMPLETAR: con la MISMA colección, el equipo de `autocomplete` (máx. OVR) frente a elecciones por combate. */
function suiteAutodeck() {
  const r = { s: suiteRng("autodeck") };
  const sizes = [30, 60, 120];
  const per = Math.max(10, N(250));
  const rows: any[] = [];
  const decksSeen = new Set<string>();
  const usage: Record<string, number> = {};
  let i = 0;
  for (const size of sizes) {
    const acc: Record<string, { w: number; n: number }> = {};
    let ok = 0;
    for (let k = 0; k < per; k++) {
      // Colección aleatoria de `size` cartas que garantiza al menos un equipo legal.
      const coll = new Set<string>(genRandom(r));
      while (coll.size < size) coll.add(pool[rngInt(r, 0, pool.length - 1)].cardId);
      const sub = pool.filter((c) => coll.has(c.cardId));
      const auto = scoredDeck(sub, STRATEGIES.OVR_MAX).cardIds; // == autocomplete (test de equivalencia)
      const peak = scoredDeck(sub, STRATEGIES.PEAK_MAX).cardIds;
      const comb = scoredDeck(sub, STRATEGIES.COMBAT_MAX).cardIds;
      if (auto.length !== 10) continue;
      ok++;
      decksSeen.add([...auto].sort().join(",")); for (const id of auto) usage[id] = (usage[id] ?? 0) + 1;
      for (const [name, other] of [["PEAK_MAX de la misma colección", peak], ["COMBAT_MAX de la misma colección", comb]] as const) {
        const a = acc[name] ??= { w: 0, n: 0 };
        for (let j = 0; j < 8; j++, i++) { a.w += scoreA(play(snap(auto, "auto"), snap(other as string[], "alt"), "HARD", "HARD", j % 2 ? "A" : "B", seedOf("auto", i))); a.n++; }
      }
    }
    rows.push({ collectionSize: size, collections: ok, autoWinRate: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, wr(v.w, v.n)])) });
  }
  const top = Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, k]) => ({ cardId: id, uses: k, ovr: card.get(id)!.ovr }));
  results.autodeck = { rule: "autocomplete = máximo OVR total legal (builder.ts §autocomplete)", rows, distinctAutoDecks: decksSeen.size, mostUsed: top };
  log(`autodeck: ${rows.map((x) => `${x.collectionSize}: ${Object.values(x.autoWinRate).map((w: any) => w.rate).join("/")}`).join(" · ")}`);
}

/** 12 · RNG: uniformidad y correlación de semillas consecutivas del generador del motor. */
function suiteRngAudit() {
  const draws = N(1_000_000);
  let s = createRng(SEED);
  const bins = new Array(10).fill(0);
  for (let i = 0; i < draws; i++) { const x = nextInt(s, 0, 9); s = x.rng; bins[x.value]++; }
  const e = draws / 10; const chi2 = bins.reduce((a, o) => a + (o - e) ** 2 / e, 0);
  const firsts: number[] = [], seconds: number[] = [];
  for (let k = 1; k <= 20_000; k++) { firsts.push(nextFloat(createRng(k)).value); seconds.push(nextFloat(createRng(k + 1)).value); }
  // Primer atacante del bot en una partida aleatoria: ¿la semilla sesga quién abre? (el servidor usa crypto.randomInt).
  results.rng = {
    generator: "mulberry32 (opponent/rng.ts)", draws, bins, chi2_df9: round(chi2, 3), chi2_p05_critical: 16.919, uniformOk: chi2 < 21.666,
    consecutiveSeedCorrelation: round(pearson(firsts, seconds), 5),
    serverSeeds: "crypto.randomInt (duels.ts launchPve: seedA, seedB, firstAttacker)",
  };
  log(`rng: χ²=${results.rng.chi2_df9}, corr semillas consecutivas=${results.rng.consecutiveSeedCorrelation}`);
}

/** 13 · INTEGRIDAD: ataques de mazo inválido contra el validador y el motor. */
function suiteIntegrity() {
  const r = { s: suiteRng("integrity") };
  const base = genRandom(r);
  const other = (role: RoleId, not: Set<string>) => roles[role].find((c) => !not.has(c.playerId))!.cardId;
  const players = new Set(base.map((id) => card.get(id)!.playerId));
  const sameRoleTwin = pool.find((c) => base.some((id) => card.get(id)!.playerId === c.playerId && c.cardId !== id && c.role === card.get(id)!.role));
  const attacks: Record<string, string[]> = {
    "9 cartas": base.slice(0, 9),
    "11 cartas": [...base, other("Flex", players)],
    "carta repetida": [...base.slice(0, 9), base[0]],
    "3 de un rol": (() => { const d = [...base]; const i = d.findIndex((id) => card.get(id)!.role !== "Duelista"); d[i] = other("Duelista", players); return d; })(),
    "carta inexistente": [...base.slice(0, 9), "no-existe"],
  };
  if (sameRoleTwin) {
    const i = base.findIndex((id) => card.get(id)!.playerId === sameRoleTwin.playerId);
    const d = [...base]; const j = d.findIndex((id, k) => k !== i && card.get(id)!.role === sameRoleTwin.role);
    d[j] = sameRoleTwin.cardId; attacks["mismo jugador dos veces (otra edición)"] = d;
  }
  const verdict = Object.fromEntries(Object.entries(attacks).map(([k, ids]) => [k, isLegalDeck(ids)]));
  results.integrity = { baseLegal: isLegalDeck(base).valid, attacks: verdict, allRejected: Object.values(verdict).every((v) => !v.valid) };
  log(`integrity: ${Object.keys(verdict).length} ataques de mazo, todos rechazados = ${results.integrity.allRejected}`);
}

/* ───────────────────────── ejecución ───────────────────────── */

const run: Record<string, () => void> = {
  mirror: suiteMirror, side: suiteSide, field: suiteField, paired: suitePaired, edition: suiteEdition, strategies: suiteStrategies,
  hillclimb: suiteHillclimb, bots: suiteBots, pve: suitePve, starter: suiteStarter, autodeck: suiteAutodeck, rng: suiteRngAudit, integrity: suiteIntegrity,
};
const timing: Record<string, { seconds: number; matches: number }> = {};
for (const s of SUITES) {
  if (!run[s]) throw new Error(`suite desconocida: ${s}`);
  const before = matchesPlayed, ts = Date.now();
  run[s]();
  timing[s] = { seconds: round((Date.now() - ts) / 1000, 1)!, matches: matchesPlayed - before };
}

/* ───────────────────────── salidas ───────────────────────── */

const gitHead = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return null; } })();
const catalogHash = hashStr(pool.map((c) => `${c.cardId}:${c.role}:${c.ovr}:${c.combat.stronghold}-${c.combat.gamesense}-${c.combat.entryfrag}`).join("|")).toString(16);
const config = {
  lab: LAB_VERSION, seed: SEED, scale: SCALE, suites: SUITES, gitHead, node: process.version,
  engine: { orchestrator: ORCHESTRATOR_VERSION, resolver: RESOLVER_VERSION, rules: CURRENT_COMBAT_RULES },
  catalog: { cards: pool.length, hash: catalogHash }, policies: POLICIES, strategies: Object.keys(STRATEGIES),
  determinism: "Semillas por suite = SEED ^ fnv1a(suite); semilla de partida = fnv1a(`${SEED}:${suite}:${i}`). Mismo SEED + mismo catálogo ⇒ mismos números.",
  dbWrites: 0, network: 0,
};
write("simulation-config.json", config);

// Métricas por carta: 331 filas exactas.
if (results.field || Object.keys(paired).length) {
  const rows = pool.map((c) => {
    const o = cardObs[c.cardId], p = paired[c.cardId];
    const ci = p ? meanCi(p.n, p.sum, p.sq) : null;
    return { c, o, p, ci };
  });
  const sh = shrink(rows.map((x) => ({ mean: x.ci?.mean ?? NaN, se: x.ci?.se ?? NaN })));
  const ranked = rows.map((x, i) => ({ ...x, shrunk: sh.shrunk[i] }));
  const byImpact = [...ranked].filter((x) => Number.isFinite(x.shrunk)).sort((a, b) => b.shrunk - a.shrunk);
  const impactRank = new Map(byImpact.map((x, i) => [x.c.cardId, i + 1]));
  const byOvr = [...ranked].sort((a, b) => b.c.ovr - a.c.ovr);
  const ovrRank = new Map(byOvr.map((x, i) => [x.c.cardId, i + 1]));
  const head = ["cardId", "playerId", "player", "role", "variant", "ovr", "stronghold", "gamesense", "entryfrag", "combatSum", "peak", "fieldMatches", "fieldWinRate", "fieldLo", "fieldHi", "attackEncounters", "attackWinRate", "defenseEncounters", "defenseWinRate", "pairedPairs", "impact", "impactLo", "impactHi", "impactShrunk", "impactRank", "ovrRank", "flag"];
  const csv = [head.join(",")];
  const flagged: any[] = [];
  for (const x of ranked) {
    const f = x.o.n ? wilson(x.o.w, x.o.n) : null;
    const sig = x.ci && (x.ci.lo > 0 || x.ci.hi < 0);
    // Atípica = más de 2 desviaciones típicas REALES entre cartas (√τ² de la contracción) y con IC que excluye 0.
    // Mal etiquetada por OVR = su puesto por impacto y su puesto por OVR distan más de 100 (de 331).
    const tau = Math.sqrt(sh.tau2);
    const gapRank = (impactRank.get(x.c.cardId) ?? 0) - (ovrRank.get(x.c.cardId) ?? 0);
    const flag = !x.ci ? "" : sig && x.shrunk > 2 * tau ? "OUTLIER_HIGH" : sig && x.shrunk < -2 * tau ? "OUTLIER_LOW"
      : gapRank < -100 ? "OVR_UNDERSTATES" : gapRank > 100 ? "OVR_OVERSTATES" : "";
    if (flag) flagged.push({ cardId: x.c.cardId, flag, impactShrunk: round(x.shrunk), impactLo: round(x.ci!.lo), impactHi: round(x.ci!.hi), impactRank: impactRank.get(x.c.cardId), ovrRank: ovrRank.get(x.c.cardId), ovr: x.c.ovr, combat: x.c.combat, role: x.c.role });
    csv.push([x.c.cardId, x.c.playerId, JSON.stringify(x.c.playerName), x.c.role, x.c.variantId, x.c.ovr, x.c.combat.stronghold, x.c.combat.gamesense, x.c.combat.entryfrag, combatSum(x.c), peakStat(x.c),
      x.o.n, round(f?.p ?? NaN), round(f?.lo ?? NaN), round(f?.hi ?? NaN), x.o.atkN, round(x.o.atkW / (x.o.atkN || NaN)), x.o.defN, round(x.o.defW / (x.o.defN || NaN)),
      x.p?.n ?? 0, round(x.ci?.mean ?? NaN), round(x.ci?.lo ?? NaN), round(x.ci?.hi ?? NaN), round(x.shrunk), impactRank.get(x.c.cardId) ?? "", ovrRank.get(x.c.cardId), flag].map((v) => (v === null ? "" : v)).join(","));
  }
  write("card-metrics.csv", csv.join("\n") + "\n");
  const imp = ranked.filter((x) => Number.isFinite(x.shrunk));
  results.cards = {
    rows: ranked.length, shrinkage: { tau2: round(sh.tau2, 6), grand: round(sh.grand, 5) },
    corr: {
      ovr_vs_impact: round(pearson(imp.map((x) => x.c.ovr), imp.map((x) => x.shrunk))),
      combatSum_vs_impact: round(pearson(imp.map((x) => combatSum(x.c)), imp.map((x) => x.shrunk))),
      peak_vs_impact: round(pearson(imp.map((x) => peakStat(x.c)), imp.map((x) => x.shrunk))),
      ovr_vs_fieldWin: round(pearson(ranked.filter((x) => x.o.n).map((x) => x.c.ovr), ranked.filter((x) => x.o.n).map((x) => x.o.w / x.o.n))),
      ovr_vs_combatSum: round(pearson(pool.map((c) => c.ovr), pool.map(combatSum))),
    },
    top: byImpact.slice(0, 15).map((x) => ({ cardId: x.c.cardId, role: x.c.role, ovr: x.c.ovr, combat: x.c.combat, impact: round(x.shrunk), ovrRank: ovrRank.get(x.c.cardId) })),
    bottom: byImpact.slice(-15).reverse().map((x) => ({ cardId: x.c.cardId, role: x.c.role, ovr: x.c.ovr, combat: x.c.combat, impact: round(x.shrunk), ovrRank: ovrRank.get(x.c.cardId) })),
    flagged,
    rankMismatch: byImpact.filter((x) => Math.abs((impactRank.get(x.c.cardId) ?? 0) - (ovrRank.get(x.c.cardId) ?? 0)) > 150).length,
  };
  // Por rol.
  const rr = ["role,cards,players,meanOvr,meanStronghold,meanGamesense,meanEntryfrag,meanCombatSum,meanPeak,top10pctCombat,meanImpact,impactSd,attackWinRate,defenseWinRate"];
  const combatCut = [...pool].map(combatSum).sort((a, b) => b - a)[Math.floor(pool.length * 0.1)];
  const roleRows: any[] = [];
  for (const role of DUEL_ROLES) {
    const cs = ranked.filter((x) => x.c.role === role);
    const mean = (f: (x: typeof cs[number]) => number) => cs.reduce((s, x) => s + f(x), 0) / cs.length;
    const mi = mean((x) => x.shrunk || 0);
    const sd = Math.sqrt(cs.reduce((s, x) => s + ((x.shrunk || 0) - mi) ** 2, 0) / Math.max(1, cs.length - 1));
    const atk = cs.reduce((s, x) => s + x.o.atkW, 0) / Math.max(1, cs.reduce((s, x) => s + x.o.atkN, 0));
    const def = cs.reduce((s, x) => s + x.o.defW, 0) / Math.max(1, cs.reduce((s, x) => s + x.o.defN, 0));
    const row = { role, cards: cs.length, players: new Set(cs.map((x) => x.c.playerId)).size, meanOvr: round(mean((x) => x.c.ovr), 2), meanStronghold: round(mean((x) => x.c.combat.stronghold), 2), meanGamesense: round(mean((x) => x.c.combat.gamesense), 2), meanEntryfrag: round(mean((x) => x.c.combat.entryfrag), 2), meanCombatSum: round(mean((x) => combatSum(x.c)), 2), meanPeak: round(mean((x) => peakStat(x.c)), 2), top10pctCombat: cs.filter((x) => combatSum(x.c) >= combatCut).length, meanImpact: round(mi), impactSd: round(sd), attackWinRate: round(atk), defenseWinRate: round(def) };
    roleRows.push(row); rr.push(Object.values(row).join(","));
  }
  write("role-metrics.csv", rr.join("\n") + "\n");
  results.roles = roleRows;
}

if (results.strategies) {
  const m = ["a,b,matches,winRateA,lo,hi", ...results.strategies.matrix.map((x: any) => [x.a, x.b, x.n, x.rate, x.lo, x.hi].join(","))];
  write("matchups.csv", m.join("\n") + "\n");
}

const report = { config, timing, matches: matchesPlayed, seconds: round((Date.now() - t0) / 1000, 1), results };
write("simulation-report.json", report);
writeReports(OUT);
log(`FIN · ${matchesPlayed.toLocaleString("es-ES")} partidas en ${report.seconds}s → ${OUT}`);
