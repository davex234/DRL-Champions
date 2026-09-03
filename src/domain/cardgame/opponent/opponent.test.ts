/**
 * Tests del Duel Opponent Engine (node:test). Ejecutar: `npm test`.
 *
 * Usan mazos REALES de la Fase 3, el orquestador de la Fase 5 y el resolver de la Fase 4.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import { COMBAT_MATCHUP, type CombatStatKey } from "@/domain/cards/combat";
import { makeRng } from "@/sim/rng";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList,
  DUEL_ROLES, type DuelDeckSnapshot,
} from "../index";
import { resolveCombat } from "../combat";
import {
  startDuelMatch, selectAttackerCard, selectAttackerStat, selectDefenderCard, selectDefenderStat,
  confirmTurn, buildCombatPlan, availableCards, requiredDefenderStat,
  type DuelMatch, type Side,
} from "../match";
import {
  createRng, normalizeSeed, isRngState, nextFloat, nextInt, pick,
  createRandomBot, createSmartBot, createController, advanceBots, advanceBotDecision,
  actingSide, isBotTurn, OPPONENT_ENGINE_VERSION,
  type DuelParticipant, type RngState,
} from "./index";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

function realSnapshot(block: number, id: string): DuelDeckSnapshot {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) {
    const b = best.get(c.playerId);
    if (!b || c.ovr > b.ovr) best.set(c.playerId, c);
  }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) {
    const p = registry.player(c.playerId);
    if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]);
  }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name: `Mazo ${block + 1}`, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  assert.equal(v.valid, true);
  return takeDeckSnapshot(deck, v, NOW)!;
}

const A = realSnapshot(0, "deck-a");
const B = realSnapshot(1, "deck-b");
const C = realSnapshot(2, "deck-c");

const HUMAN = (side: Side): DuelParticipant => ({ side, kind: "HUMAN", id: `human-${side}` });
const BOT = (side: Side): DuelParticipant => ({ side, kind: "BOT", id: `bot-${side}` });

function startMatch(a = A, b = B, first: Side = "A"): DuelMatch {
  const r = startDuelMatch({ id: "m", snapshotA: a, snapshotB: b, firstAttacker: first });
  assert.ok(r.ok);
  return r.match;
}

/** Partida Bot vs Bot completa. */
function botVsBot(seedA: number, seedB: number, a = A, b = B, smart = false) {
  const ctrl = createController(BOT("A"), BOT("B"));
  const bots = {
    A: smart ? createSmartBot("sa", "HARD") : createRandomBot("ra"),
    B: smart ? createSmartBot("sb", "NORMAL") : createRandomBot("rb"),
  };
  return advanceBots(startMatch(a, b), ctrl, bots, createRng(seedA), createRng(seedB));
}

// ───────────────────────────── RNG ─────────────────────────────

test("1-3 · el bot recibe semilla y la misma semilla da la misma secuencia", () => {
  const bot = createRandomBot("b1");
  assert.equal(bot.kind, "BOT");
  // Fase 7: el motor pasa a `duel-opponent-2`. La escalera de dificultad dejó de ser «una
  // estrategia por nivel» y pasó a ser una tasa de heurística medida (OPD-42), y la visibilidad
  // del mazo rival la declara el bot en vez de deducirse de su dificultad (OPD-04). Cambia el
  // comportamiento de NORMAL y HARD, así que cambia la versión. Nada más de este test cambia.
  assert.equal(OPPONENT_ENGINE_VERSION, "duel-opponent-2");

  const draw = (seed: number, n: number) => {
    let r = createRng(seed);
    const out: number[] = [];
    for (let i = 0; i < n; i++) { const x = nextFloat(r); out.push(x.value); r = x.rng; }
    return out;
  };
  assert.deepEqual(draw(12345, 8), draw(12345, 8));
});

test("el RNG reproduce exactamente la secuencia de makeRng del proyecto", () => {
  // Mismo algoritmo (mulberry32) que `@/sim/rng`, pero serializable.
  const legacy = makeRng(4242);
  let r = createRng(4242);
  for (let i = 0; i < 20; i++) {
    const mine = nextFloat(r);
    assert.equal(mine.value, legacy.next(), `extracción ${i}`);
    r = mine.rng;
  }
});

test("4 · semillas distintas producen secuencias distintas", () => {
  const first = (seed: number) => nextFloat(createRng(seed)).value;
  assert.notEqual(first(1), first(2));
  assert.notEqual(first(999), first(456));
});

test("25 · el estado del RNG se serializa y se restaura sin alterar el futuro", () => {
  let r = createRng(777);
  for (let i = 0; i < 5; i++) r = nextFloat(r).rng;
  const revived = JSON.parse(JSON.stringify(r)) as RngState;
  assert.deepEqual(revived, r);
  assert.ok(isRngState(revived));
  const a: number[] = [], b: number[] = [];
  let x = r, y = revived;
  for (let i = 0; i < 10; i++) { const p = nextFloat(x); a.push(p.value); x = p.rng; const q = nextFloat(y); b.push(q.value); y = q.rng; }
  assert.deepEqual(a, b);
});

test("23 · el RNG no depende de estado global: dos generadores no se interfieren", () => {
  let r1 = createRng(5), r2 = createRng(5);
  const s1 = nextFloat(r1); r1 = s1.rng;
  nextFloat(r2);                                    // avanza el otro por su cuenta
  const s2 = nextFloat(r1);
  let ref = createRng(5);
  ref = nextFloat(ref).rng;
  assert.equal(s2.value, nextFloat(ref).value);
});

// ───────────────────────────── Bot legal ─────────────────────────────

test("5-8 · el bot elige carta y estadística válidas atacando y defendiendo", () => {
  const res = botVsBot(1, 2);
  assert.ok(!res.error, res.error?.code);
  const m = res.match;
  for (const t of m.turns) {
    const atkSnap = t.attacker === "A" ? A : B;
    const defSnap = t.defender === "A" ? A : B;
    assert.ok(atkSnap.cards.some((c) => c.uid === t.attackerCardUid), "carta atacante del propio mazo");
    assert.ok(defSnap.cards.some((c) => c.uid === t.defenderCardUid), "carta defensora del propio mazo");
    assert.ok(["stronghold", "gamesense", "entryfrag"].includes(t.attackerStat));
  }
});

test("9 · el bot NUNCA declara un emparejamiento ilegal", () => {
  for (const [sa, sb] of [[1, 2], [77, 88], [0, 0], [123456, 654321]]) {
    const res = botVsBot(sa, sb);
    assert.ok(!res.error);
    for (const t of res.match.turns) {
      assert.equal(COMBAT_MATCHUP[t.attackerStat], t.defenderStat, `semillas ${sa}/${sb}`);
    }
  }
});

test("las dos estrategias devuelven SIEMPRE la estadística obligatoria al defender", () => {
  for (const bot of [createRandomBot("r"), createSmartBot("s", "NORMAL"), createSmartBot("h", "HARD")]) {
    for (const atk of ["stronghold", "gamesense", "entryfrag"] as CombatStatKey[]) {
      const d = bot.chooseDefenderStat({
        role: "DEFENDER", side: "B", turn: 1, available: A.cards, legalStats: [COMBAT_MATCHUP[atk]],
        attackerStat: atk, attackerValue: 50, visibleOpponentCards: [], scoreSelf: 0, scoreOpponent: 0,
        rng: createRng(1),
      });
      assert.equal(d.value, COMBAT_MATCHUP[atk], `${bot.id} contra ${atk}`);
    }
  }
});

test("10-11 · el bot nunca reutiliza una carta ni usa la del rival", () => {
  const m = botVsBot(31, 41).match;
  assert.equal(new Set(m.usedA).size, 10);
  assert.equal(new Set(m.usedB).size, 10);
  const uidsA = new Set(A.cards.map((c) => c.uid));
  const uidsB = new Set(B.cards.map((c) => c.uid));
  assert.ok(m.usedA.every((u) => uidsA.has(u)));
  assert.ok(m.usedB.every((u) => uidsB.has(u)));
});

test("12-13 · el bot respeta las fases y no actúa fuera de turno", () => {
  const ctrl = createController(HUMAN("A"), BOT("B"));
  const m = startMatch();                       // turno 1: ataca A, que es humano
  assert.equal(actingSide(m), "A");
  assert.equal(isBotTurn(m, ctrl), false);
  const r = advanceBotDecision(m, ctrl, createRandomBot("b"), createRng(1));
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "NOT_BOT_TURN");
});

test("14 · el bot no actúa sobre una partida terminada", () => {
  const done = botVsBot(5, 6).match;
  assert.notEqual(done.status, "IN_PROGRESS");
  const ctrl = createController(BOT("A"), BOT("B"));
  const r = advanceBotDecision(done, ctrl, createRandomBot("b"), createRng(1));
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "MATCH_NOT_IN_PROGRESS");
});

// ───────────────────────────── Bot vs Bot ─────────────────────────────

test("15-18 · Bot vs Bot completa una partida válida de principio a fin", () => {
  const res = botVsBot(101, 202);
  assert.ok(!res.error);
  const m = res.match;
  assert.ok(m.status === "COMPLETED" || m.status === "UNRESOLVED");
  assert.equal(m.turns.length, 10);
  assert.equal(m.turns.filter((t) => t.attacker === "A").length, 5);
  assert.equal(m.turns.filter((t) => t.attacker === "B").length, 5);
  assert.equal(m.usedA.length, 10);
  assert.equal(m.usedB.length, 10);

  const plan = buildCombatPlan(m);
  assert.equal(plan.encounters.length, 10);
  assert.deepEqual(m.result!.combat, resolveCombat(A, B, plan));
  assert.equal(m.result!.integrityOk, true);
  assert.deepEqual(m.result!.combat.errors, []);
});

test("el Smart Bot también juega partidas legales y completas", () => {
  const res = botVsBot(7, 8, A, B, true);
  assert.ok(!res.error);
  assert.equal(res.match.turns.length, 10);
  assert.equal(res.match.result!.integrityOk, true);
});

// ───────────────────────────── Humano vs Bot ─────────────────────────────

/** Aplica la decisión externa de una persona en la fase que toque. */
function humanAct(m: DuelMatch, side: Side): DuelMatch {
  const card = availableCards(m, side)[0];
  let r;
  switch (m.phase) {
    case "ATTACKER_CARD": r = selectAttackerCard(m, card.uid); break;
    case "ATTACKER_STAT": r = selectAttackerStat(m, "gamesense"); break;
    case "DEFENDER_CARD": r = selectDefenderCard(m, card.uid); break;
    case "DEFENDER_STAT": r = selectDefenderStat(m, requiredDefenderStat(m)!); break;
    default: return m;
  }
  assert.ok(r.ok, r.ok ? "" : r.error.code);
  return r.match;
}

/** Partida mixta: `humanSide` lo mueve código externo, el otro bando lo mueve un bot. */
function playMixed(humanSide: Side, seed: number): DuelMatch {
  const botSide: Side = humanSide === "A" ? "B" : "A";
  const ctrl = createController(
    humanSide === "A" ? HUMAN("A") : BOT("A"),
    humanSide === "B" ? HUMAN("B") : BOT("B"),
  );
  const bots = { [botSide]: createRandomBot("bot") };
  let m = startMatch();
  let rngA = createRng(seed), rngB = createRng(seed + 1);

  for (let guard = 0; guard < 100 && m.status === "IN_PROGRESS"; guard++) {
    if (m.phase === "READY_TO_CONFIRM") {
      const c = confirmTurn(m);
      assert.ok(c.ok);
      m = c.match;
      continue;
    }
    if (actingSide(m) === humanSide) { m = humanAct(m, humanSide); continue; }
    const r = advanceBots(m, ctrl, bots, rngA, rngB, 1);
    assert.ok(!r.error, r.error?.code);
    m = r.match; rngA = r.rngA; rngB = r.rngB;
  }
  return m;
}

test("19 · Humano (A) vs Bot (B): partida completa con las mismas reglas", () => {
  const m = playMixed("A", 4242);
  assert.equal(m.turns.length, 10);
  assert.equal(m.usedA.length, 10);
  assert.equal(m.usedB.length, 10);
  assert.equal(m.turns.filter((t) => t.attacker === "A").length, 5);
  assert.ok(m.result);
  assert.equal(m.result!.integrityOk, true);
  assert.deepEqual(m.result!.combat, resolveCombat(A, B, buildCombatPlan(m)));
});

test("19b · Bot (A) vs Humano (B): partida completa", () => {
  const m = playMixed("B", 777);
  assert.equal(m.turns.length, 10);
  assert.equal(m.result!.integrityOk, true);
});

test("20 · Bot (A) vs Humano (B): el dominio no asume que A sea humano", () => {
  const ctrl = createController(BOT("A"), HUMAN("B"));
  const m = startMatch();
  assert.equal(isBotTurn(m, ctrl), true, "en el turno 1 ataca A, que es bot");
  const r = advanceBots(m, ctrl, { A: createRandomBot("a") }, createRng(9), createRng(0));
  assert.ok(!r.error);
  assert.equal(r.match.phase, "DEFENDER_CARD", "se detiene al llegar al humano");
  assert.equal(actingSide(r.match), "B");
});

// ───────────────────────────── Determinismo y replay ─────────────────────────────

test("20-24 · misma semilla y mismo estado producen el mismo JSON", () => {
  const a = botVsBot(123, 456);
  const b = botVsBot(123, 456);
  assert.equal(JSON.stringify(a.match), JSON.stringify(b.match));
  assert.deepEqual(a.log, b.log);
});

test("la semilla participa de verdad: cambiarla cambia la partida", () => {
  const base = botVsBot(123, 456).match;
  const other = botVsBot(999, 456).match;
  const decisions = (m: DuelMatch) => m.turns.map((t) => `${t.attackerCardUid}|${t.attackerStat}|${t.defenderCardUid}`).join(",");
  assert.notEqual(decisions(base), decisions(other), "otra semilla debe cambiar alguna decisión");
});

test("21-22 · no se mutan los snapshots ni el match", () => {
  const beforeA = JSON.stringify(A), beforeB = JSON.stringify(B);
  const m0 = startMatch();
  const before0 = JSON.stringify(m0);
  advanceBots(m0, createController(BOT("A"), BOT("B")), { A: createRandomBot("a"), B: createRandomBot("b") }, createRng(1), createRng(2));
  assert.equal(JSON.stringify(A), beforeA);
  assert.equal(JSON.stringify(B), beforeB);
  assert.equal(JSON.stringify(m0), before0);
});

test("REPLAY · pausar en el turno 4, serializar y continuar da el mismo resultado", () => {
  const ctrl = createController(BOT("A"), BOT("B"));
  const bots = { A: createRandomBot("a"), B: createRandomBot("b") };

  // Partida completa de una sola vez.
  const full = advanceBots(startMatch(), ctrl, bots, createRng(11), createRng(22));

  // La misma, pausada tras 4 turnos, serializada y reanudada.
  let m = startMatch(), ra = createRng(11), rb = createRng(22);
  for (let i = 0; i < 40 && m.turns.length < 4; i++) {
    const s = advanceBots(m, ctrl, bots, ra, rb, 1);
    m = s.match; ra = s.rngA; rb = s.rngB;
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); assert.ok(c.ok); m = c.match; }
  }
  const saved = JSON.parse(JSON.stringify({ m, ra, rb }));
  const resumed = advanceBots(saved.m, ctrl, bots, saved.ra, saved.rb);

  assert.equal(JSON.stringify(resumed.match), JSON.stringify(full.match));
  assert.deepEqual(resumed.match.result, full.match.result);
});

// ───────────────────────────── Adversariales ─────────────────────────────

test("ADVERSARIAL · semillas extremas no rompen el generador", () => {
  for (const seed of [0, -1, -999999, 2 ** 53, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity, 3.7]) {
    const r = createRng(seed);
    assert.ok(isRngState(r), `semilla ${seed}`);
    assert.ok(Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= 0xffffffff);
    const v = nextFloat(r);
    assert.ok(v.value >= 0 && v.value < 1, `semilla ${seed} produjo ${v.value}`);
    const res = botVsBot(normalizeSeed(seed), 1);
    assert.ok(!res.error, `semilla ${seed}: ${res.error?.code}`);
    assert.equal(res.match.turns.length, 10);
  }
});

test("ADVERSARIAL · un estado de RNG corrupto se rechaza", () => {
  const ctrl = createController(BOT("A"), BOT("B"));
  const m = startMatch();
  for (const bad of [null, undefined, {}, { algorithm: "otro", seed: 1, state: 1, draws: 0 }, { algorithm: "mulberry32", seed: NaN, state: 1, draws: 0 }]) {
    const r = advanceBotDecision(m, ctrl, createRandomBot("b"), bad as never);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.ok ? "" : r.error.code, "INVALID_RNG_STATE");
  }
});

test("ADVERSARIAL · el bot con un snapshot inválido ni siquiera puede empezar", () => {
  const bad = { ...A, cards: A.cards.slice(0, 9) };
  const r = startDuelMatch({ id: "x", snapshotA: bad, snapshotB: B });
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "INVALID_MATCH");
});

test("ADVERSARIAL · una decisión ilegal del bot la rechaza el orquestador", () => {
  // Bot saboteador: siempre devuelve una carta que no existe.
  const saboteur = { ...createRandomBot("evil"), chooseAttackerCard: () => ({ value: "uid-falso", rng: createRng(1), explanation: "trampa" }) };
  const ctrl = createController(BOT("A"), BOT("B"));
  const r = advanceBotDecision(startMatch(), ctrl, saboteur, createRng(1));
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "ILLEGAL_DECISION");
  assert.equal(r.ok ? "" : r.error.detail, "CARD_NOT_IN_SNAPSHOT");
});

test("ADVERSARIAL · un bot que intenta reutilizar carta es rechazado", () => {
  const ctrl = createController(BOT("A"), BOT("B"));
  let m = startMatch();
  const first = availableCards(m, "A")[0].uid;
  const r0 = advanceBots(m, ctrl, { A: createRandomBot("a"), B: createRandomBot("b") }, createRng(1), createRng(2), 6);
  m = r0.match;
  const repeat = { ...createRandomBot("evil"), chooseAttackerCard: () => ({ value: first, rng: createRng(1), explanation: "repetir" }) };
  while (m.status === "IN_PROGRESS" && actingSide(m) !== "A") {
    const s = advanceBots(m, ctrl, { A: createRandomBot("a"), B: createRandomBot("b") }, createRng(1), createRng(2), 1);
    m = s.match;
    if (m.phase === "READY_TO_CONFIRM") m = (confirmTurn(m) as { match: DuelMatch }).match;
  }
  if (m.status === "IN_PROGRESS" && m.phase === "ATTACKER_CARD" && m.usedA.includes(first)) {
    const r = advanceBotDecision(m, ctrl, repeat, createRng(1));
    assert.equal(r.ok, false);
    assert.equal(r.ok ? "" : r.error.detail, "CARD_ALREADY_USED");
  }
});

// ───────────────────────────── Invariantes ─────────────────────────────

test("INVARIANTE · el bot no usa Math.random ni toca nada prohibido", () => {
  for (const file of ["./bots.ts", "./controller.ts", "./rng.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "Math.random", "Date.now", "performance.now", "crypto.randomUUID",
      "localStorage", "supabase", "fetch(", "process.env", "@/data/catalog", "@/store", "react",
    ]) {
      assert.ok(!code.includes(forbidden), `${file} no debe contener "${forbidden}"`);
    }
  }
});

test("INVARIANTE · el bot no reimplementa el combate ni copia la tabla", () => {
  const src = readFileSync(new URL("./bots.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(code.includes("COMBAT_MATCHUP"), "debe consumir la tabla existente");
  assert.ok(!/stronghold\s*:\s*["']entryfrag/.test(code), "no debe copiar la tabla");
  assert.ok(!code.includes("resolveEncounter"), "el bot no resuelve combates");
  assert.ok(!code.includes("computeCombatOvr"), "el bot no calcula OVR");
});

test("INVARIANTE · el bot nunca rompe los invariantes de la partida", () => {
  for (const [sa, sb] of [[1, 1], [2, 3], [500, 900], [0, 12345]]) {
    const m = botVsBot(sa, sb).match;
    assert.equal(m.turns.length, 10);
    assert.equal(m.usedA.length, 10);
    assert.equal(m.usedB.length, 10);
    assert.equal(new Set(buildCombatPlan(m).encounters.map((e) => e.aUid)).size, 10);
    assert.equal(m.turns.filter((t) => t.attacker === "A").length, 5);
    assert.equal(m.result!.integrityOk, true);
  }
});

test("INVARIANTE · tras N turnos cada bando ha consumido N cartas", () => {
  const ctrl = createController(BOT("A"), BOT("B"));
  const bots = { A: createRandomBot("a"), B: createRandomBot("b") };
  let m = startMatch(), ra = createRng(3), rb = createRng(4);
  let guard = 0;
  while (m.status === "IN_PROGRESS" && guard++ < 60) {
    const n = m.turns.length;
    const s = advanceBots(m, ctrl, bots, ra, rb, 1);
    m = s.match; ra = s.rngA; rb = s.rngB;
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); assert.ok(c.ok); m = c.match; }
    if (m.turns.length > n) {
      assert.equal(m.usedA.length, m.turns.length);
      assert.equal(m.usedB.length, m.turns.length);
    }
  }
  assert.equal(m.turns.length, 10);
});

// ───────────────────────────── Telemetría ─────────────────────────────

test("cada decisión del bot se puede explicar", () => {
  const res = botVsBot(60, 70);
  assert.equal(res.log.length, 40, "4 decisiones por turno × 10 turnos");
  for (const e of res.log) {
    assert.ok(e.explanation.length > 5, e.step);
    assert.equal(e.actor, "BOT");
    assert.ok(e.strategy);
    assert.ok(e.options.includes(e.chosen) || e.step === "DEFENDER_STAT");
    assert.ok(e.turn >= 1 && e.turn <= 10);
  }
});

// ───────────────────────────── Mazos reales ─────────────────────────────

test("MAZOS REALES · Bot vs Bot en los tres emparejamientos", () => {
  for (const [x, y, label] of [[A, B, "1v2"], [A, C, "1v3"], [B, C, "2v3"]] as const) {
    const res = botVsBot(2026, 1234, x, y);
    assert.ok(!res.error, label);
    const m = res.match;
    assert.equal(m.turns.length, 10, label);
    assert.equal(m.usedA.length, 10, label);
    assert.equal(m.usedB.length, 10, label);
    assert.deepEqual(m.result!.combat, resolveCombat(x, y, buildCombatPlan(m)), label);
    assert.equal(m.result!.integrityOk, true, label);
    // Reproducible con las mismas semillas.
    assert.equal(JSON.stringify(botVsBot(2026, 1234, x, y).match), JSON.stringify(m), label);
  }
});

// ───────────────────────────── Simulación masiva ─────────────────────────────

test("SIMULACIÓN · 1000 partidas Bot vs Bot deterministas", () => {
  let winA = 0, winB = 0, unresolved = 0, ties = 0, sumA = 0, sumB = 0;
  const failures: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const res = botVsBot(i * 7 + 1, i * 13 + 3);
    if (res.error) { failures.push(`${i}:${res.error.code}`); continue; }
    const m = res.match;
    if (m.turns.length !== 10 || !m.result || !m.result.integrityOk) { failures.push(`${i}:invariante`); continue; }
    if (m.status === "UNRESOLVED") unresolved++;
    else if (m.result.winner === "A") winA++;
    else if (m.result.winner === "B") winB++;
    ties += m.result.tiedEncounters;
    sumA += m.result.scoreA;
    sumB += m.result.scoreB;
  }
  assert.deepEqual(failures, [], "ninguna simulación debe fallar");
  assert.equal(winA + winB + unresolved, 1000);
  // Diagnóstico, no aserción de balance: se registra pero no se ajusta ninguna regla.
  console.log(`      simulación: A ${winA} · B ${winB} · sin resolver ${unresolved} · empates ${ties} · media ${(sumA / 1000).toFixed(2)}-${(sumB / 1000).toFixed(2)}`);
});
